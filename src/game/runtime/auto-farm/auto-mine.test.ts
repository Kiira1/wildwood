import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MINING_NODES, MINING_NODE_KINDS, MINING_REACH, MINING_VEINS, miningNodeName, type MiningNode } from '../../../../shared/mining';
import type { BagSpace } from '../../../../shared/ore-bag';
import { TOWN_ARRIVAL, TOWN_FEET_OFFSET, townRoomAt, townWalkClamp } from '../../../../shared/town';
import { createGameBootstrap } from '../game-bootstrap';
import type { Movement } from '../player-input-controller';
import { createMiningRuntime } from '../town/mining-runtime';
import { miningScene, resetMiningScene } from '../town/mining-scene';
import { pushOutOf, TOWN_FEET_RADIUS, TOWN_SOLIDS } from '../town/town-runtime';
import { planTownPath } from '../town/town-path';
import type { PlayerState } from '../types';
import { createAutoFarmController } from './auto-farm-controller';
import { AUTO_MINE_ORES_KEY, chooseMiningRock, createAutoMine, inMiningArea, miningStandSpot } from './auto-mine';

// Walks from the village to the hills frame by frame: a second or so each, more on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const none: Movement = { x: 0, y: 0, source: 'none' };
const SPEED = 300, DT = 1 / 30;
const copper = MINING_NODES.filter(node => node.ore === 'copper_ore');
const crystals = MINING_NODES.filter(node => node.kind === 'crystal');
const inVein = (ore: string) => (node: MiningNode) => MINING_VEINS[node.vein].ore === ore;
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** Where the walk out from the village comes into the hills, as a player stands (Auto Mine starts only there). */
const HILLS_ENTRY = (() => {
  const from = { x: TOWN_ARRIVAL.x, y: TOWN_ARRIVAL.y + TOWN_FEET_OFFSET };
  const path = [from, ...planTownPath(from, miningStandSpot(copper[0])!)!];
  // A little way in along the walk: a point every few units.
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1], b = path[index], steps = Math.ceil(distance(a, b) / 4);
    for (let step = 0; step <= steps; step++) {
      const x = a.x + (b.x - a.x) * step / steps, y = a.y + (b.y - a.y) * step / steps - TOWN_FEET_OFFSET;
      if (inMiningArea(x - 60, y)) return { x, y };
    }
  }
  throw new Error('The walk never comes into the hills');
})();
function memoryStorage(values = new Map<string, string>()) {
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

/** A player in the Town, Auto Mine, and a frame step that moves them as the game does (collision included). */
function setup(options: { at?: { x: number; y: number }; storage?: ReturnType<typeof memoryStorage>; mining?: number; bag?: BagSpace } = {}) {
  const player = { ...(options.at ?? HILLS_ENTRY), moving: false, hp: 100 } as PlayerState;
  const world = { map: 'town', time: 0, server: 5_000_000, broken: new Map<number, number>() };
  const storage = options.storage ?? memoryStorage();
  const source = {
    minedNodeAt: (id: number) => world.broken.get(id) ?? null, mining: () => options.mining ?? 0, serverNowMs: () => world.server,
    // Breaks queue for the next report and count at once, as the session's do.
    queueMiningBreak: vi.fn((id: number, atMs: number) => { world.broken.set(id, atMs); }), flushMining: vi.fn(),
  };
  // The runtime that mines what they stand by, only with a bag to judge: the walking tests leave it out.
  const runtime = options.bag ? createMiningRuntime({ source: () => source, player, bag: () => options.bag }) : null;
  const mine = createAutoMine({ player, mapId: () => world.map, source: () => source, storage: () => storage, speed: () => SPEED, now: () => world.time });
  function move(movement: Movement) {
    player.moving = Boolean(movement.x || movement.y);
    player.x += movement.x * SPEED * DT; player.y += movement.y * SPEED * DT;
    const feet = { x: player.x, y: player.y + TOWN_FEET_OFFSET, r: TOWN_FEET_RADIUS };
    for (const solid of TOWN_SOLIDS) pushOutOf(feet, solid);
    if (!townRoomAt(player.x, player.y, 400)) Object.assign(feet, townWalkClamp(feet.x, feet.y));
    player.x = feet.x; player.y = feet.y - TOWN_FEET_OFFSET;
  }
  function step(manual: Movement = none) {
    const movement = mine.movement(manual, DT) ?? manual;
    move(movement);
    runtime?.update(DT, true);
    world.time += DT * 1_000; world.server += DT * 1_000;
    return movement;
  }
  /** Steps until `done` (or the time runs out); the frames it took. */
  function runUntil(done: () => boolean, seconds = 60) {
    for (let frame = 0; frame < seconds / DT; frame++) { if (done()) return frame; step(); }
    return Infinity;
  }
  const feet = () => ({ x: player.x, y: player.y + TOWN_FEET_OFFSET });
  const at = (node: MiningNode) => distance(feet(), miningStandSpot(node)!) <= 6;
  return { player, world, storage, source, mine, step, runUntil, feet, at };
}

beforeEach(() => resetMiningScene());
/** The Mining the copper vein's crystal rocks ask for. */
const CRYSTAL = MINING_VEINS[0].crystalMining;

describe('choosing the rock', () => {
  const feet = miningStandSpot(copper[0])!;
  const ores = new Set(['copper_ore', 'iron_ore'] as const);
  it('takes the nearest standing rock of a picked ore', () => {
    const choice = chooseMiningRock({ feet, ores, open: () => true, bareUntil: () => null });
    expect(choice).toEqual({ node: copper[0], readyAt: null });
  });
  it('skips bare rocks, and rocks of ores not picked or in veins not open', () => {
    const choice = chooseMiningRock({ feet, ores: new Set(['iron_ore']), open: () => true, bareUntil: () => null })!;
    expect(choice.node.ore).toBe('iron_ore');
    expect(chooseMiningRock({ feet, ores: new Set(['iron_ore']), open: inVein('copper_ore'), bareUntil: () => null })).toBeNull();
    const next = chooseMiningRock({ feet, ores, open: inVein('copper_ore'), bareUntil: node => node.id === copper[0].id ? 1 : null })!;
    expect(next.node.ore).toBe('copper_ore');
    expect(next.node).not.toBe(copper[0]);
    // The nearest of the rest.
    const rest = copper.slice(1).sort((a, b) => distance(miningStandSpot(a)!, feet) - distance(miningStandSpot(b)!, feet));
    expect(next.node).toBe(rest[0]);
  });
  it('with every rock bare, waits for the one that grows back first', () => {
    const soonest = copper[7];
    const choice = chooseMiningRock({ feet, ores, open: inVein('copper_ore'), bareUntil: node => node === soonest ? 1_000 : 9_000 + node.id });
    expect(choice).toEqual({ node: soonest, readyAt: 1_000 });
  });
  it('takes crystal rocks with Arcane Crystal picked, as any other rock, where the player may mine them', () => {
    const crystal = crystals.find(inVein('copper_ore'))!;
    const near = { ...miningStandSpot(crystal)! };
    expect(chooseMiningRock({ feet: near, ores: new Set(['copper_ore', 'arcane_crystal']), open: () => true, bareUntil: () => null })!.node).toBe(crystal);
    // Not picked, or shut to the player (its gate): the nearest copper instead.
    expect(chooseMiningRock({ feet: near, ores: new Set(['copper_ore']), open: () => true, bareUntil: () => null })!.node.kind).not.toBe('crystal');
    expect(chooseMiningRock({ feet: near, ores: new Set(['copper_ore', 'arcane_crystal']), open: node => node.kind !== 'crystal', bareUntil: () => null })!.node.ore).toBe('copper_ore');
    expect(chooseMiningRock({ feet: near, ores: new Set(['arcane_crystal']), open: node => node.kind !== 'crystal', bareUntil: () => null })).toBeNull();
  });
  it('stands every rock\'s miner on clear ground within reach, below or beside the stone', () => {
    for (const node of MINING_NODES) {
      const spot = miningStandSpot(node)!;
      expect(spot, `rock ${node.id}`).not.toBeNull();
      expect(distance(spot, node)).toBeLessThan(MINING_REACH - 8);
      expect(spot.y).toBeGreaterThan(node.y);
    }
  });
});

describe('Auto Mine', () => {
  it('walks from the edge of the hills to the nearest copper rock, then holds still there while it is mined', () => {
    const s = setup();
    expect(s.mine.start()).toBe(true);
    s.step();
    const target = s.mine.state().target!;
    expect(target.ore).toBe('copper_ore');
    expect(s.mine.state().status).toBe(`Walking to ${miningNodeName(target)}`);
    expect(s.runUntil(() => s.at(target))).toBeLessThan(60 / DT);
    s.step();
    expect(s.mine.state().status).toBe(`Mining ${miningNodeName(target)}`);
    // Standing in reach of that rock and no other: the mining runtime takes it from here.
    const inReach = MINING_NODES.filter(node => distance(node, s.feet()) <= MINING_REACH);
    expect(inReach).toEqual([target]);
    const still = { ...s.player };
    for (let frame = 0; frame < 30; frame++) expect(s.step().source).toBe('none');
    expect(s.player.x).toBe(still.x);
    expect(s.player.y).toBe(still.y);
  });

  it('goes on to the next rock once one breaks, and waits by the first to grow back when all are bare', () => {
    const s = setup({ at: { x: miningStandSpot(copper[0])!.x, y: miningStandSpot(copper[0])!.y - TOWN_FEET_OFFSET } });
    s.mine.start();
    s.step();
    expect(s.mine.state().target).toBe(copper[0]);
    // Broken here: bare at once, before the server lists it.
    miningScene.bare.add(copper[0].id);
    s.step();
    const next = s.mine.state().target!;
    expect(next).not.toBe(copper[0]);
    expect(s.step().source).toBe('steer');
    expect(s.runUntil(() => s.at(next))).toBeLessThan(30 / DT);
    // Every copper rock bare, the third last to be broken growing back first.
    miningScene.bare.clear();
    const respawn = (node: MiningNode) => MINING_NODE_KINDS[node.kind].respawnSeconds * 1_000;
    copper.forEach((node, index) => s.world.broken.set(node.id, s.world.server - respawn(node) + 600_000 - index * 1_000));
    const soonest = copper.reduce((best, node) => (s.world.broken.get(node.id)! + respawn(node) < s.world.broken.get(best.id)! + respawn(best) ? node : best));
    s.step();
    expect(s.mine.state().target).toBe(soonest);
    s.runUntil(() => s.at(soonest));
    s.step();
    expect(s.mine.state().status).toMatch(/^Waiting for Rocks to Grow Back · \d+:\d\d$/);
    // Grown back: it mines it.
    s.world.broken.delete(soonest.id);
    s.runUntil(() => s.mine.state().status.startsWith('Mining'), 2);
    expect(s.mine.state()).toMatchObject({ status: `Mining ${miningNodeName(soonest)}`, target: soonest });
  });

  it('gives way to the player\'s own keys, and carries on when they let go', () => {
    const s = setup();
    s.mine.start();
    s.runUntil(() => false, 1);
    const manual: Movement = { x: -1, y: 0, source: 'keyboard' };
    expect(s.step(manual)).toBe(manual);
    expect(s.mine.state()).toMatchObject({ active: true, status: 'Manual Control' });
    for (let frame = 0; frame < 30; frame++) s.step(manual);
    expect(s.step().source).toBe('steer');
    expect(s.mine.state().status).toMatch(/^Walking to /);
  });

  it('plans the walk once, and again only for a new rock or when it makes no headway for a second and a half', () => {
    const player = { ...HILLS_ENTRY, moving: false } as PlayerState;
    let time = 0;
    const plan = vi.fn(planTownPath);
    const mine = createAutoMine({ player, mapId: () => 'town', source: () => ({ minedNodeAt: () => null, serverNowMs: () => 5_000_000 }),
      storage: () => memoryStorage(), speed: () => SPEED, now: () => time, plan });
    mine.start();
    // Walking: one plan.
    for (let frame = 0; frame < 30; frame++) {
      const movement = mine.movement(none, DT)!;
      player.x += movement.x * SPEED * DT; player.y += movement.y * SPEED * DT; time += DT * 1_000;
    }
    expect(plan).toHaveBeenCalledTimes(1);
    // Held in place (a wall the plan did not see): planned again after 1.5s without headway.
    for (let frame = 0; frame < 1.4 / DT; frame++) { mine.movement(none, DT); time += DT * 1_000; }
    expect(plan).toHaveBeenCalledTimes(1);
    for (let frame = 0; frame < .3 / DT; frame++) { mine.movement(none, DT); time += DT * 1_000; }
    expect(plan).toHaveBeenCalledTimes(2);
  });

  it('starts only in the Copper Hills, and stops when the player walks out of them', () => {
    const village = setup({ at: TOWN_ARRIVAL });
    expect(village.mine.start()).toBe(false);
    expect(village.mine.state()).toMatchObject({ active: false, status: 'Auto Mine Works in the Copper Hills' });
    const s = setup();
    expect(s.mine.start()).toBe(true);
    // Walking back west to the village with their own keys.
    const west: Movement = { x: -1, y: 0, source: 'keyboard' };
    for (let frame = 0; frame < 3 / DT && s.mine.state().active; frame++) s.step(west);
    expect(inMiningArea(s.player.x, s.player.y)).toBe(false);
    expect(s.mine.state()).toMatchObject({ active: false, status: 'Auto Mine Stopped: Left the Copper Hills' });
    // It stays off on walking back in.
    s.player.x = HILLS_ENTRY.x; s.player.y = HILLS_ENTRY.y;
    expect(s.mine.movement(none, DT)).toBeNull();
    expect(s.mine.state().active).toBe(false);
  });

  it('keeps every walk from rock to rock inside the hills', () => {
    const from = miningStandSpot(copper[0])!;
    for (const node of MINING_NODES) {
      const path = planTownPath(from, miningStandSpot(node)!)!;
      expect(path, `rock ${node.id}`).not.toBeNull();
      for (const point of path) expect(inMiningArea(point.x, point.y - TOWN_FEET_OFFSET), `rock ${node.id}`).toBe(true);
    }
  });

  it('says what it needs: an ore picked, a vein its Mining opens; never a pickaxe, which every player holds', () => {
    const s = setup();
    s.mine.setPicked('copper_ore', false);
    s.mine.setPicked('arcane_crystal', false);
    expect(s.mine.start()).toBe(false);
    expect(s.mine.state().status).toBe('Pick an Ore to Mine');
    // Iron picked but its vein shut below Mining 50: nothing to mine either.
    s.mine.setPicked('iron_ore', true);
    expect(s.mine.start()).toBe(false);
    expect(s.mine.veins().find(vein => vein.ore === 'iron_ore')).toMatchObject({ open: false, opensWith: 'Mining 50', locked: 'Opens at Mining 50', picked: true });
    expect(s.mine.veins().find(vein => vein.ore === 'adamant_ore')).toMatchObject({ open: false, locked: 'Opens at Mining 900' });
    const open = setup({ mining: 50, storage: s.storage });
    expect(open.mine.start()).toBe(true);
    open.step();
    expect(open.mine.state().target!.ore).toBe('iron_ore');
  });

  it('remembers the ores picked on this device, Copper and Arcane Crystal to start with', () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    expect(first.mine.veins().filter(vein => vein.picked).map(vein => vein.ore)).toEqual(['copper_ore', 'arcane_crystal']);
    first.mine.setPicked('arcane_crystal', false);
    first.mine.setPicked('mithril_ore', true);
    first.mine.setPicked('copper_ore', false);
    expect(JSON.parse(storage.values.get(AUTO_MINE_ORES_KEY)!)).toEqual(['mithril_ore']);
    expect(setup({ storage }).mine.veins().filter(vein => vein.picked).map(vein => vein.ore)).toEqual(['mithril_ore']);
    // Picks saved before crystal rocks could be mined carry over, with Arcane Crystal on.
    const older = memoryStorage(new Map([['wildstat:automine-ores:v1', JSON.stringify(['iron_ore'])]]));
    expect(setup({ storage: older }).mine.veins().filter(vein => vein.picked).map(vein => vein.ore)).toEqual(['iron_ore', 'arcane_crystal']);
  });

  it('stops for good when the player leaves the Town', () => {
    const s = setup();
    s.mine.start();
    s.step();
    s.mine.travelStarted();
    expect(s.mine.state()).toMatchObject({ active: false, status: 'Auto Mine Stopped: Left the Town' });
    const again = setup();
    again.mine.start();
    again.world.map = 'forest';
    expect(again.mine.movement(none, DT)).toBeNull();
    expect(again.mine.state()).toMatchObject({ active: false, status: 'Auto Mine Stopped: Left the Town' });
    again.world.map = 'town';
    expect(again.mine.movement(none, DT)).toBeNull();
    expect(again.mine.state().active).toBe(false);
  });
});

