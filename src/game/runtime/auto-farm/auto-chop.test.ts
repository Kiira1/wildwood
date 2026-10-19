import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BagSpace } from '../../../../shared/ore-bag';
import { TOWN_ARRIVAL, TOWN_FEET_OFFSET, townRoomAt, townWalkClamp } from '../../../../shared/town';
import { WOOD_TREE_NODES, WOODCUTTING_REACH, WOODCUTTING_RESPAWN_SECONDS, type WoodTree } from '../../../../shared/woodcutting';
import { createGameBootstrap } from '../game-bootstrap';
import type { Movement } from '../player-input-controller';
import { pushOutOf, TOWN_FEET_RADIUS, TOWN_SOLIDS } from '../town/town-runtime';
import { planTownPath, townFeetClear } from '../town/town-path';
import { createWoodcuttingRuntime } from '../town/woodcutting-runtime';
import { resetWoodcuttingScene, woodcuttingScene } from '../town/woodcutting-scene';
import type { PlayerState } from '../types';
import { createAutoFarmController } from './auto-farm-controller';
import { AUTO_CHOP_TREES_KEY, chooseChoppingTree, choppingStandSpot, createAutoChop, inChoppingArea } from './auto-chop';

// Fells trees frame by frame: a second or so each, more on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const none: Movement = { x: 0, y: 0, source: 'none' };
const SPEED = 300, DT = 1 / 30;
const pines = WOOD_TREE_NODES.filter(tree => tree.kind === 'pine');
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
function memoryStorage(values = new Map<string, string>()) {
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
/** Where the walk out from the village comes into Timberwood, as a player stands (Auto Chop starts only there). */
const GROVE_ENTRY = (() => {
  const from = { x: TOWN_ARRIVAL.x, y: TOWN_ARRIVAL.y + TOWN_FEET_OFFSET };
  const path = [from, ...planTownPath(from, choppingStandSpot(pines[0])!)!];
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1], b = path[index], steps = Math.ceil(distance(a, b) / 4);
    for (let step = 0; step <= steps; step++) {
      const x = a.x + (b.x - a.x) * step / steps, y = a.y + (b.y - a.y) * step / steps - TOWN_FEET_OFFSET;
      if (inChoppingArea(x + 60, y)) return { x, y };
    }
  }
  throw new Error('The walk never comes into Timberwood');
})();

/**
 * A player in Timberwood, Auto Chop, the woodcutting runtime that fells what they stand by, and a frame step that
 * moves them as the game does (collision included).
 */
function setup(options: { woodcutting?: number; at?: { x: number; y: number }; storage?: ReturnType<typeof memoryStorage>; bag?: BagSpace } = {}) {
  const player = { ...(options.at ?? GROVE_ENTRY), moving: false, hp: 100 } as PlayerState;
  const world = { map: 'town', time: 0, server: 5_000_000, felled: new Map<number, number>() };
  const storage = options.storage ?? memoryStorage();
  const chopTree = vi.fn(async (treeId: number) => { world.felled.set(treeId, world.server); return { ok: true }; });
  const source = {
    choppedTreeAt: (id: number) => world.felled.get(id) ?? null,
    serverNowMs: () => world.server, woodcutting: () => options.woodcutting ?? 0, chopTree,
  };
  const chop = createAutoChop({ player, mapId: () => world.map, source: () => source, storage: () => storage, speed: () => SPEED, now: () => world.time });
  const runtime = createWoodcuttingRuntime({ source: () => source, player, bag: options.bag ? () => options.bag : undefined });
  function move(movement: Movement) {
    player.moving = Boolean(movement.x || movement.y);
    player.x += movement.x * SPEED * DT; player.y += movement.y * SPEED * DT;
    const feet = { x: player.x, y: player.y + TOWN_FEET_OFFSET, r: TOWN_FEET_RADIUS };
    for (const solid of TOWN_SOLIDS) pushOutOf(feet, solid);
    if (!townRoomAt(player.x, player.y, 400)) Object.assign(feet, townWalkClamp(feet.x, feet.y));
    player.x = feet.x; player.y = feet.y - TOWN_FEET_OFFSET;
  }
  function step(manual: Movement = none) {
    const movement = chop.movement(manual, DT) ?? manual;
    move(movement);
    runtime.update(DT, true);
    world.time += DT * 1_000; world.server += DT * 1_000;
    return movement;
  }
  function runUntil(done: () => boolean, seconds = 60) {
    for (let frame = 0; frame < seconds / DT; frame++) { if (done()) return frame; step(); }
    return Infinity;
  }
  const feet = () => ({ x: player.x, y: player.y + TOWN_FEET_OFFSET });
  const at = (tree: WoodTree) => distance(feet(), choppingStandSpot(tree)!) <= 6;
  return { player, world, storage, chop, chopTree, step, runUntil, feet, at };
}

