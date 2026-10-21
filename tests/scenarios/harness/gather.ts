import { Timestamp } from "spacetimedb";
import { MINING_NODES } from "../../../shared/mining";
import { TOWN_ARRIVAL, TOWN_FEET_OFFSET } from "../../../shared/town";
import { WOOD_TREE_NODES } from "../../../shared/woodcutting";
import { inMiningArea, miningStandSpot } from "../../../src/game/runtime/auto-farm/auto-mine";
import { choppingStandSpot, inChoppingArea } from "../../../src/game/runtime/auto-farm/auto-chop";
import { planTownPath, townFeetClear, type TownPoint } from "../../../src/game/runtime/town/town-path";
import { researchRankKey } from "../../../spacetimedb/src/research-rank";
import { writeMiningLevel } from "../../../spacetimedb/src/mining";
import { toolKey, toolLevelFor } from "../../../spacetimedb/src/tools";
import { addOres, oreCount } from "../../../spacetimedb/src/item-refine";
import { addGold, goldFor } from "../../../spacetimedb/src/gold";
import type { OreId } from "../../../shared/refine";
import { inventorySlotCapacity } from "../../../shared/gems";
import { bagSlotsUsed } from "../../../shared/equipment-copies";
import { IRON_BOW } from "../../../shared/items";
import { inventoryForProgress } from "../../../spacetimedb/src/progress-helpers";
import type { ToolId } from "../../../shared/tools";
import { playAs, type GameTab } from "./game";
import type { ScenarioPlayer, ScenarioWorld } from "./server";

/** Where the walk out from the village first comes into an area, as a player stands (not their feet). */
function entryOf(goal: TownPoint, inArea: (x: number, y: number) => boolean): TownPoint {
  const from = { x: TOWN_ARRIVAL.x, y: TOWN_ARRIVAL.y + TOWN_FEET_OFFSET };
  const path = [from, ...planTownPath(from, goal)!];
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1], b = path[index], steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
    for (let step = 0; step <= steps; step++) {
      const x = a.x + (b.x - a.x) * step / steps, y = a.y + (b.y - a.y) * step / steps - TOWN_FEET_OFFSET;
      if (inArea(x, y)) return { x, y };
    }
  }
  throw new Error("The walk never comes into the area");
}

/** Just inside the Copper Hills on the walk from the village, and just inside Timberwood. */
export const HILLS_ENTRY = entryOf(miningStandSpot(MINING_NODES.find(node => node.ore === "copper_ore")!)!, (x, y) => inMiningArea(x - 60, y));
export const GROVE_ENTRY = entryOf(choppingStandSpot(WOOD_TREE_NODES.find(tree => tree.kind === "pine")!)!, (x, y) => inChoppingArea(x + 60, y));

/** The clear ground nearest `target` (as feet), at least `from` and at most `within` away: where a player can stand by it. */
export function clearSpotNear(target: TownPoint, within: number, from = 0) {
  let best: TownPoint | null = null, bestDistance = Infinity;
  for (let dx = -within; dx <= within; dx += 3) for (let dy = -within; dy <= within; dy += 3) {
    const distance = Math.hypot(dx, dy);
    if (distance > within || distance < from || distance >= bestDistance || !townFeetClear(target.x + dx, target.y + dy)) continue;
    best = { x: target.x + dx, y: target.y + dy }; bestDistance = distance;
  }
  if (!best) throw new Error("No clear ground there");
  return best;
}

/** Where a player stands to be at a rock's or tree's spot (the spot is their feet). */
export const standingAt = (spot: TownPoint) => ({ x: spot.x, y: spot.y - TOWN_FEET_OFFSET });

const at = (world: ScenarioWorld, ms: number) => new Timestamp(BigInt(Math.round(ms)) * 1000n);

export type GathererOptions = {
  /** Where the character stands in the Town when the page opens. */
  at: TownPoint;
  mining?: number;
  woodcutting?: number;
  respawnRank?: number;
  /** Upgraded tools: pickaxe, hatchet and so on, by level. */
  tools?: Partial<Record<ToolId, number>>;
  /** The Dragon beaten: Auto Farm (and so Auto Mine/Chop) is open. */
  farm?: boolean;
  /** Rocks and trees already broken for them: id and when, on the server's clock. */
  bareRocks?: [number, number][];
  felledTrees?: [number, number][];
  /** Any other fixture setup before the page opens. */
  before?: (player: ScenarioPlayer) => void;
};

