import { campaignMapUnlocked, type CampaignAccess } from "./equipment-access";
import { REFINE_ORES, type OreId } from "./refine";
import { MAP_DISPLAY_NAMES, MAP_IDS } from "./rules";
import { TOWN_HILLS, townRandom } from "./town";

/**
 * Mining, in the Copper Hills east of the Town (TOWN_HILLS): walk up to an ore rock with a pickaxe and you mine it,
 * as you would attack, and it breaks into ore for the Smith's refines. Peaceful: no monsters, no dying (Ryan,
 * 2026-10-13, on a player's idea: "not the monster stuff, but a mining zone in general").
 *
 * - Four veins, west to east: copper nearest the village, then iron, mithril and adamant, each opening with the map
 *   whose gear that ore refines (shared/refine.ts grades: tiers 1-4 copper, 5-8 iron, 9-12 mithril, 13-15 adamant).
 * - Rocks come Small, Large and, rarely, Mysterious; only a Mysterious rock can hold a Starshard.
 * - Every rock raises the Mining stat, which makes mining faster. Prestige never resets it.
 * - Each player has their own rocks: a broken rock is bare for them alone until it grows back.
 *
 * The rocks are laid from their coordinates alone, the same for every client and the server, as the Town's
 * countryside is. The server rolls every ore.
 */

/** The four grade ores: what a vein can hold. A Starshard comes only out of a Mysterious rock. */
export type VeinOreId = Exclude<OreId, "starshard">;

export type MiningVein = {
  ore: VeinOreId;
  /** The first gear tier this ore refines: its vein opens with that tier's map. */
  firstTier: number;
  /** The band of the hills it fills, west to east. */
  left: number;
  right: number;
  /** How much longer its rocks take to break than copper's: twice as long a grade. */
  hardness: number;
};
const band = (from: number, to: number) => ({ left: TOWN_HILLS.left + from, right: TOWN_HILLS.left + to });
export const MINING_VEINS: readonly MiningVein[] = Object.freeze([
  { ore: "copper_ore", firstTier: 1, hardness: 1, ...band(0, 1_400) },
  { ore: "iron_ore", firstTier: 5, hardness: 2, ...band(1_400, 2_500) },
  { ore: "mithril_ore", firstTier: 9, hardness: 4, ...band(2_500, 3_500) },
  { ore: "adamant_ore", firstTier: 13, hardness: 8, ...band(3_500, 4_400) },
] as const);

export type MiningNodeKind = "small" | "large" | "mysterious";
/**
 * Each kind of rock: how long a new miner takes to break one of copper (a vein's hardness multiplies it, Mining
 * divides it), the ore it breaks into, how long it stays bare for the player who broke it, and its share of a
 * vein's rocks (Small takes the rest; every vein has at least one Mysterious).
 */
export const MINING_NODE_KINDS: Readonly<Record<MiningNodeKind, { name: string; breakSeconds: number; ore: number; respawnSeconds: number; share: number }>> = {
  small: { name: "Small", breakSeconds: 4, ore: 1, respawnSeconds: 60, share: 0 },
  large: { name: "Large", breakSeconds: 12, ore: 3, respawnSeconds: 180, share: .24 },
  mysterious: { name: "Mysterious", breakSeconds: 12, ore: 2, respawnSeconds: 900, share: .04 },
};
/** A Mysterious rock's chance of a Starshard beside its ore: the ore every refine from ★11 on takes. */
export const MINING_STARSHARD_CHANCE = .15;

/** How close a player's feet come to a rock's foot to mine it, and the server's allowance on top for lag. */
export const MINING_REACH = 70;
export const MINING_SERVER_REACH = 120;
/** The server takes a break this soon at the earliest, as a share of the rock's time: clocks and packets wander. */
export const MINING_RATE_SLACK = .75;

export type MiningNode = { id: number; x: number; y: number; kind: MiningNodeKind; vein: number; ore: VeinOreId };

/** The grid the rocks are laid on, and the share of its cells that hold one: loose clusters with room to walk between. */
const NODE_CELL = 230, NODE_MARGIN = 45, NODE_DENSITY = .45;