beforeEach(() => resetWoodcuttingScene());

describe('choosing the tree', () => {
  const feet = choppingStandSpot(pines[0])!;
  const kinds = new Set(['pine', 'oak'] as const);
  it('takes the nearest standing tree of a picked kind', () => {
    expect(chooseChoppingTree({ feet, kinds, open: () => true, felledUntil: () => null })).toEqual({ node: pines[0], readyAt: null });
  });
  it('skips stumps, and trees of kinds not picked or in stands not open', () => {
    expect(chooseChoppingTree({ feet, kinds: new Set(['oak']), open: () => true, felledUntil: () => null })!.node.kind).toBe('oak');
    expect(chooseChoppingTree({ feet, kinds: new Set(['oak']), open: stand => stand.kind === 'pine', felledUntil: () => null })).toBeNull();
    const next = chooseChoppingTree({ feet, kinds, open: stand => stand.kind === 'pine', felledUntil: tree => tree === pines[0] ? 1 : null })!;
    const rest = pines.slice(1).sort((a, b) => distance(choppingStandSpot(a)!, feet) - distance(choppingStandSpot(b)!, feet));
    expect(next.node).toBe(rest[0]);
  });
  it('with every tree felled, waits for the one that grows back first', () => {
    const soonest = pines[5];
    expect(chooseChoppingTree({ feet, kinds, open: stand => stand.kind === 'pine', felledUntil: tree => tree === soonest ? 1_000 : 9_000 + tree.id }))
      .toEqual({ node: soonest, readyAt: 1_000 });
  });
  it('stands every tree\'s woodcutter on clear ground in its reach and no other tree\'s', () => {
    for (const tree of WOOD_TREE_NODES) {
      const spot = choppingStandSpot(tree)!;
      expect(spot, `tree ${tree.id}`).not.toBeNull();
      expect(townFeetClear(spot.x, spot.y)).toBe(true);
      expect(WOOD_TREE_NODES.filter(other => distance(other, spot) <= WOODCUTTING_REACH)).toEqual([tree]);
    }
  });
  it('keeps every walk from tree to tree inside Timberwood', () => {
    const from = choppingStandSpot(pines[0])!;
    for (const tree of WOOD_TREE_NODES) {
      const path = planTownPath(from, choppingStandSpot(tree)!)!;
      expect(path, `tree ${tree.id}`).not.toBeNull();
      for (const point of path) expect(inChoppingArea(point.x, point.y - TOWN_FEET_OFFSET), `tree ${tree.id}`).toBe(true);
    }
  });
});

