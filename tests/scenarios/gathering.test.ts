import { describe, expect, it, vi } from "vitest";
import { MINING_NODE_KINDS, MINING_NODES, MINING_REACH, type MiningNode } from "../../shared/mining";
import { TOWN_FEET_OFFSET } from "../../shared/town";
import { WOOD_TREE_NODES } from "../../shared/woodcutting";
import { miningStandSpot } from "../../src/game/runtime/auto-farm/auto-mine";
import { choppingStandSpot } from "../../src/game/runtime/auto-farm/auto-chop";
import { gameWorld } from "./harness/game";
import { autoGather, gatherer, GROVE_ENTRY, HILLS_ENTRY, standingAt } from "./harness/gather";

vi.setConfig({ testTimeout: 60_000 });

const pines = WOOD_TREE_NODES.filter(tree => tree.kind === "pine");
const copper = MINING_NODES.filter(node => node.ore === "copper_ore" && node.kind !== "crystal");
const feetOf = (at: { x: number; y: number }) => ({ x: at.x, y: at.y + TOWN_FEET_OFFSET });
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const nearestTo = <T>(from: { x: number; y: number }, nodes: T[], spot: (node: T) => { x: number; y: number } | null) =>
  [...nodes].sort((a, b) => distance(spot(a)!, from) - distance(spot(b)!, from))[0];
const respawnMs = (node: MiningNode) => MINING_NODE_KINDS[node.kind].respawnSeconds * 1_000;

