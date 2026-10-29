import { inTownGrove } from '../../../../shared/town';
import {
  WOOD_STANDS, WOOD_TREE_KINDS, WOOD_TREE_NODES, WOOD_TREE_SPOTS, WOODCUTTING_REACH, WOODCUTTING_RESPAWN_SECONDS, canChopStand,
  type WoodStand, type WoodTree, type WoodTreeKind,
} from '../../../../shared/woodcutting';
import { gatherRespawnMs } from '../../../../shared/gather-respawn';
import { townFeetClear, type TownPoint } from '../town/town-path';
import { woodcuttingScene } from '../town/woodcutting-scene';
import { createAutoGather, gatherClock, regrowsAt, type AutoGatherOptions } from './auto-gather';

/** The trees picked to chop, per device, as Auto Mine's ores are. */
export const AUTO_CHOP_TREES_KEY = 'wildstat:autochop-trees:v1';
/** Whose Auto Chop was on, kept as Auto Mine's is, so an update's reload carries on chopping. */
export const AUTO_CHOP_RESUME_KEY = 'wildstat:autochop-resume:v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** What Auto Chop reads of the session: Woodcutting, the player's stumps and the server's clock. */
export type AutoChopSource = {
  woodcutting?: () => number;
  choppedTreeAt?: (treeId: number) => number | null;
  serverNowMs?: () => number;
  /** The player's research: Resource Respawn shortens how long rocks and trees take to grow back (shared/gather-respawn.ts). */
  research?: () => { resourceRespawn?: number };
  /** Keeps the picks for time away, which is split over them (shared/offline-gathering.ts). */
  setGatherPicks?: (kind: 'mine' | 'chop', ids: readonly string[]) => void;
};

/** Whether the player is in Timberwood, as far out as the woodcutting runtime works: where Auto Chop's button shows. */
export const inChoppingArea = (x: number, y: number) => inTownGrove(x, y, WOODCUTTING_REACH * 2);

/** The grove's own spots to chop from (shared/woodcutting.ts), in front of the tree first. */
const STAND_SPOTS = [...WOOD_TREE_SPOTS].sort((a, b) => b.y - a.y);
const standSpots = new Map<number, TownPoint | null>();
/** Where feet stand to chop this tree: the first clear spot in its reach and no other tree's (null if none is). */
export function choppingStandSpot(tree: WoodTree): TownPoint | null {
  if (!standSpots.has(tree.id)) {
    const spot = STAND_SPOTS.map(({ x, y }) => ({ x: tree.x + x, y: tree.y + y }))
      .find(at => Math.hypot(at.x - tree.x, at.y - tree.y) < WOODCUTTING_REACH - 8 && townFeetClear(at.x, at.y)
        && WOOD_TREE_NODES.every(other => other === tree || Math.hypot(other.x - at.x, other.y - at.y) > WOODCUTTING_REACH)) ?? null;
    standSpots.set(tree.id, spot);
  }
  return standSpots.get(tree.id)!;
}

/**
 * The tree to go to: the nearest of the picked kinds, in an open stand, that is not a stump; with every one felled,
 * the one that grows back first (`readyAt`). Null when no tree is of a picked kind in an open stand.
 */
export function chooseChoppingTree(options: {
  feet: TownPoint;
  kinds: ReadonlySet<WoodTreeKind>;
  open: (stand: WoodStand) => boolean;
  /** When a tree grows back for the player, or null when it stands now. */
  felledUntil: (tree: WoodTree) => number | null;
}): { node: WoodTree; readyAt: number | null } | null {
  let nearest: WoodTree | null = null, nearestDistance = Infinity;
  let soonest: WoodTree | null = null, soonestAt = Infinity;
  for (const tree of WOOD_TREE_NODES) {
    if (!options.kinds.has(tree.kind) || !options.open(WOOD_STANDS[tree.stand])) continue;
    const spot = choppingStandSpot(tree);
    if (!spot) continue;
    const until = options.felledUntil(tree);
    if (until === null) {
      const distance = Math.hypot(spot.x - options.feet.x, spot.y - options.feet.y);
      if (distance < nearestDistance) { nearest = tree; nearestDistance = distance; }
    } else if (until < soonestAt) { soonest = tree; soonestAt = until; }
  }
  if (nearest) return { node: nearest, readyAt: null };
  return soonest ? { node: soonest, readyAt: soonestAt } : null;
}

function readKinds(storage: () => Store | undefined): WoodTreeKind[] {
  try {
    const saved = storage()?.getItem(AUTO_CHOP_TREES_KEY);
    if (saved == null) return ['pine'];
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? WOOD_TREE_KINDS.filter(kind => parsed.includes(kind)) : ['pine'];
  } catch { return ['pine']; }
}