describe('crystal rocks', () => {
  it('mines them once Mining reaches their mark, with the bag room and regrowth of any rock', () => {
    // Before Mining 25: locked in the window, and with only crystal picked there is nothing to mine.
    const early = setup({ mining: 24 });
    early.mine.setPicked('copper_ore', false);
    expect(early.mine.veins().find(vein => vein.ore === 'arcane_crystal')).toMatchObject({ open: false, picked: true, locked: 'Opens at Mining 25' });
    expect(early.mine.start()).toBe(false);
    expect(early.mine.state().status).toBe('Pick an Ore to Mine');

    const bag = { owned: [], equipped: [], extraCopies: 0, ores: {}, capacity: 10 };
    const s = setup({ mining: CRYSTAL, bag, storage: early.storage });
    const open = crystals.filter(inVein('copper_ore'));
    expect(s.mine.veins().find(vein => vein.ore === 'arcane_crystal')).toMatchObject({ open: true, rocks: open.length, standing: open.length });
    expect(s.mine.start()).toBe(true);
    s.step();
    const first = s.mine.state().target!;
    expect(first.kind).toBe('crystal');
    // Only the copper vein's crystals: the iron vein's ask for Mining 75.
    expect(open).toContain(first);
    expect(s.runUntil(() => s.at(first))).toBeLessThan(60 / DT);
    s.step();
    expect(s.mine.state().status).toBe(`Mining ${miningNodeName(first)}`);
    // Broken by the runtime: on to another crystal, and the broken one counted bare.
    s.runUntil(() => s.source.queueMiningBreak.mock.calls.length > 0, 30);
    expect(s.source.queueMiningBreak).toHaveBeenCalledExactlyOnceWith(first.id, expect.any(Number));
    s.step();
    expect(s.mine.state().target).not.toBe(first);
    expect(s.mine.state().target!.kind).toBe('crystal');
    expect(s.mine.veins().find(vein => vein.ore === 'arcane_crystal')!.standing).toBe(open.length - 1);
  });

  it('passes over crystal rocks with no bag room for crystal, and stops once no rock has room', () => {
    // Copper held, no free slot: copper still comes in, crystal does not.
    const bag = { owned: [], equipped: [], extraCopies: 0, ores: { copper_ore: 5 }, capacity: 1 };
    const crystal = crystals.find(inVein('copper_ore'))!;
    const s = setup({ mining: CRYSTAL, bag, at: { x: miningStandSpot(crystal)!.x, y: miningStandSpot(crystal)!.y - TOWN_FEET_OFFSET } });
    s.mine.start();
    s.step();
    expect(s.mine.state().target).toBe(crystal);
    s.runUntil(() => s.mine.state().target?.kind !== 'crystal', 2);
    expect(s.mine.state()).toMatchObject({ active: true });
    expect(s.mine.state().target!.ore).toBe('copper_ore');
    expect(s.mine.state().target!.kind).not.toBe('mysterious');

    const full = setup({ mining: CRYSTAL, bag: { owned: [], equipped: [], extraCopies: 0, ores: {}, capacity: 0 } });
    full.mine.start();
    full.runUntil(() => !full.mine.state().active);
    expect(full.mine.state()).toMatchObject({ active: false, status: 'Auto Mine Stopped: Bag Full' });
    expect(full.source.queueMiningBreak).not.toHaveBeenCalled();
  });
});

