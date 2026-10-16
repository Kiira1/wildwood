import type { CampaignAccess } from '../../../../shared/equipment-access';
import {
  MINING_NODES, MINING_NODE_KINDS, MINING_REACH, MINING_VEINS, miningNodeName, miningVeinMap, miningVeinOpen, type MiningNode, type MiningVein, type VeinOreId,
} from '../../../../shared/mining';
import { REFINE_ORES } from '../../../../shared/refine';
import { inTownHills, isTownMap, townRoomAt, TOWN_FEET_OFFSET } from '../../../../shared/town';
import { monotonicNowMs } from '../../../app/trusted-clock';
import type { Movement } from '../player-input-controller';
import { miningScene } from '../town/mining-scene';
import { planTownPath, townFeetClear, type TownPoint } from '../town/town-path';
import type { PlayerState } from '../types';

/** The ores picked to mine, per device, as Auto Farm's sliders are. */
export const AUTO_MINE_ORES_KEY = 'wildstat:automine-ores:v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** What Auto Mine reads of the session: the pickaxe, the player's bare rocks, the server's clock and the unlocks. */
export type AutoMineSource = {
  hasPickaxe?: () => boolean;
  minedNodeAt?: (nodeId: number) => number | null;
  serverNowMs?: () => number;
  savedProgress?: () => CampaignAccess | null | undefined;
};

/** Where feet stand to mine a rock, from its foot: in front of the stone, else to either side; each within reach. */
const STAND_SPOTS: readonly (readonly [number, number])[] = [[0, 44], [-44, 34], [44, 34]];
/** Feet this close to the spot have arrived; a waypoint this close is passed. */
const ARRIVED = 6, WAYPOINT_REACHED = 8;
/** Walking that gains less than this in STUCK_MS is stuck, and the way is planned again. */
const STUCK_GAIN = 4, STUCK_MS = 1_500;
/** How often the rocks are looked over again, and a failed plan tried again. */
const CHOOSE_SECONDS = .5, REPLAN_MS = 1_000;

const standSpots = new Map<number, TownPoint | null>();
/** Where feet stand to mine this rock: the first clear spot by it (null if none is). */
export function miningStandSpot(node: MiningNode): TownPoint | null {
  if (!standSpots.has(node.id)) {
    const spot = STAND_SPOTS.map(([dx, dy]) => ({ x: node.x + dx, y: node.y + dy }))
      .find(at => Math.hypot(at.x - node.x, at.y - node.y) < MINING_REACH - 8 && townFeetClear(at.x, at.y)) ?? null;
    standSpots.set(node.id, spot);
  }
  return standSpots.get(node.id)!;
}

/**
 * The rock to go to: the nearest of the picked ores, in an open vein, that is not bare; with every one bare, the
 * one that grows back first (`readyAt`). Null when no rock is of a picked ore in an open vein.
 */
export function chooseMiningRock(options: {
  feet: TownPoint;
  ores: ReadonlySet<VeinOreId>;
  open: (vein: MiningVein) => boolean;
  /** When a rock grows back for the player, or null when it stands now. */
  bareUntil: (node: MiningNode) => number | null;
}): { node: MiningNode; readyAt: number | null } | null {
  let nearest: MiningNode | null = null, nearestDistance = Infinity;
  let soonest: MiningNode | null = null, soonestAt = Infinity;
  for (const node of MINING_NODES) {
    if (!options.ores.has(node.ore) || !options.open(MINING_VEINS[node.vein])) continue;
    const spot = miningStandSpot(node);
    if (!spot) continue;
    const until = options.bareUntil(node);
    if (until === null) {
      const distance = Math.hypot(spot.x - options.feet.x, spot.y - options.feet.y);
      if (distance < nearestDistance) { nearest = node; nearestDistance = distance; }
    } else if (until < soonestAt) { soonest = node; soonestAt = until; }
  }
  if (nearest) return { node: nearest, readyAt: null };
  return soonest ? { node: soonest, readyAt: soonestAt } : null;
}

const idle = (): Movement => ({ x: 0, y: 0, source: 'none' });
const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

function readOres(storage: () => Store | undefined): VeinOreId[] {
  try {
    const saved = storage()?.getItem(AUTO_MINE_ORES_KEY);
    if (saved == null) return ['copper_ore'];
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? MINING_VEINS.map(vein => vein.ore).filter(ore => parsed.includes(ore)) : ['copper_ore'];
  } catch { return ['copper_ore']; }
}