/**
 * Auto Chop: in Timberwood, stands by the nearest tree of the picked kinds while the woodcutting runtime fells it,
 * then the next, as Auto Mine does in the hills. A kind with no bag room is passed over; with none left it stops.
 */
export function createAutoChop(options: AutoGatherOptions & {
  source: () => AutoChopSource | null | undefined;
  storage?: () => Store | undefined;
}) {
  const storage = options.storage ?? (() => { try { return window.localStorage; } catch { return undefined; } });
  let picked = new Set<WoodTreeKind>(readKinds(storage));
  options.source()?.setGatherPicks?.('chop', [...picked]);
  /** Kinds whose logs found no bag room this run: passed over until it is started again. */
  const full = new Set<WoodTreeKind>();
  const serverNow = () => options.source()?.serverNowMs?.() ?? Date.now();
  /** The shared gate, as the woodcutting runtime and the server check it: the stand's Woodcutting. */
  const open = (stand: WoodStand) => canChopStand(stand, options.source()?.woodcutting?.() ?? 0);
  function felledUntil(tree: WoodTree, at = serverNow()) {
    const respawn = gatherRespawnMs(WOODCUTTING_RESPAWN_SECONDS, options.source()?.research?.().resourceRespawn ?? 0);
    return regrowsAt(options.source()?.choppedTreeAt?.(tree.id) ?? null, respawn, at, woodcuttingScene.felled.has(tree.id));
  }
  const pickedOpen = () => WOOD_STANDS.filter(stand => picked.has(stand.kind) && open(stand));
  const choppable = () => pickedOpen().filter(stand => !full.has(stand.kind));

  const gather = createAutoGather<WoodTree>(options, {
    name: 'Auto Chop', area: 'Timberwood', resumeKey: AUTO_CHOP_RESUME_KEY, inArea: inChoppingArea,
    needs() {
      if (!pickedOpen().length) return 'Pick a Tree to Chop';
      return null;
    },
    started: () => full.clear(),
    choose: feet => chooseChoppingTree({ feet, kinds: new Set(choppable().map(stand => stand.kind)), open, felledUntil: tree => felledUntil(tree) }),
    stale: target => !picked.has(target.node.kind) || full.has(target.node.kind) || !open(WOOD_STANDS[target.node.stand])
      || (target.readyAt === null && felledUntil(target.node) !== null),
    spot: tree => choppingStandSpot(tree)!,
    arrived(target) {
      const stand = WOOD_STANDS[target.node.stand];
      if (target.readyAt !== null) return { status: `Waiting for Trees to Grow Back · ${gatherClock(target.readyAt - serverNow())}` };
      // The runtime found no room for this log: another kind, or stop.
      if (woodcuttingScene.blocked === 'bag') {
        full.add(stand.kind);
        return choppable().length ? { status: `Bag Full for ${stand.name}s` } : { status: 'Auto Chop Stopped: Bag Full', stop: true };
      }
      return { status: `Chopping ${stand.name}` };
    },
    walking: target => target.readyAt !== null ? 'Waiting for Trees to Grow Back' : `Walking to ${WOOD_STANDS[target.node.stand].name}`,
    noTarget: 'No Trees of Your Kinds',
  });

  return {
    ...gather,
    picked: (kind: WoodTreeKind) => picked.has(kind),
    setPicked(kind: WoodTreeKind, on: boolean) {
      const next = new Set(picked);
      if (on) next.add(kind); else next.delete(kind);
      picked = new Set(WOOD_TREE_KINDS.filter(id => next.has(id)));
      try { storage()?.setItem(AUTO_CHOP_TREES_KEY, JSON.stringify([...picked])); } catch { /* The picks still apply this session. */ }
      options.source()?.setGatherPicks?.('chop', [...picked]);
      const target = gather.state().target;
      if (target && !picked.has(target.kind)) gather.forget();
    },
    /** Each stand for the window: its trees, whether it is open (or the Woodcutting that opens it), picked, and how many stand now. */
    stands: () => {
      const at = serverNow();
      return WOOD_STANDS.map(stand => {
        const trees = WOOD_TREE_NODES.filter(tree => tree.kind === stand.kind), opensWith = `Woodcutting ${stand.woodcutting.toLocaleString('en-US')}`;
        return { kind: stand.kind, name: `${stand.name}s`, open: open(stand), opensWith, locked: `Opens at ${opensWith}`, picked: picked.has(stand.kind),
          trees: trees.length, standing: trees.filter(tree => felledUntil(tree, at) === null).length };
      });
    },
  };
}
export type AutoChop = ReturnType<typeof createAutoChop>;
