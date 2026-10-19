import { afterEach, describe, expect, it, vi } from "vitest";
import { WOOD_TREE_NODES, WOODCUTTING_RESPAWN_SECONDS, woodcuttingChopSeconds } from "../../../../shared/woodcutting";
import { TOWN_ARRIVAL, TOWN_FEET_OFFSET } from "../../../../shared/town";
import { createWoodcuttingRuntime, type WoodcuttingSource } from "./woodcutting-runtime";
import { miningHits } from "./mining-runtime";
import { resetWoodcuttingScene, woodcuttingScene } from "./woodcutting-scene";
import type { PlayerState } from "../types";
import type { BagSpace } from "../../../../shared/ore-bag";

afterEach(() => resetWoodcuttingScene());

const pine = WOOD_TREE_NODES.find(tree => tree.kind === "pine")!, oak = WOOD_TREE_NODES.find(tree => tree.kind === "oak")!;
const NOW = 1_800_000_000_000;

/** A woodcutter standing with their feet on a tree's foot, and a session that has given them the hatchet. */
function woodcutter(at: { x: number; y: number } = pine, overrides: Partial<WoodcuttingSource> = {}, bag?: () => BagSpace) {
  const player = { x: at.x, y: at.y - TOWN_FEET_OFFSET, hp: 100, moving: false } as PlayerState;
  let onChop: ((result: { treeId: number; treesChopped: number }) => void) | null = null;
  const source: WoodcuttingSource = {
    hasHatchet: () => true, woodcutting: () => 0, choppedTreeAt: () => null, serverNowMs: () => NOW, savedProgress: () => ({}),
    chopTree: vi.fn(async () => ({ ok: true })),
    setOnTreeChopped: callback => { onChop = callback; },
    ...overrides,
  };
  const message = vi.fn(), logPickup = vi.fn(), burst = vi.fn();
  const runtime = createWoodcuttingRuntime({ source: () => source, player, message, logPickup, burst, bag });
  const run = (seconds: number, active = true) => { for (let t = 0; t < seconds - 1e-9; t += .1) runtime.update(.1, active); };
  return { player, source, runtime, run, message, logPickup, chopped: (result: { treeId: number; treesChopped: number }) => onChop?.(result) };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("chopping in Timberwood", () => {
  it("swings at the tree in reach while the player stands still, a hit a swing as mining, and asks the server once it falls", () => {
    const w = woodcutter();
    w.run(1);
    expect(woodcuttingScene).toMatchObject({ target: pine.id, hatchetOut: true });
    const seconds = woodcuttingChopSeconds(pine, 0);
    expect(woodcuttingScene.progress).toBeCloseTo(1 / miningHits(seconds), 5);
    expect(w.source.chopTree).not.toHaveBeenCalled();
    w.run(seconds);
    expect(w.source.chopTree).toHaveBeenCalledExactlyOnceWith(pine.id);
    // A stump at once, before the server's word.
    expect(woodcuttingScene.felled.has(pine.id)).toBe(true);
  });

  it("pauses while the player walks, and is quicker with more Woodcutting", () => {
    const w = woodcutter();
    w.run(2);
    const made = woodcuttingScene.progress;
    w.player.moving = true;
    w.run(3);
    expect(woodcuttingScene.progress).toBeCloseTo(made, 5);
    resetWoodcuttingScene();
    const quick = woodcutter(pine, { woodcutting: () => 500 });
    quick.run(woodcuttingChopSeconds(pine, 500) + .2);
    expect(quick.source.chopTree).toHaveBeenCalledWith(pine.id);
  });

  it("is quicker with an upgraded hatchet, timed as the server checks it", () => {
    const w = woodcutter(pine, { toolLevel: tool => (tool === "hatchet" ? 5 : 0) });
    const seconds = woodcuttingChopSeconds(pine, 0, 5);
    expect(seconds).toBeCloseTo(woodcuttingChopSeconds(pine, 0) / 1.5);
    w.run(seconds - .2);
    expect(w.source.chopTree).not.toHaveBeenCalled();
    expect(woodcuttingScene.toolLevel).toBe(5);
    w.run(.4);
    expect(w.source.chopTree).toHaveBeenCalledWith(pine.id);
  });

  it("without the hatchet says where to get one, once", () => {
    const w = woodcutter(pine, { hasHatchet: () => false });
    w.run(3);
    expect(w.message).toHaveBeenCalledExactlyOnceWith("You need a hatchet. The Smith in Town has one.", "#ffd75e");
    expect(woodcuttingScene.hatchetOut).toBe(false);
    expect(w.source.chopTree).not.toHaveBeenCalled();
  });

  it("at a stand not open yet says which map opens it", () => {
    const w = woodcutter(oak);
    w.run(1);
    expect(w.message).toHaveBeenCalledWith("Reach Night Forest - 5 to chop Oak Trees.", "#ff9b91");
    const open = woodcutter(oak, { savedProgress: () => ({ infernalUnlocked: true }) });
    open.run(woodcuttingChopSeconds(oak, 0) + .2);
    expect(open.source.chopTree).toHaveBeenCalledWith(oak.id);
  });

  it("with no bag slot for a kind of log not held yet, says so before a single swing", () => {
    const full: BagSpace = { owned: [], equipped: [], extraCopies: 30, ores: {}, capacity: 30 };
    const w = woodcutter(pine, {}, () => full);
    w.run(woodcuttingChopSeconds(pine, 0) + 1);
    expect(w.message).toHaveBeenCalledWith("Your bag is full. Free a slot for Pine Log.", "#ff9b91");
    expect(w.source.chopTree).not.toHaveBeenCalled();
    const held = woodcutter(pine, {}, () => ({ ...full, extraCopies: 29, ores: { pine_log: 4 } }));
    held.run(woodcuttingChopSeconds(pine, 0) + .2);
    expect(held.source.chopTree).toHaveBeenCalledWith(pine.id);
  });

  it("stands the tree back up when the server refuses the fall, and says why", async () => {
    const w = woodcutter(pine, { chopTree: vi.fn(async () => ({ ok: false, error: "That tree is still growing back." })) });
    w.run(woodcuttingChopSeconds(pine, 0) + .2);
    await flush();
    expect(woodcuttingScene.felled.has(pine.id)).toBe(false);
    expect(w.message).toHaveBeenCalledWith("That tree is still growing back.", "#ff9b91");
  });

  it("shows what each fall the server takes gave, and leaves a listed stump until it grows back", () => {
    let choppedAt = NOW - 30_000;
    const w = woodcutter(pine, { choppedTreeAt: id => (id === pine.id ? choppedAt : null) });
    w.run(1);
    expect(woodcuttingScene.felled.has(pine.id)).toBe(true);
    expect(woodcuttingScene.target).not.toBe(pine.id);
    w.chopped({ treeId: pine.id, treesChopped: 1 });
    expect(w.logPickup).toHaveBeenCalledWith("+2 Pine Log", expect.any(String));
    choppedAt = NOW - WOODCUTTING_RESPAWN_SECONDS * 1_000 - 1;
    w.run(1);
    expect(woodcuttingScene.felled.has(pine.id)).toBe(false);
    expect(woodcuttingScene.target).toBe(pine.id);
  });

  it("starts afresh after the account changes, and forgets its stumps when Reset Save takes the hatchet back", async () => {
    let identity = "first", hatchet = true;
    const w = woodcutter(pine, { localIdentity: () => identity, hasHatchet: () => hatchet });
    w.run(woodcuttingChopSeconds(pine, 0) + .1);
    await flush();
    expect(woodcuttingScene.felled.has(pine.id)).toBe(true);
    hatchet = false;
    w.run(.1);
    hatchet = true;
    identity = "second";
    w.run(woodcuttingChopSeconds(pine, 0) + .1);
    expect(w.source.chopTree).toHaveBeenCalledTimes(2);
  });

  it("does nothing away from the grove, or while the player is not free to act", () => {
    const away = woodcutter(TOWN_ARRIVAL);
    away.run(10);
    expect(away.source.chopTree).not.toHaveBeenCalled();
    expect(woodcuttingScene.target).toBeNull();
    const busy = woodcutter();
    busy.run(10, false);
    expect(busy.source.chopTree).not.toHaveBeenCalled();
    expect(woodcuttingScene.hatchetOut).toBe(false);
  });
});