describe('Auto Mine inside Auto Farm', () => {
  function farmSetup() {
    const state = createGameBootstrap();
    state.enemies.length = 0; state.spawnSites.length = 0;
    Object.assign(state.player, { ...TOWN_ARRIVAL, speed: SPEED });
    const forestSites = [{ id: 1, type: 'Bramble' as const, x: 1200, y: 500, campName: 'Test', leashRange: 500, alive: false, respawnAt: 50 }];
    let map = 'forest', time = 0;
    const source = { minedNodeAt: () => null, serverNowMs: () => 5_000_000 };
    const farm = createAutoFarmController({ ...state, mapId: () => map, unavailable: () => null, paused: () => false, speed: () => SPEED, obstacles: () => [],
      localIdentity: () => 'me', now: () => time, mining: () => source, priorityStorage: () => memoryStorage() as unknown as Storage });
    const goTo = (next: string) => {
      farm.travelStarted();
      map = next;
      state.spawnSites.splice(0, state.spawnSites.length, ...(next === 'town' ? [] : forestSites));
      Object.assign(state.player, next === 'town' ? HILLS_ENTRY : { x: 500, y: 500 });
    };
    state.spawnSites.push(...forestSites);
    return { state, farm, goTo, tick: (ms: number) => { time += ms; } };
  }

  it('steers in the Town while a farm waits to carry on, and leaves that farm to resume on the next map', () => {
    const s = farmSetup();
    expect(s.farm.start([])).toBe(true);
    s.goTo('town');
    expect(s.farm.state().waiting).toBe(true);
    expect(s.farm.mine!.start()).toBe(true);
    expect(s.farm.movement(none, DT).source).toBe('steer');
    // Auto Farm stays out of it: still waiting, not farming the Town.
    expect(s.farm.state()).toMatchObject({ active: false, waiting: true });
    s.goTo('forest');
    expect(s.farm.mine!.state()).toMatchObject({ active: false, status: 'Auto Mine Stopped: Left the Town' });
    s.tick(1_100);
    s.farm.refresh(); s.tick(1_100); s.farm.refresh();
    expect(s.farm.state().active).toBe(true);
  });

  it('leaves the combat maps to Auto Farm alone', () => {
    const s = farmSetup();
    expect(s.farm.mine!.start()).toBe(false);
    expect(s.farm.mine!.state().status).toBe('Auto Mine Works in the Copper Hills');
    expect(s.farm.movement(none, DT)).toEqual(none);
  });
});