/** Fixture setup for a character before its page opens: where it stands, its gathering stats and research. */
export function prepareGatherer(world: ScenarioWorld, name: string, options: GathererOptions) {
  const player = world.join(name);
  player.patch("player", { mapId: "town", x: options.at.x, y: options.at.y });
  if (options.farm ?? true) player.patch("playerProgress", { desertUnlocked: true });
  world.setup(ctx => {
    const now = at(world, world.now());
    if (options.mining) ctx.db.playerMining.insert({ identity: player.identity, mining: options.mining, rocksBroken: 0, pickaxeAt: now, lastBreakAt: at(world, 0), lastNodeId: 0, lastStarshard: false });
    if (options.mining) writeMiningLevel(ctx, player.identity);
    if (options.woodcutting) ctx.db.playerWoodcutting.insert({ identity: player.identity, woodcutting: options.woodcutting, treesChopped: 0, hatchetAt: now, lastChopAt: at(world, 0), lastTreeId: 0 });
    for (const [nodeId, when] of options.bareRocks ?? []) ctx.db.playerMinedNode.insert({ key: `${player.hex}:${nodeId}`, identity: player.identity, nodeId, brokenAt: at(world, when) });
    for (const [treeId, when] of options.felledTrees ?? []) ctx.db.playerChoppedTree.insert({ key: `${player.hex}:${treeId}`, identity: player.identity, treeId, choppedAt: at(world, when) });
    for (const [tool, level] of Object.entries(options.tools ?? {})) ctx.db.playerTool.insert({ key: toolKey(player.identity, tool as ToolId), identity: player.identity, tool, level });
    if (options.respawnRank) ctx.db.playerResearchRank.insert({ key: researchRankKey(player.identity, "resourceRespawn"), identity: player.identity, researchId: "resourceRespawn", rank: options.respawnRank });
  });
  options.before?.(player);
  player.disconnect();
  return player;
}

/** A character standing in the Town's gathering areas, its page open and in the world. */
export async function gatherer(world: ScenarioWorld, name: string, options: GathererOptions) {
  const player = prepareGatherer(world, name, options);
  const tab = await playAs(world, name);
  return { player, tab, ...gathering(world, player), ...autoGather(tab) };
}

/** What the server stored of a player's gathering. */
export function gathering(world: ScenarioWorld, player: ScenarioPlayer) {
  return {
    /** Rocks the server counted for them. */
    rocks: () => world.db.playerMining.identity.find(player.identity)?.rocksBroken ?? 0,
    mining: () => world.db.playerMining.identity.find(player.identity)?.mining ?? 0,
    trees: () => world.db.playerWoodcutting.identity.find(player.identity)?.treesChopped ?? 0,
    woodcutting: () => world.db.playerWoodcutting.identity.find(player.identity)?.woodcutting ?? 0,
    /** The rocks bare for them on the server, by id. */
    bareRocks: () => [...world.db.playerMinedNode.identity.filter(player.identity)].map(row => row.nodeId as number),
    felledTrees: () => [...world.db.playerChoppedTree.identity.filter(player.identity)].map(row => row.treeId as number),
    /** Their ore and log stacks on the server. */
    ores: () => Object.fromEntries(player.view("my_ores").map(row => [row.oreId, row.count])) as Record<string, number>,
    /** Where the server last heard they stand, and whether they were moving. */
    position: () => { const row = world.db.player.identity.find(player.identity); return { x: row.x as number, y: row.y as number, moving: Boolean(row.moving) }; },
    /** Every reducer call this player makes, by name, from now on. */
    callsTo(reducer: string) {
      const seen: unknown[] = [];
      world.onCommit(commit => { if (commit.reducer === reducer && commit.sender.toHexString() === player.hex && !commit.error) seen.push(commit.args); });
      return seen as any[];
    },
  };
}