describe('Auto Chop', () => {
  it('walks to the nearest pine, holds still while the woodcutting runtime fells it, then goes on to the next', () => {
    const s = setup();
    expect(s.chop.start()).toBe(true);
    s.step();
    const first = s.chop.state().target!;
    expect(first.kind).toBe('pine');
    expect(s.chop.state().status).toBe('Walking to Pine Tree');
    expect(s.runUntil(() => s.at(first))).toBeLessThan(60 / DT);
    s.step();
    expect(s.chop.state().status).toBe('Chopping Pine Tree');
    expect(woodcuttingScene.target).toBe(first.id);
    // Felled by the runtime standing there: the server is asked, and it walks on to another pine.
    s.runUntil(() => s.chopTree.mock.calls.length > 0, 20);
    expect(s.chopTree).toHaveBeenCalledExactlyOnceWith(first.id);
    s.step();
    const next = s.chop.state().target!;
    expect(next).not.toBe(first);
    expect(next.kind).toBe('pine');
    expect(s.runUntil(() => s.at(next), 30)).toBeLessThan(30 / DT);
  });

  it('waits by the first tree to grow back when every pine is a stump', () => {
    const s = setup();
    const respawn = WOODCUTTING_RESPAWN_SECONDS * 1_000;
    pines.forEach((tree, index) => s.world.felled.set(tree.id, s.world.server - respawn + 60_000 + index * 1_000));
    s.chop.start();
    s.step();
    expect(s.chop.state().target).toBe(pines[0]);
    s.runUntil(() => s.at(pines[0]));
    s.step();
    expect(s.chop.state().status).toMatch(/^Waiting for Trees to Grow Back · \d+:\d\d$/);
  });

  it('gives way to the player\'s own keys, and carries on when they let go', () => {
    const s = setup();
    s.chop.start();
    s.runUntil(() => false, .5);
    const manual: Movement = { x: 0, y: 1, source: 'keyboard' };
    expect(s.step(manual)).toBe(manual);
    expect(s.chop.state()).toMatchObject({ active: true, status: 'Manual Control' });
    for (let frame = 0; frame < 10; frame++) s.step(manual);
    expect(s.step().source).toBe('steer');
    expect(s.chop.state().status).toBe('Walking to Pine Tree');
  });

  it('passes over a kind with no bag room, and stops once no kind has any', () => {
    // Oak logs held, no free slot: oak still comes in, pine does not.
    const bag = { owned: [], equipped: [], extraCopies: 0, ores: { oak_log: 4 }, capacity: 1 };
    const s = setup({ woodcutting: 50, bag });
    s.chop.setPicked('oak', true);
    s.chop.start();
    s.step();
    expect(s.chop.state().target!.kind).toBe('pine');
    s.runUntil(() => s.chop.state().target?.kind === 'oak');
    expect(s.chop.state().active).toBe(true);
    const oak = s.chop.state().target!;
    expect(s.runUntil(() => s.at(oak))).toBeLessThan(60 / DT);
    s.step(); s.step();
    expect(s.chop.state().status).toBe('Chopping Oak Tree');

    const full = setup({ bag: { owned: [], equipped: [], extraCopies: 0, ores: {}, capacity: 0 } });
    full.chop.start();
    full.runUntil(() => !full.chop.state().active);
    expect(full.chop.state()).toMatchObject({ active: false, status: 'Auto Chop Stopped: Bag Full' });
    expect(full.chopTree).not.toHaveBeenCalled();
  });

  it('says what it needs: a tree picked, a stand its Woodcutting opens; never a hatchet, which every player holds', () => {
    const s = setup();
    s.chop.setPicked('pine', false);
    expect(s.chop.start()).toBe(false);
    expect(s.chop.state().status).toBe('Pick a Tree to Chop');
    s.chop.setPicked('oak', true);
    expect(s.chop.start()).toBe(false);
    expect(s.chop.stands().find(stand => stand.kind === 'oak')).toMatchObject({ open: false, opensWith: 'Woodcutting 50', locked: 'Opens at Woodcutting 50', picked: true });
    expect(s.chop.stands().find(stand => stand.kind === 'elder')).toMatchObject({ open: false, locked: 'Opens at Woodcutting 900' });
    const open = setup({ woodcutting: 50, storage: s.storage });
    expect(open.chop.start()).toBe(true);
    open.step();
    expect(open.chop.state().target!.kind).toBe('oak');
  });

  it('remembers the trees picked on this device, Pine to start with', () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    expect(first.chop.stands().filter(stand => stand.picked).map(stand => stand.kind)).toEqual(['pine']);
    first.chop.setPicked('yew', true);
    first.chop.setPicked('pine', false);
    expect(JSON.parse(storage.values.get(AUTO_CHOP_TREES_KEY)!)).toEqual(['yew']);
    expect(setup({ storage }).chop.stands().filter(stand => stand.picked).map(stand => stand.kind)).toEqual(['yew']);
  });

  it('starts only in Timberwood, and stops when the player walks out of it or leaves the Town', () => {
    const village = setup({ at: TOWN_ARRIVAL });
    expect(village.chop.start()).toBe(false);
    expect(village.chop.state()).toMatchObject({ active: false, status: 'Auto Chop Works in Timberwood' });
    const s = setup();
    expect(s.chop.start()).toBe(true);
    const east: Movement = { x: 1, y: 0, source: 'keyboard' };
    for (let frame = 0; frame < 3 / DT && s.chop.state().active; frame++) s.step(east);
    expect(inChoppingArea(s.player.x, s.player.y)).toBe(false);
    expect(s.chop.state()).toMatchObject({ active: false, status: 'Auto Chop Stopped: Left Timberwood' });
    s.player.x = GROVE_ENTRY.x; s.player.y = GROVE_ENTRY.y;
    expect(s.chop.movement(none, DT)).toBeNull();
    expect(s.chop.state().active).toBe(false);

    const travelled = setup();
    travelled.chop.start();
    travelled.chop.travelStarted();
    expect(travelled.chop.state()).toMatchObject({ active: false, status: 'Auto Chop Stopped: Left the Town' });
  });
});