describe("Auto Mine and Auto Chop", () => {
  it("Auto Mine walks to the nearest copper rock, mines it standing still, then the next; the server pays ore and Mining", async () => {
    const world = gameWorld();
    const ann = await gatherer(world, "Ann", { at: HILLS_ENTRY });
    const reports = ann.callsTo("reportMining");
    ann.start();
    await ann.tab.play(5_000);
    // The player's own keys for a moment; it carries on once they let go.
    await ann.tab.hold("KeyS", 300);
    expect(await ann.tab.until(() => ann.rocks() >= 3, 90_000)).toBe(true);
    // The nearest copper rock first. The server took every break, which it does only in reach and at the pickaxe's pace.
    expect(reports[0].breaks[0].nodeId).toBe(nearestTo(feetOf(HILLS_ENTRY), copper, miningStandSpot).id);
    expect(new Set(ann.bareRocks()).size).toBe(ann.rocks());
    expect(ann.bareRocks().every(id => copper.some(node => node.id === id))).toBe(true);
    expect(ann.ores().copper_ore).toBeGreaterThanOrEqual(3);
    expect(ann.mining()).toBeGreaterThan(0);
    // Breaks go in batches: every one reported, in fewer reports than breaks.
    expect(reports.flatMap(report => report.breaks).length).toBe(ann.rocks());
    expect(reports.length).toBeLessThan(ann.rocks());
  });

  it("Auto Mine gives way to the player's keys and stops for good when they walk out of the hills", async () => {
    const world = gameWorld();
    const ann = await gatherer(world, "Ann", { at: HILLS_ENTRY });
    ann.start();
    await ann.tab.play(500);
    // West, back towards the village, with their own keys.
    await ann.tab.hold("KeyA", 3_000);
    await ann.tab.play(500);
    expect(ann.position().x).toBeLessThan(HILLS_ENTRY.x - 200);
    expect(ann.cardShown()).toBe(false);
    // Walking back in, it stays off: nothing is mined.
    await ann.tab.hold("KeyD", 3_000);
    expect(ann.cardShown()).toBe(true);
    await ann.tab.play(30_000);
    expect(ann.rocks()).toBe(0);
    expect(ann.bareRocks()).toEqual([]);
  });

  it("Auto Mine waits by the rock that grows back first and mines it at once, sooner with Resource Respawn research", async () => {
    const world = gameWorld();
    const start = world.now(), breakMs = MINING_NODE_KINDS.small.breakSeconds * 1_000;
    // Every copper rock bare; one small rock grows back in 25 s, the rest in minutes.
    const soonest = copper.find(node => node.kind === "small" && distance(miningStandSpot(node)!, feetOf(HILLS_ENTRY)) > 600)!;
    const bareRocks = copper.map(node => [node.id, start - respawnMs(node) + (node === soonest ? 25_000 : 600_000)] as [number, number]);
    const ann = await gatherer(world, "Ann", { at: HILLS_ENTRY, bareRocks });
    ann.start();
    expect(await ann.tab.until(() => ann.rocks() >= 1, 60_000)).toBe(true);
    const mined = world.db.playerMining.identity.find(ann.player.identity);
    expect(mined.lastNodeId).toBe(soonest.id);
    expect(ann.rocks()).toBe(1);
    const brokeAt = Number(mined.lastBreakAt.microsSinceUnixEpoch / 1000n) - start;
    expect(brokeAt).toBeGreaterThanOrEqual(25_000 + breakMs);
    expect(brokeAt).toBeLessThan(25_000 + breakMs + 1_500);

    // Rank 5 takes a quarter off: rocks broken 80% of their regrowth ago stand again for Bob, and he mines one before
    // it would have grown back without the research.
    const research = gameWorld();
    const large = copper.find(node => node.kind === "large")!;
    const bobStart = research.now();
    const bob = await gatherer(research, "Bob", { at: standingAt(miningStandSpot(large)!), respawnRank: 5,
      bareRocks: copper.map(node => [node.id, bobStart - respawnMs(node) * 0.8]) });
    const reports = bob.callsTo("reportMining");
    bob.start();
    expect(await bob.tab.until(() => bob.rocks() >= 1, 60_000)).toBe(true);
    const [first] = reports[0].breaks;
    expect(first.nodeId).toBe(large.id);
    expect(Number(first.atMs)).toBeLessThan(bobStart + respawnMs(large) * 0.2);
  });

  it("Auto Mine mines only the ores picked, remembers them, and comes back on after a reload only if it was on", async () => {
    const world = gameWorld();
    const ann = await gatherer(world, "Ann", { at: HILLS_ENTRY, mining: 50 });
    // Iron alone: copper and crystal off.
    ann.pick("iron_ore"); ann.pick("copper_ore"); ann.pick("arcane_crystal");
    ann.start();
    expect(await ann.tab.until(() => ann.rocks() >= 1, 90_000)).toBe(true);
    // An update reloads the page while it runs: it comes back on by itself, still on iron.
    let tab = await ann.tab.reload();
    expect(await tab.until(tab.playing, 20_000)).toBe(true);
    expect(await tab.until(() => ann.rocks() >= 3, 120_000)).toBe(true);
    expect(ann.bareRocks().every(id => MINING_NODES.find(node => node.id === id)!.ore === "iron_ore")).toBe(true);
    // Stopped, then reloaded: it stays off. The rock she stands by may grow back and be swung at by hand,
    // but Auto Mine never walks her to another.
    autoGather(tab).stop();
    await tab.play(1_000);
    const before = ann.rocks(), standing = ann.position();
    const reports = ann.callsTo("reportMining");
    tab = await tab.reload();
    expect(await tab.until(tab.playing, 20_000)).toBe(true);
    await tab.play(60_000);
    expect(autoGather(tab).cardShown()).toBe(true);
    expect(tab.element("autoFarmSheet").textContent).toContain("Auto Mine: Off");
    expect([ann.position().x, ann.position().y]).toEqual([standing.x, standing.y]);
    const inReach = (id: number) => distance(MINING_NODES.find(node => node.id === id)!, feetOf(standing)) <= MINING_REACH;
    expect(reports.flatMap(report => report.breaks).every(item => inReach(item.nodeId))).toBe(true);
    expect(ann.rocks()).toBeLessThanOrEqual(before + 1);
  });

  it("Auto Chop fells the nearest pines in Timberwood and the server pays logs and Woodcutting; oaks wait for Woodcutting 50", async () => {
    const world = gameWorld();
    const ann = await gatherer(world, "Ann", { at: GROVE_ENTRY });
    const reports = ann.callsTo("reportChopping");
    ann.start();
    expect(await ann.tab.until(() => ann.trees() >= 2, 120_000)).toBe(true);
    expect(reports[0].chops[0].treeId).toBe(nearestTo(feetOf(GROVE_ENTRY), pines, choppingStandSpot).id);
    expect(ann.felledTrees().every(id => pines.some(tree => tree.id === id))).toBe(true);
    expect(ann.ores().pine_log).toBeGreaterThanOrEqual(2);
    expect(ann.woodcutting()).toBeGreaterThan(0);
    // Oaks cannot be picked until Woodcutting 50.
    expect(ann.switchOf("oak").open).toBe(false);
  });
});