/** The Auto Farm card, which is Auto Mine in the Copper Hills and Auto Chop in Timberwood. */
export function autoGather(tab: GameTab) {
  const sheet = () => tab.element("autoFarmSheet");
  const click = (selector: string) => {
    const target = sheet().querySelector<HTMLButtonElement>(selector);
    if (!target) throw new Error(`No ${selector} on the Auto Farm card`);
    if (target.disabled) throw new Error(`${selector} is disabled`);
    target.dispatchEvent(new (tab.window as any).Event("click", { bubbles: true }));
  };
  const open = () => { if (!tab.shown("autoFarmContent")) click(".farm-toggle"); };
  return {
    /** The card is on screen. */
    cardShown: () => tab.shown("autoFarmSheet"),
    /** Opens the card and taps Start. */
    start() { open(); click(".farm-start"); },
    /** Opens the card and taps Stop. */
    stop() { open(); click(".farm-close"); },
    /** Flips an ore's (or a tree's) switch. */
    pick(id: string) { open(); click(`[data-ore="${id}"], [data-tree="${id}"]`); },
    /** Whether Start can be tapped. */
    canStart() { open(); return !sheet().querySelector<HTMLButtonElement>(".farm-start")!.disabled; },
    /** Whether a switch is on, and whether it can be flipped. */
    switchOf(id: string) {
      open();
      const button = sheet().querySelector<HTMLButtonElement>(`[data-ore="${id}"], [data-tree="${id}"]`)!;
      return { on: button.getAttribute("aria-checked") === "true", open: !button.disabled };
    },
  };
}

/** Server-side gathering for a player already in the world: where they stand, what they hold, what they report. */
export function serverGatherer(world: ScenarioWorld, player: ScenarioPlayer) {
  const stored = gathering(world, player);
  return {
    ...stored,
    /** Puts their feet on a point in the Town (fixture setup, as if they had walked there). */
    standAt(feet: TownPoint) {
      world.setup(ctx => { if (ctx.db.playerMotion.identity.find(player.identity)) ctx.db.playerMotion.identity.delete(player.identity); });
      player.patch("player", { mapId: "town", x: feet.x, y: feet.y - TOWN_FEET_OFFSET });
    },
    /** Fixture setup: ores and logs (by id) and gold added to what they hold. */
    give(items: Partial<Record<OreId, number>>, gold = 0) {
      world.setup(ctx => {
        for (const [oreId, count] of Object.entries(items)) addOres(ctx, player.identity, oreId as OreId, count ?? 0);
        if (gold) addGold(ctx, player.identity, gold);
      });
    },
    ore: (oreId: OreId) => oreCount({ db: world.db } as never, player.identity, oreId) as number,
    gold: () => goldFor({ db: world.db } as never, player.identity) as bigint,
    tool: (tool: ToolId) => toolLevelFor({ db: world.db } as never, player.identity, tool) as number,
    /** One report of breaks, each `msAgo` before now; returns how many the server counted. */
    reportMining(breaks: [number, number][]) {
      const before = stored.rocks();
      player.call("reportMining", { breaks: breaks.map(([nodeId, msAgo]) => ({ nodeId, atMs: BigInt(Math.round(world.now() - msAgo)) })) });
      return stored.rocks() - before;
    },
    reportChopping(chops: [number, number][]) {
      const before = stored.trees();
      player.call("reportChopping", { chops: chops.map(([treeId, msAgo]) => ({ treeId, atMs: BigInt(Math.round(world.now() - msAgo)) })) });
      return stored.trees() - before;
    },
  };
}

/** Fixture setup: every bag slot taken (by copies of a bow the player wears), holding these ores. */
export function fillBag(world: ScenarioWorld, player: ScenarioPlayer, ores: Partial<Record<OreId, number>> = {}) {
  player.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
  world.setup(ctx => { for (const [oreId, count] of Object.entries(ores)) addOres(ctx, player.identity, oreId as OreId, count ?? 0); });
  const used = bagSlotsUsed(inventoryForProgress(player.progress()), [IRON_BOW], 0, Object.keys(ores).length);
  world.setup(ctx => {
    for (let index = used; index < inventorySlotCapacity(0); index++) {
      ctx.db.playerEquipmentCopy.insert({ id: 0n, identity: player.identity, itemId: IRON_BOW, arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: world.timestamp() });
    }
  });
}