/**
 * Auto Mine: walks out to the Copper Hills and stands by the nearest rock of the picked ores while the mining
 * runtime mines it, then the next. The player's own keys always win; leaving the Town stops it.
 */
export function createAutoMine(options: {
  player: PlayerState;
  mapId: () => string;
  source: () => AutoMineSource | null | undefined;
  storage?: () => Store | undefined;
  unavailable?: () => string | null;
  connection?: () => 'ready' | 'recovering' | 'ended';
  paused?: () => boolean;
  speed?: () => number;
  now?: () => number;
  plan?: (from: TownPoint, to: TownPoint) => TownPoint[] | null;
}) {
  const { player } = options;
  const storage = options.storage ?? (() => { try { return window.localStorage; } catch { return undefined; } });
  const now = options.now ?? monotonicNowMs;
  const plan = options.plan ?? planTownPath;
  let picked = new Set(readOres(storage));
  let active = false;
  let status = 'Off';
  let target: { node: MiningNode; readyAt: number | null } | null = null;
  let chooseClock = 0;
  let route: TownPoint[] = [];
  let goal: TownPoint | null = null;
  let planFailedAt = -Infinity;
  /** The headway towards the current waypoint: the closest yet, and when. */
  let progress: { at: number; distance: number; waypoint: TownPoint | null } = { at: 0, distance: Infinity, waypoint: null };

  const serverNow = () => options.source()?.serverNowMs?.() ?? Date.now();
  const access = () => options.source()?.savedProgress?.();
  const open = (vein: MiningVein) => miningVeinOpen(vein, access());
  const feet = (): TownPoint => ({ x: player.x, y: player.y + TOWN_FEET_OFFSET });
  function bareUntil(node: MiningNode, at = serverNow()) {
    const respawn = MINING_NODE_KINDS[node.kind].respawnSeconds * 1_000;
    const brokenAt = options.source()?.minedNodeAt?.(node.id) ?? null;
    if (brokenAt !== null && at - brokenAt < respawn) return brokenAt + respawn;
    // Broken here a moment ago, before the server lists it.
    return miningScene.bare.has(node.id) ? at + respawn : null;
  }
  const pickedOpen = () => MINING_VEINS.filter(vein => picked.has(vein.ore) && open(vein));

  /** Why it cannot mine now, or null. */
  function problem() {
    if (!isTownMap(options.mapId())) return 'Auto Mine Works in the Town';
    if (!options.source()?.hasPickaxe?.()) return 'Get a Pickaxe from the Smith';
    if (!pickedOpen().length) return 'Pick an Ore to Mine';
    return null;
  }

  function forget() { target = null; route = []; goal = null; chooseClock = 0; progress = { at: 0, distance: Infinity, waypoint: null }; }
  function stop(reason = 'Auto Mine Stopped') {
    active = false;
    status = reason;
    forget();
  }
  function start() {
    if (options.connection && options.connection() !== 'ready') { stop('Connect to the Server to Mine'); return false; }
    const reason = options.unavailable?.() ?? problem();
    if (reason) { stop(reason); return false; }
    forget();
    active = true;
    status = 'Starting';
    return true;
  }

  /** Steps along the planned walk to `to` (feet); re-plans for a new goal, an empty walk, or no headway. */
  function walk(to: TownPoint, dt: number): Movement {
    const at = feet(), clockNow = now();
    if (!goal || Math.hypot(goal.x - to.x, goal.y - to.y) > 1) { goal = to; route = []; planFailedAt = -Infinity; }
    if (!route.length) {
      if (clockNow - planFailedAt < REPLAN_MS) return idle();
      const planned = plan(at, to);
      if (!planned) { planFailedAt = clockNow; status = 'No Way There'; return idle(); }
      route = planned;
    }
    while (route.length > 1 && Math.hypot(route[0].x - at.x, route[0].y - at.y) < WAYPOINT_REACHED) route.shift();
    const waypoint = route[0], distance = Math.hypot(waypoint.x - at.x, waypoint.y - at.y);
    if (waypoint !== progress.waypoint || distance < progress.distance - STUCK_GAIN) progress = { at: clockNow, distance, waypoint };
    else if (clockNow - progress.at > STUCK_MS) { route = []; progress.waypoint = null; return idle(); }
    const step = Math.max(1, (options.speed?.() ?? 300) * dt), magnitude = Math.min(1, distance / step);
    return { x: (waypoint.x - at.x) / Math.max(distance, 1e-6) * magnitude, y: (waypoint.y - at.y) / Math.max(distance, 1e-6) * magnitude, source: 'steer' };
  }

  function movement(manual: Movement, dt: number): Movement | null {
    if (!active) return null;
    if (!isTownMap(options.mapId())) { stop('Auto Mine Stopped: Left the Town'); return null; }
    const connection = options.connection?.() ?? 'ready';
    if (connection === 'ended') { stop('Auto Mine Stopped for Sign-In'); return null; }
    if (manual.x || manual.y) { status = 'Manual Control'; route = []; goal = null; return manual; }
    if (connection === 'recovering') { status = 'Reconnecting'; route = []; goal = null; return idle(); }
    const reason = options.unavailable?.();
    if (reason) { stop(reason); return null; }
    if (options.paused?.()) { status = 'Paused'; return idle(); }
    const blocker = problem();
    if (blocker) { status = blocker; forget(); return idle(); }
    // In a house: out of its door first.
    const room = townRoomAt(player.x, player.y);
    if (room) {
      target = null;
      status = 'Leaving the House';
      const doorway = { x: room.exit.x, y: room.exit.y - 14 }, at = feet();
      // In the doorway: straight on down and out (the Town's runtime takes them through).
      if (Math.abs(at.x - doorway.x) < Math.min(12, room.exit.half) && at.y > doorway.y - 12) return { x: 0, y: 1, source: 'steer' };
      return walk(doorway, dt);
    }
    chooseClock -= dt;
    const stale = target && (!picked.has(target.node.ore) || !open(MINING_VEINS[target.node.vein]) || (target.readyAt === null && bareUntil(target.node) !== null));
    if (!target || stale || (target.readyAt !== null && chooseClock <= 0)) {
      target = chooseMiningRock({ feet: feet(), ores: new Set(pickedOpen().map(vein => vein.ore)), open, bareUntil: node => bareUntil(node) });
      chooseClock = CHOOSE_SECONDS;
    }
    if (!target) { status = 'No Rocks of Your Ores'; return idle(); }
    const spot = miningStandSpot(target.node)!, at = feet();
    if (Math.hypot(spot.x - at.x, spot.y - at.y) <= ARRIVED) {
      route = []; goal = null;
      const name = miningNodeName(target.node);
      status = target.readyAt !== null ? `Waiting for Rocks to Grow Back · ${clock(target.readyAt - serverNow())}`
        : miningScene.blocked === 'bag' ? 'Bag Full · Free a Slot for Ore' : `Mining ${name}`;
      return idle();
    }
    const moving = walk(spot, dt);
    if (moving.source === 'steer') {
      status = !inTownHills(at.x, at.y) ? 'Walking to the Copper Hills'
        : target.readyAt !== null ? 'Waiting for Rocks to Grow Back' : `Walking to ${miningNodeName(target.node)}`;
    }
    return moving;
  }

  return {
    start,
    stop,
    movement,
    /** Any travel: leaving the Town ends it, and it does not come back on its own. */
    travelStarted() { if (active) stop('Auto Mine Stopped: Left the Town'); },
    inTown: () => isTownMap(options.mapId()),
    problem,
    state: () => ({ active, status, target: target?.node ?? null }),
    picked: (ore: VeinOreId) => picked.has(ore),
    setPicked(ore: VeinOreId, on: boolean) {
      const next = new Set(picked);
      if (on) next.add(ore); else next.delete(ore);
      picked = new Set(MINING_VEINS.map(vein => vein.ore).filter(id => next.has(id)));
      try { storage()?.setItem(AUTO_MINE_ORES_KEY, JSON.stringify([...picked])); } catch { /* The picks still apply this session. */ }
      if (target && !picked.has(target.node.ore)) forget();
    },
    /** Each vein for the window: its ore, whether it is open (or the map that opens it), picked, and its rocks standing now. */
    veins: () => {
      const at = serverNow();
      return MINING_VEINS.map(vein => {
        const rocks = MINING_NODES.filter(node => node.ore === vein.ore);
        return { ore: vein.ore, name: REFINE_ORES[vein.ore].name, open: open(vein), opensWith: miningVeinMap(vein), picked: picked.has(vein.ore),
          rocks: rocks.length, standing: rocks.filter(node => bareUntil(node, at) === null).length };
      });
    },
  };
}
export type AutoMine = ReturnType<typeof createAutoMine>;
