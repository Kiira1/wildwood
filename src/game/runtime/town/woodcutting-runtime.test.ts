import { afterEach, describe, expect, it, vi } from "vitest";
import { WOOD_TREE_NODES, WOODCUTTING_RESPAWN_SECONDS, woodcuttingChopSeconds } from "../../../../shared/woodcutting";
import { TOWN_ARRIVAL, TOWN_FEET_OFFSET } from "../../../../shared/town";
import { createWoodcuttingRuntime, type WoodcuttingSource } from "./woodcutting-runtime";
import { REJECTED_COLOR, miningHits } from "./mining-runtime";
import { resetWoodcuttingScene, woodcuttingScene } from "./woodcutting-scene";
import type { PlayerState } from "../types";
import type { BagSpace } from "../../../../shared/ore-bag";

afterEach(() => resetWoodcuttingScene());

const pine = WOOD_TREE_NODES.find(tree => tree.kind === "pine")!, oak = WOOD_TREE_NODES.find(tree => tree.kind === "oak")!;
const NOW = 1_800_000_000_000;

/** A woodcutter standing with their feet on a tree's foot, with the hatchet every player holds; falls queue as the session's do. */
function woodcutter(at: { x: number; y: number } = pine, overrides: Partial<WoodcuttingSource> = {}, bag?: () => BagSpace) {
  const player = { x: at.x, y: at.y - TOWN_FEET_OFFSET, hp: 100, moving: false } as PlayerState;
  const queued = new Map<number, number>();
  let onRejected: ((text: string) => void) | null = null;
  const source: WoodcuttingSource = {
    woodcutting: () => 0, choppedTreeAt: id => queued.get(id) ?? null, serverNowMs: () => NOW,
    queueTreeChop: vi.fn((id: number, atMs: number) => { queued.set(id, atMs); }),
    flushWoodcutting: vi.fn(),
    setOnWoodcuttingRejected: callback => { onRejected = callback; },
    ...overrides,
  };
  const message = vi.fn(), logPickup = vi.fn(), burst = vi.fn();
  const runtime = createWoodcuttingRuntime({ source: () => source, player, message, logPickup, burst, bag });
  const run = (seconds: number, active = true) => { for (let t = 0; t < seconds - 1e-9; t += .1) runtime.update(.1, active); };
  const refuse = (id: number, text: string) => { queued.delete(id); onRejected?.(text); };
  return { player, source, runtime, run, message, logPickup, refuse };
}
const chops = (w: { source: WoodcuttingSource }) => (w.source.queueTreeChop as ReturnType<typeof vi.fn>).mock.calls.map(([id]) => id);

