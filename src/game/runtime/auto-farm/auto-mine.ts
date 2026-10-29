import { ARCANE_CRYSTAL } from '../../../../shared/crafting';
import {
  MINING_NODES, MINING_NODE_KINDS, MINING_REACH, MINING_VEINS, canMineRock, miningNodeName, miningRockNeed, type MiningNode, type RockOreId,
} from '../../../../shared/mining';
import { gatherRespawnMs } from '../../../../shared/gather-respawn';
import { rockOreKinds } from '../../../../shared/ore-bag';
import { REFINE_ORES } from '../../../../shared/refine';
import { inTownHills } from '../../../../shared/town';
import { miningScene } from '../town/mining-scene';
import { townFeetClear, type TownPoint } from '../town/town-path';
import { createAutoGather, gatherClock, regrowsAt, type AutoGatherOptions } from './auto-gather';

/** The ores picked to mine, per device, as Auto Farm's sliders are. v2 added Arcane Crystal; v1's picks carry over with it on. */
export const AUTO_MINE_ORES_KEY = 'wildstat:automine-ores:v2';
const AUTO_MINE_ORES_V1_KEY = 'wildstat:automine-ores:v1';
/** Whose Auto Mine was on, kept where Auto Farm keeps its own, so an update's reload carries on mining. */
export const AUTO_MINE_RESUME_KEY = 'wildstat:automine-resume:v1';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** What Auto Mine can be set to: an ore's rocks, or the Starshard, which only Mysterious rocks give. */
export type MinePick = RockOreId | typeof STARSHARD;
const STARSHARD = 'starshard';
/** Whether a rock gives a picked ore: its own, or a Starshard when it is Mysterious. */
const givesPick = (node: MiningNode, picks: ReadonlySet<MinePick>) => picks.has(node.ore) || (node.kind === 'mysterious' && picks.has(STARSHARD));

/** What Auto Mine reads of the session: Mining, the player's bare rocks and the server's clock. */
export type AutoMineSource = {
  mining?: () => number;
  minedNodeAt?: (nodeId: number) => number | null;
  serverNowMs?: () => number;
  /** The player's research: Resource Respawn shortens how long rocks and trees take to grow back (shared/gather-respawn.ts). */
  research?: () => { resourceRespawn?: number };
  /** Keeps the picks for time away, which is split over them (shared/offline-gathering.ts). */
  setGatherPicks?: (kind: 'mine' | 'chop', ids: readonly string[]) => void;
};

/** Where feet stand to mine a rock, from its foot: in front of the stone, else to either side; each within reach. */
const STAND_SPOTS: readonly (readonly [number, number])[] = [[0, 44], [-44, 34], [44, 34]];

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
 * The rock to go to: the nearest of the picked ores the player may mine, that is not bare; with every one bare, the
 * one that grows back first (`readyAt`). Null when no such rock stands anywhere.
 */
