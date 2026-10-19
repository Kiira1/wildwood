import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MINING_NODES, MINING_NODE_KINDS, MINING_REACH, MINING_VEINS, miningNodeName, miningVeinMap, type MiningNode } from '../../../../shared/mining';
import { TOWN_ARRIVAL, TOWN_DOORS, TOWN_FEET_OFFSET, townRoomAt, townWalkClamp } from '../../../../shared/town';
import { createGameBootstrap } from '../game-bootstrap';
import type { Movement } from '../player-input-controller';
import { miningScene, resetMiningScene } from '../town/mining-scene';
import { pushOutOf, TOWN_FEET_RADIUS, TOWN_SOLIDS } from '../town/town-runtime';
import { planTownPath } from '../town/town-path';
import type { PlayerState } from '../types';
import { createAutoFarmController } from './auto-farm-controller';
import { AUTO_MINE_ORES_KEY, chooseMiningRock, createAutoMine, miningStandSpot } from './auto-mine';

// Walks from the village to the hills frame by frame: a second or so each, more on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const none: Movement = { x: 0, y: 0, source: 'none' };
const SPEED = 300, DT = 1 / 30;
const copper = MINING_NODES.filter(node => node.ore === 'copper_ore');
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
function memoryStorage(values = new Map<string, string>()) {
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

/** A player in the Town, Auto Mine, and a frame step that moves them as the game does (collision included). */
function setup(options: { access?: Record<string, boolean>; pickaxe?: boolean; at?: { x: number; y: number }; storage?: ReturnType<typeof memoryStorage> } = {}) {
  const player = { ...(options.at ?? TOWN_ARRIVAL), moving: false } as PlayerState;
  const world = { map: 'town', time: 0, server: 5_000_000, pickaxe: options.pickaxe ?? true, broken: new Map<number, number>() };
  const storage = options.storage ?? memoryStorage();
  const source = {
    hasPickaxe: () => world.pickaxe, minedNodeAt: (id: number) => world.broken.get(id) ?? null,
    serverNowMs: () => world.server, savedProgress: () => options.access ?? {},
  };
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
  return { player, world, storage, mine, step, runUntil, feet, at };
}

beforeEach(() => resetMiningScene());

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
    expect(chooseMiningRock({ feet, ores: new Set(['iron_ore']), open: vein => vein.ore === 'copper_ore', bareUntil: () => null })).toBeNull();
    const next = chooseMiningRock({ feet, ores, open: vein => vein.ore === 'copper_ore', bareUntil: node => node.id === copper[0].id ? 1 : null })!;
    expect(next.node.ore).toBe('copper_ore');
    expect(next.node).not.toBe(copper[0]);
    // The nearest of the rest.
    const rest = copper.slice(1).sort((a, b) => distance(miningStandSpot(a)!, feet) - distance(miningStandSpot(b)!, feet));
    expect(next.node).toBe(rest[0]);
  });
  it('with every rock bare, waits for the one that grows back first', () => {
    const soonest = copper[7];
    const choice = chooseMiningRock({ feet, ores, open: vein => vein.ore === 'copper_ore', bareUntil: node => node === soonest ? 1_000 : 9_000 + node.id });
    expect(choice).toEqual({ node: soonest, readyAt: 1_000 });
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
  it('walks from the village square to the nearest copper rock, then holds still there while it is mined', () => {
    const s = setup();
    expect(s.mine.start()).toBe(true);
    s.step();
    expect(s.mine.state().status).toBe('Walking to the Copper Hills');
    const target = s.mine.state().target!;
    expect(target.ore).toBe('copper_ore');
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
    expect(s.mine.state().status).toBe('Walking to the Copper Hills');
  });

  it('plans the walk once, and again only for a new rock or when it makes no headway for a second and a half', () => {
    const player = { ...TOWN_ARRIVAL, moving: false } as PlayerState;
    let time = 0;
    const plan = vi.fn(planTownPath);
    const mine = createAutoMine({ player, mapId: () => 'town', source: () => ({ hasPickaxe: () => true, minedNodeAt: () => null, serverNowMs: () => 5_000_000, savedProgress: () => ({}) }),
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

  it('walks out of a house first', () => {
    const door = TOWN_DOORS[5];
    const s = setup({ at: { x: door.inside.x, y: door.inside.y - 40 } });
    s.mine.start();
    s.step();
    expect(s.mine.state().status).toBe('Leaving the House');
    // At the doorway it keeps walking down, out through it (the Town's runtime takes it through the door).
    s.runUntil(() => s.player.y + TOWN_FEET_OFFSET > door.exit.y - 4, 10);
    expect(s.step()).toEqual({ x: 0, y: 1, source: 'steer' });
  });

  it('says what it needs: the pickaxe, an ore picked, an open vein', () => {
    const noPickaxe = setup({ pickaxe: false });
    expect(noPickaxe.mine.start()).toBe(false);
    expect(noPickaxe.mine.state()).toMatchObject({ active: false, status: 'Get a Pickaxe from the Smith' });
    const s = setup();
    s.mine.setPicked('copper_ore', false);
    expect(s.mine.start()).toBe(false);
    expect(s.mine.state().status).toBe('Pick an Ore to Mine');
    // Iron picked but its vein shut: nothing to mine either.
    s.mine.setPicked('iron_ore', true);
    expect(s.mine.start()).toBe(false);
    const iron = MINING_VEINS.find(vein => vein.ore === 'iron_ore')!;
    expect(s.mine.veins().find(vein => vein.ore === 'iron_ore')).toMatchObject({ open: false, opensWith: miningVeinMap(iron), picked: true });
    const open = setup({ access: { infernalUnlocked: true }, storage: s.storage });
    expect(open.mine.start()).toBe(true);
    open.step();
    expect(open.mine.state().target!.ore).toBe('iron_ore');
  });

  it('remembers the ores picked on this device, Copper to start with', () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    expect(first.mine.veins().filter(vein => vein.picked).map(vein => vein.ore)).toEqual(['copper_ore']);
    first.mine.setPicked('mithril_ore', true);
    first.mine.setPicked('copper_ore', false);
    expect(JSON.parse(storage.values.get(AUTO_MINE_ORES_KEY)!)).toEqual(['mithril_ore']);
    expect(setup({ storage }).mine.veins().filter(vein => vein.picked).map(vein => vein.ore)).toEqual(['mithril_ore']);
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

describe('Auto Mine inside Auto Farm', () => {
  function farmSetup() {
    const state = createGameBootstrap();
    state.enemies.length = 0; state.spawnSites.length = 0;
    Object.assign(state.player, { ...TOWN_ARRIVAL, speed: SPEED });
    const forestSites = [{ id: 1, type: 'Bramble' as const, x: 1200, y: 500, campName: 'Test', leashRange: 500, alive: false, respawnAt: 50 }];
    let map = 'forest', time = 0;
    const source = { hasPickaxe: () => true, minedNodeAt: () => null, serverNowMs: () => 5_000_000, savedProgress: () => ({}) };
    const farm = createAutoFarmController({ ...state, mapId: () => map, unavailable: () => null, paused: () => false, speed: () => SPEED, obstacles: () => [],
      localIdentity: () => 'me', now: () => time, mining: () => source, priorityStorage: () => memoryStorage() as unknown as Storage });
    const goTo = (next: string) => {
      farm.travelStarted();
      map = next;
      state.spawnSites.splice(0, state.spawnSites.length, ...(next === 'town' ? [] : forestSites));
      Object.assign(state.player, next === 'town' ? TOWN_ARRIVAL : { x: 500, y: 500 });
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
    expect(s.farm.mine!.state().status).toBe('Auto Mine Works in the Town');
    expect(s.farm.movement(none, DT)).toEqual(none);
  });
});

describe('after an update reload', () => {
  function tab(resume: Map<string, string>, options: { identity?: string; map?: string; connection?: 'ready' | 'recovering' | 'ended' } = {}) {
    const world = { map: options.map ?? 'town', connection: options.connection ?? 'ready' as 'ready' | 'recovering' | 'ended' };
    const resumeStorage = { getItem: (key: string) => resume.get(key) ?? null, setItem: (key: string, value: string) => { resume.set(key, value); },
      removeItem: (key: string) => { resume.delete(key); } };
    const source = { hasPickaxe: () => true, minedNodeAt: () => null, serverNowMs: () => 5_000_000, savedProgress: () => ({}) };
    const mine = createAutoMine({ player: { ...TOWN_ARRIVAL } as PlayerState, mapId: () => world.map, source: () => source,
      storage: () => memoryStorage(), resumeStorage: () => resumeStorage, identity: () => options.identity ?? 'me',
      connection: () => world.connection, speed: () => SPEED, now: () => 0 });
    return { mine, world };
  }
  it('comes back on in the new page once connected in the Town', () => {
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
  it('stays off after Stop, after leaving the Town, and for another player', () => {
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
  });
});