describe('after an update reload', () => {
  function tab(resume: Map<string, string>, options: { identity?: string; map?: string; connection?: 'ready' | 'recovering' | 'ended'; at?: { x: number; y: number } } = {}) {
    const world = { map: options.map ?? 'town', connection: options.connection ?? 'ready' as 'ready' | 'recovering' | 'ended' };
    const resumeStorage = { getItem: (key: string) => resume.get(key) ?? null, setItem: (key: string, value: string) => { resume.set(key, value); },
      removeItem: (key: string) => { resume.delete(key); } };
    const source = { minedNodeAt: () => null, serverNowMs: () => 5_000_000 };
    const mine = createAutoMine({ player: { ...(options.at ?? HILLS_ENTRY) } as PlayerState, mapId: () => world.map, source: () => source,
      storage: () => memoryStorage(), resumeStorage: () => resumeStorage, identity: () => options.identity ?? 'me',
      connection: () => world.connection, speed: () => SPEED, now: () => 0 });
    return { mine, world };
  }
  it('comes back on in the new page once connected in the Copper Hills', () => {
    const resume = new Map<string, string>();
    expect(tab(resume).mine.start()).toBe(true);
    const reloaded = tab(resume, { connection: 'recovering' });
    expect(reloaded.mine.state()).toMatchObject({ active: false, waiting: true });
    reloaded.mine.movement(none, DT);
    expect(reloaded.mine.state().active).toBe(false);
    reloaded.world.connection = 'ready';
    reloaded.mine.movement(none, DT);
    expect(reloaded.mine.state().active).toBe(true);
  });
  it('stays off after Stop, after leaving the Town, for another player, and outside the hills', () => {
    const stopped = new Map<string, string>();
    const first = tab(stopped);
    first.mine.start(); first.mine.stop();
    const afterStop = tab(stopped); afterStop.mine.movement(none, DT);
    expect(afterStop.mine.state().active).toBe(false);

    const travelled = new Map<string, string>();
    const second = tab(travelled);
    second.mine.start(); second.mine.travelStarted();
    const afterTravel = tab(travelled); afterTravel.mine.movement(none, DT);
    expect(afterTravel.mine.state().active).toBe(false);

    const shared = new Map<string, string>();
    tab(shared, { identity: 'me' }).mine.start();
    const other = tab(shared, { identity: 'someone else' }); other.mine.movement(none, DT);
    expect(other.mine.state()).toMatchObject({ active: false, waiting: false });

    // Back in the village instead: it does not wait to start when they next walk out to the hills.
    const moved = new Map<string, string>();
    tab(moved).mine.start();
    const village = tab(moved, { at: TOWN_ARRIVAL }); village.mine.movement(none, DT);
    expect(village.mine.state()).toMatchObject({ active: false, waiting: false });
  });
});

describe('Auto Mine with breaks sent in batches', () => {
  it('mines rock after rock while the breaks only wait in the queue, each counted bare at once', () => {
    const bag = { owned: [], equipped: [], extraCopies: 0, ores: { copper_ore: 1 }, capacity: 30 };
    const s = setup({ bag });
    s.mine.start();
    expect(s.runUntil(() => s.source.queueMiningBreak.mock.calls.length >= 3, 120)).toBeLessThan(120 / DT);
    const broken = s.source.queueMiningBreak.mock.calls.map(([id]) => id);
    expect(new Set(broken).size).toBe(3);
    expect(s.mine.state()).toMatchObject({ active: true });
    expect(s.source.flushMining).not.toHaveBeenCalled();
  });
});