describe('Auto Chop inside Auto Farm', () => {
  it('steers in Timberwood, and Auto Mine stays out of it', () => {
    const state = createGameBootstrap();
    state.enemies.length = 0; state.spawnSites.length = 0;
    Object.assign(state.player, { ...GROVE_ENTRY, speed: SPEED });
    const source = { minedNodeAt: () => null, choppedTreeAt: () => null, serverNowMs: () => 5_000_000 };
    const farm = createAutoFarmController({ ...state, mapId: () => 'town', unavailable: () => null, paused: () => false, speed: () => SPEED, obstacles: () => [],
      localIdentity: () => 'me', now: () => 0, mining: () => source, priorityStorage: () => memoryStorage() as unknown as Storage });
    expect(farm.mine!.start()).toBe(false);
    expect(farm.mine!.state().status).toBe('Auto Mine Works in the Copper Hills');
    expect(farm.chop!.start()).toBe(true);
    expect(farm.movement(none, DT).source).toBe('steer');
    expect(farm.chop!.state().status).toBe('Walking to Pine Tree');
    farm.travelStarted();
    expect(farm.chop!.state()).toMatchObject({ active: false, status: 'Auto Chop Stopped: Left the Town' });
  });
});

describe('after an update reload', () => {
  function tab(resume: Map<string, string>, options: { identity?: string; connection?: 'ready' | 'recovering'; at?: { x: number; y: number } } = {}) {
    const world = { connection: options.connection ?? 'ready' as 'ready' | 'recovering' };
    const resumeStorage = { getItem: (key: string) => resume.get(key) ?? null, setItem: (key: string, value: string) => { resume.set(key, value); },
      removeItem: (key: string) => { resume.delete(key); } };
    const source = { choppedTreeAt: () => null, serverNowMs: () => 5_000_000 };
    const chop = createAutoChop({ player: { ...(options.at ?? GROVE_ENTRY) } as PlayerState, mapId: () => 'town', source: () => source,
      storage: () => memoryStorage(), resumeStorage: () => resumeStorage, identity: () => options.identity ?? 'me',
      connection: () => world.connection, speed: () => SPEED, now: () => 0 });
    return { chop, world };
  }
  it('comes back on once connected in Timberwood, and not when the page comes back elsewhere or after Stop', () => {
    const resume = new Map<string, string>();
    expect(tab(resume).chop.start()).toBe(true);
    const reloaded = tab(resume, { connection: 'recovering' });
    expect(reloaded.chop.state()).toMatchObject({ active: false, waiting: true, status: 'Resuming Auto Chop' });
    reloaded.chop.movement(none, DT);
    expect(reloaded.chop.state().active).toBe(false);
    reloaded.world.connection = 'ready';
    reloaded.chop.movement(none, DT);
    expect(reloaded.chop.state().active).toBe(true);

    const village = tab(resume, { at: TOWN_ARRIVAL });
    village.chop.movement(none, DT);
    expect(village.chop.state()).toMatchObject({ active: false, waiting: false });

    const stopped = new Map<string, string>();
    const first = tab(stopped);
    first.chop.start(); first.chop.stop();
    const afterStop = tab(stopped); afterStop.chop.movement(none, DT);
    expect(afterStop.chop.state().active).toBe(false);
  });
});