export function chooseMiningRock(options: {
  feet: TownPoint;
  /** The ores picked: a vein's ore, Arcane Crystal for the crystal rocks, or the Starshard for Mysterious rocks. */
  ores: ReadonlySet<MinePick>;
  /** Whether the player may mine this rock now: Mining enough for it, room in the bag. */
  open: (node: MiningNode) => boolean;
  /** When a rock grows back for the player, or null when it stands now. */
  bareUntil: (node: MiningNode) => number | null;
}): { node: MiningNode; readyAt: number | null } | null {
  let nearest: MiningNode | null = null, nearestDistance = Infinity;
  let soonest: MiningNode | null = null, soonestAt = Infinity;
  for (const node of MINING_NODES) {
    if (!givesPick(node, options.ores) || !options.open(node)) continue;
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

/** Every ore it can be set to mine, in the window's order: the veins', the crystal rocks', then the Starshard. */
const PICKABLE: readonly MinePick[] = [...MINING_VEINS.map(vein => vein.ore), ARCANE_CRYSTAL, STARSHARD];
const FIRST_PICKS: MinePick[] = ['copper_ore', ARCANE_CRYSTAL];
function readOres(storage: () => Store | undefined): MinePick[] {
  try {
    const saved = storage()?.getItem(AUTO_MINE_ORES_KEY), old = saved == null ? storage()?.getItem(AUTO_MINE_ORES_V1_KEY) : null;
    if (saved == null && old == null) return FIRST_PICKS;
    const parsed: unknown = JSON.parse((saved ?? old)!);
    if (!Array.isArray(parsed)) return FIRST_PICKS;
    return PICKABLE.filter(ore => parsed.includes(ore) || (saved == null && ore === ARCANE_CRYSTAL));
  } catch { return FIRST_PICKS; }
}

/** Whether the player is in the Copper Hills, as far out as the mining runtime works: where Auto Mine's button shows. */
export const inMiningArea = (x: number, y: number) => inTownHills(x, y, MINING_REACH * 2);

/**
 * Auto Mine: in the Copper Hills, stands by the nearest rock of the picked ores while the mining runtime mines it,
 * then the next (auto-gather.ts walks it), crystal rocks too once Mining allows. Rocks whose ore finds no bag room
 * are passed over; with none left it stops. The player's own keys always win; leaving the hills stops it.
 */
export function createAutoMine(options: AutoGatherOptions & {
  source: () => AutoMineSource | null | undefined;
  storage?: () => Store | undefined;
}) {
  const storage = options.storage ?? (() => { try { return window.localStorage; } catch { return undefined; } });
  let picked = new Set<MinePick>(readOres(storage));
  options.source()?.setGatherPicks?.('mine', [...picked]);
  /** What a rock gives, for rocks found with no bag room this run: passed over until it is started again. */
  const full = new Set<string>();
  const bagKey = (node: MiningNode) => rockOreKinds(node).join('+');
  const serverNow = () => options.source()?.serverNowMs?.() ?? Date.now();
  /** The shared gate, as the mining runtime and the server check it: the rock's Mining. */
  const allowed = (node: MiningNode) => canMineRock(node, options.source()?.mining?.() ?? 0);
  const minable = (node: MiningNode) => givesPick(node, picked) && allowed(node);
  const open = (node: MiningNode) => allowed(node) && !full.has(bagKey(node));
  function bareUntil(node: MiningNode, at = serverNow()) {
    const respawn = gatherRespawnMs(MINING_NODE_KINDS[node.kind].respawnSeconds, options.source()?.research?.().resourceRespawn ?? 0);
    return regrowsAt(options.source()?.minedNodeAt?.(node.id) ?? null, respawn, at, miningScene.bare.has(node.id));
  }

  const gather = createAutoGather<MiningNode>(options, {
    name: 'Auto Mine', area: 'the Copper Hills', resumeKey: AUTO_MINE_RESUME_KEY, inArea: inMiningArea,
    needs() {
      if (!MINING_NODES.some(minable)) return 'Pick an Ore to Mine';
      return null;
    },
    started: () => full.clear(),
    choose: feet => chooseMiningRock({ feet, ores: picked, open, bareUntil: node => bareUntil(node) }),
    stale: target => !givesPick(target.node, picked) || !open(target.node) || (target.readyAt === null && bareUntil(target.node) !== null),
    spot: node => miningStandSpot(node)!,
    arrived(target) {
      if (target.readyAt !== null) return { status: `Waiting for Rocks to Grow Back · ${gatherClock(target.readyAt - serverNow())}` };
      // The runtime found no room for what this rock gives: other rocks, or stop.
      if (miningScene.blocked === 'bag') {
        full.add(bagKey(target.node));
        return MINING_NODES.some(node => minable(node) && open(node)) ? { status: `Bag Full for ${miningNodeName(target.node)}` }
          : { status: 'Auto Mine Stopped: Bag Full', stop: true };
      }
      return { status: `Mining ${miningNodeName(target.node)}` };
    },
    walking: target => target.readyAt !== null ? 'Waiting for Rocks to Grow Back' : `Walking to ${miningNodeName(target.node)}`,
    noTarget: 'No Rocks of Your Ores',
  });

  return {
    ...gather,
    picked: (ore: MinePick) => picked.has(ore),
    setPicked(ore: MinePick, on: boolean) {
      const next = new Set(picked);
      if (on) next.add(ore); else next.delete(ore);
      picked = new Set(PICKABLE.filter(id => next.has(id)));
      try { storage()?.setItem(AUTO_MINE_ORES_KEY, JSON.stringify([...picked])); } catch { /* The picks still apply this session. */ }
      options.source()?.setGatherPicks?.('mine', [...picked]);
      const target = gather.state().target;
      if (target && !givesPick(target, picked)) gather.forget();
    },
    /**
     * Each ore for the window, the veins' then the crystal rocks': whether any of its rocks may be mined (or what opens
     * them), picked, and how many of those rocks stand now.
     */
    veins: () => {
      const at = serverNow();
      return PICKABLE.map(ore => {
        const rocks = MINING_NODES.filter(node => ore === STARSHARD ? node.kind === 'mysterious' : node.ore === ore), mayMine = rocks.filter(allowed);
        // The lowest Mining that opens any of its rocks: a crystal's first vein.
        const opensWith = `Mining ${Math.min(...rocks.map(miningRockNeed)).toLocaleString('en-US')}`;
        return { ore, name: REFINE_ORES[ore].name, open: mayMine.length > 0, opensWith, locked: `Opens at ${opensWith}`, picked: picked.has(ore),
          rocks: mayMine.length || rocks.length, standing: mayMine.filter(node => bareUntil(node, at) === null).length };
      });
    },
  };
}
export type AutoMine = ReturnType<typeof createAutoMine>;