function layNodes(): MiningNode[] {
  const nodes: MiningNode[] = [];
  MINING_VEINS.forEach((vein, veinIndex) => {
    const spots: { x: number; y: number }[] = [];
    for (let cy = 0; TOWN_HILLS.top + (cy + 1) * NODE_CELL <= TOWN_HILLS.bottom; cy++) {
      for (let cx = 0; vein.left + (cx + 1) * NODE_CELL <= vein.right; cx++) {
        const random = townRandom(veinIndex, cx, cy, 11);
        if (random() > NODE_DENSITY) continue;
        spots.push({
          x: Math.round(vein.left + cx * NODE_CELL + NODE_MARGIN + random() * (NODE_CELL - 2 * NODE_MARGIN)),
          y: Math.round(TOWN_HILLS.top + cy * NODE_CELL + NODE_MARGIN + random() * (NODE_CELL - 2 * NODE_MARGIN)),
        });
      }
    }
    // Kinds by share rather than by dice, so every vein has its Large rocks and its Mysterious one: a seeded
    // shuffle picks which spots get them.
    const order = spots.map((_, index) => index);
    const shuffle = townRandom(veinIndex, 97);
    for (let index = order.length - 1; index > 0; index--) {
      const swap = Math.floor(shuffle() * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }
    const mysterious = Math.max(1, Math.round(spots.length * MINING_NODE_KINDS.mysterious.share));
    const large = Math.round(spots.length * MINING_NODE_KINDS.large.share);
    const kinds: MiningNodeKind[] = spots.map(() => "small");
    order.forEach((spot, rank) => { kinds[spot] = rank < mysterious ? "mysterious" : rank < mysterious + large ? "large" : "small"; });
    spots.forEach((spot, index) => nodes.push({ id: nodes.length, ...spot, kind: kinds[index], vein: veinIndex, ore: vein.ore }));
  });
  return nodes;
}
/** Every rock in the hills, by id (its place in this list). */
export const MINING_NODES: readonly MiningNode[] = Object.freeze(layNodes());

export const miningNode = (id: unknown): MiningNode | null =>
  typeof id === "number" && Number.isInteger(id) && id >= 0 ? MINING_NODES[id] ?? null : null;

/** "Large Iron Ore": a rock's name, as Morkyl named them. */
export const miningNodeName = (node: MiningNode) => `${MINING_NODE_KINDS[node.kind].name} ${REFINE_ORES[node.ore].name}`;

export function normalizeMining(mining: unknown) {
  const value = Number(mining);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** How much faster than a new miner: 1× at Mining 0, 2× at 500, closing in on 3× and never past it. */
export function miningSpeed(mining: unknown) {
  const value = normalizeMining(mining);
  return 1 + 2 * value / (value + 500);
}

/** Seconds to break a rock at this Mining. */
export function miningBreakSeconds(node: MiningNode, mining: unknown) {
  return MINING_NODE_KINDS[node.kind].breakSeconds * MINING_VEINS[node.vein].hardness / miningSpeed(mining);
}

/** What breaking a rock adds to Mining: its ore, weighted by its vein's hardness, so deeper veins teach faster. */
export function miningGain(node: MiningNode) {
  return MINING_NODE_KINDS[node.kind].ore * MINING_VEINS[node.vein].hardness;
}

/** What a broken rock gives: its vein's ore, and from a Mysterious rock perhaps a Starshard. `roll` is in [0, 1). */
export function miningYield(node: MiningNode, roll: number): Partial<Record<OreId, number>> {
  const ores: Partial<Record<OreId, number>> = { [node.ore]: MINING_NODE_KINDS[node.kind].ore };
  if (node.kind === "mysterious" && roll < MINING_STARSHARD_CHANCE) ores.starshard = 1;
  return ores;
}

/** Whether a vein is open: copper always, the rest once the map whose gear their ore refines is unlocked. */
export function miningVeinOpen(vein: MiningVein, access: CampaignAccess | null | undefined) {
  return vein.firstTier <= 1 || Boolean(access && campaignMapUnlocked(vein.firstTier - 1, access));
}

/** The map that opens a vein ("Reach Lava Lake - 5 to mine Iron Ore"). */
export function miningVeinMap(vein: MiningVein) {
  const mapId = MAP_IDS[vein.firstTier - 1];
  return (mapId && MAP_DISPLAY_NAMES[mapId as keyof typeof MAP_DISPLAY_NAMES]) || `Map ${vein.firstTier}`;
}