describe("chopping in Timberwood", () => {
  it("swings at the tree in reach while the player stands still, a hit a swing as mining, and queues the fall at once", () => {
    const w = woodcutter();
    w.run(1);
    expect(woodcuttingScene).toMatchObject({ target: pine.id, hatchetOut: true });
    const seconds = woodcuttingChopSeconds(pine, 0);
    expect(woodcuttingScene.progress).toBeCloseTo(1 / miningHits(seconds), 5);
    expect(w.source.queueTreeChop).not.toHaveBeenCalled();
    w.run(seconds);
    expect(w.source.queueTreeChop).toHaveBeenCalledExactlyOnceWith(pine.id, NOW);
    // A stump, and its logs shown, before any report goes out.
    expect(woodcuttingScene.felled.has(pine.id)).toBe(true);
    expect(w.logPickup).toHaveBeenCalledWith("+2 Pine Log", expect.any(String));
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
    expect(chops(quick)).toEqual([pine.id]);
  });

  it("is quicker with an upgraded hatchet, timed as the server checks it", () => {
    const w = woodcutter(pine, { toolLevel: tool => (tool === "hatchet" ? 5 : 0) });
    const seconds = woodcuttingChopSeconds(pine, 0, 5);
    expect(seconds).toBeCloseTo(woodcuttingChopSeconds(pine, 0) / 1.5);
    w.run(seconds - .2);
    expect(w.source.queueTreeChop).not.toHaveBeenCalled();
    expect(woodcuttingScene.toolLevel).toBe(5);
    w.run(.4);
    expect(chops(w)).toEqual([pine.id]);
  });

  it("at a stand whose Woodcutting is not reached yet says the Woodcutting it needs, once", () => {
    const w = woodcutter(oak, { woodcutting: () => 49 });
    w.run(3);
    expect(w.message).toHaveBeenCalledExactlyOnceWith("Reach Woodcutting 50 to chop Oak Trees.", "#ff9b91");
    expect(woodcuttingScene.hatchetOut).toBe(false);
    expect(w.source.queueTreeChop).not.toHaveBeenCalled();
    const open = woodcutter(oak, { woodcutting: () => 50 });
    open.run(woodcuttingChopSeconds(oak, 50) + .2);
    expect(chops(open)).toEqual([oak.id]);
  });

  it("with no bag slot for a kind of log not held yet, says so before a single swing", () => {
    const full: BagSpace = { owned: [], equipped: [], extraCopies: 30, ores: {}, capacity: 30 };
    const w = woodcutter(pine, {}, () => full);
    w.run(woodcuttingChopSeconds(pine, 0) + 1);
    expect(w.message).toHaveBeenCalledWith("Your bag is full. Free a slot for Pine Log.", "#ff9b91");
    expect(w.source.queueTreeChop).not.toHaveBeenCalled();
    const held = woodcutter(pine, {}, () => ({ ...full, extraCopies: 29, ores: { pine_log: 4 } }));
    held.run(woodcuttingChopSeconds(pine, 0) + .2);
    expect(chops(held)).toEqual([pine.id]);
  });

  it("stands the tree back up when the server's report leaves the fall out, and says so", () => {
    const w = woodcutter();
    w.run(woodcuttingChopSeconds(pine, 0) + .2);
    w.refuse(pine.id, "A tree stands again: that fall was not counted.");
    w.run(.1);
    expect(woodcuttingScene.felled.has(pine.id)).toBe(false);
    expect(w.message).toHaveBeenCalledWith("A tree stands again: that fall was not counted.", REJECTED_COLOR);
  });

  it("sends the queued falls as the player leaves the grove", () => {
    const w = woodcutter();
    w.run(woodcuttingChopSeconds(pine, 0) + .2);
    expect(w.source.flushWoodcutting).not.toHaveBeenCalled();
    w.player.x = TOWN_ARRIVAL.x; w.player.y = TOWN_ARRIVAL.y;
    w.run(.2);
    expect(w.source.flushWoodcutting).toHaveBeenCalledTimes(1);
  });

  it("leaves a listed stump until it grows back", () => {
    let choppedAt = NOW - 30_000;
    const w = woodcutter(pine, { choppedTreeAt: id => (id === pine.id ? choppedAt : null) });
    w.run(1);
    expect(woodcuttingScene.felled.has(pine.id)).toBe(true);
    expect(woodcuttingScene.target).not.toBe(pine.id);
    choppedAt = NOW - WOODCUTTING_RESPAWN_SECONDS * 1_000 - 1;
    w.run(1);
    expect(woodcuttingScene.felled.has(pine.id)).toBe(false);
    expect(woodcuttingScene.target).toBe(pine.id);
  });

  it("starts afresh after the account changes, forgetting its stumps", () => {
    let identity = "first";
    const w = woodcutter(pine, { localIdentity: () => identity, choppedTreeAt: () => null });
    w.run(woodcuttingChopSeconds(pine, 0) + .1);
    expect(woodcuttingScene.felled.has(pine.id)).toBe(true);
    identity = "second";
    w.run(woodcuttingChopSeconds(pine, 0) + .1);
    expect(w.source.queueTreeChop).toHaveBeenCalledTimes(2);
  });

  it("does nothing away from the grove, or while the player is not free to act", () => {
    const away = woodcutter(TOWN_ARRIVAL);
    away.run(10);
    expect(away.source.queueTreeChop).not.toHaveBeenCalled();
    expect(woodcuttingScene.target).toBeNull();
    const busy = woodcutter();
    busy.run(10, false);
    expect(busy.source.queueTreeChop).not.toHaveBeenCalled();
    expect(woodcuttingScene.hatchetOut).toBe(false);
  });
});
