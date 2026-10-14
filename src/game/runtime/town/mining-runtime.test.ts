import { afterEach, describe, expect, it, vi } from "vitest";
import { MINING_NODES, MINING_NODE_KINDS, miningBreakSeconds } from "../../../../shared/mining";
import { TOWN_ARRIVAL, TOWN_FEET_OFFSET } from "../../../../shared/town";
import { createMiningRuntime, miningHitAt, miningHits, type MiningSource } from "./mining-runtime";
import { miningScene, resetMiningScene } from "./mining-scene";
import type { PlayerState } from "../types";
import type { BagSpace } from "../../../../shared/ore-bag";

afterEach(() => resetMiningScene());

const rock = (ore: string, kind: string) => MINING_NODES.find(node => node.ore === ore && node.kind === kind)!;
const copper = rock("copper_ore", "small"), iron = rock("iron_ore", "small");
const NOW = 1_800_000_000_000;

/** A miner standing with their feet on a rock's foot, and a session that has given them the pickaxe. */
function miner(at: { x: number; y: number } = copper, overrides: Partial<MiningSource> = {}, bag?: () => BagSpace) {
  const player = { x: at.x, y: at.y - TOWN_FEET_OFFSET, hp: 100, moving: false } as PlayerState;
  let onBreak: ((result: { nodeId: number; starshard: boolean; rocksBroken: number }) => void) | null = null;
  const source: MiningSource = {
    hasPickaxe: () => true, mining: () => 0, minedNodeAt: () => null, serverNowMs: () => NOW, savedProgress: () => ({}),
    mineNode: vi.fn(async () => ({ ok: true })),
    setOnMiningBreak: callback => { onBreak = callback; },
    ...overrides,
  };
  const message = vi.fn(), logPickup = vi.fn(), burst = vi.fn();
  const runtime = createMiningRuntime({ source: () => source, player, message, logPickup, burst, bag });
  /** Runs the runtime for `seconds` in frames of a tenth of a second. */
  const run = (seconds: number, active = true) => { for (let t = 0; t < seconds - 1e-9; t += .1) runtime.update(.1, active); };
  return { player, source, runtime, run, message, logPickup, burst, broke: (result: { nodeId: number; starshard: boolean; rocksBroken: number }) => onBreak?.(result) };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function pendingReply() {
  let resolve!: (result: { ok: boolean; error?: string }) => void;
  const promise = new Promise<{ ok: boolean; error?: string }>(done => { resolve = done; });
  return { promise, resolve };
}

describe("mining in the Copper Hills", () => {
  it("swings at the rock in reach while the player stands still, and asks the server to take it once it breaks", () => {
    const m = miner();
    m.run(1);
    expect(miningScene).toMatchObject({ target: copper.id, pickaxeOut: true });
    // A 4 s rock takes 6 hits, the first landing at 0.5 s.
    expect(miningScene.progress).toBeCloseTo(1 / 6, 5);
    expect(m.source.mineNode).not.toHaveBeenCalled();
    m.run(miningBreakSeconds(copper, 0));
    expect(m.source.mineNode).toHaveBeenCalledWith(copper.id);
    expect(m.source.mineNode).toHaveBeenCalledTimes(1);
    // Bare at once, before the server's word.
    expect(miningScene.bare.has(copper.id)).toBe(true);
  });

  it("steps the bar once per hit, a swing apart, full on the hit that breaks the rock when the break is due", () => {
    for (const [node, mining] of [[copper, 0], [rock("copper_ore", "large"), 0], [copper, 240]] as const) {
      resetMiningScene();
      const m = miner(node, { mining: () => mining });
      const seconds = miningBreakSeconds(node, mining), hits = miningHits(seconds);
      expect(hits).toBe(Math.ceil(seconds / .7 - 1e-9));
      const steps: { at: number; progress: number }[] = [], swings: number[] = [];
      let at = 0, progress = 0, swing = 0, breakAt = NaN;
      const dt = 1 / 120;
      while (Number.isNaN(breakAt) && at < seconds + 1) {
        m.runtime.update(dt, true);
        at += dt;
        if (miningScene.swingClock > swing) swings.push(at);
        swing = miningScene.swingClock;
        if (miningScene.progress !== progress) { progress = miningScene.progress; steps.push({ at, progress }); }
        if ((m.source.mineNode as ReturnType<typeof vi.fn>).mock.calls.length) breakAt = at;
      }
      // One step of 1/hits on each hit landing, a swing (0.7 s) apart, the last as the break is due.
      expect(steps.map(step => step.progress)).toEqual(Array.from({ length: hits }, (_, index) => expect.closeTo((index + 1) / hits, 9)));
      steps.forEach((step, index) => expect(step.at, `hit ${index}`).toBeCloseTo(miningHitAt(seconds, index), 1));
      for (let index = 1; index < hits; index++) expect(steps[index].at - steps[index - 1].at).toBeLessThanOrEqual(.7 + dt);
      expect(breakAt).toBeCloseTo(seconds, 1);
      expect(steps.at(-1)!.at).toBeCloseTo(breakAt, 5);
      // Each swing starts its windup before its hit, and the full bar stays up over the broken rock a moment.
      expect(swings).toHaveLength(hits);
      swings.forEach((started, index) => expect(steps[index].at - started).toBeLessThanOrEqual(.12 + dt));
      expect(miningScene).toMatchObject({ target: node.id, progress: 1 });
      m.run(1);
      expect(miningScene.target).not.toBe(node.id);
    }
  });

  it("pauses while the player walks, keeping the progress made", () => {
    const m = miner();
    m.run(2);
    const made = miningScene.progress;
    m.player.moving = true;
    m.run(3);
    expect(miningScene.progress).toBeCloseTo(made, 5);
    expect(m.source.mineNode).not.toHaveBeenCalled();
  });

  it("is quicker with more Mining", () => {
    const m = miner(copper, { mining: () => 500 });
    m.run(miningBreakSeconds(copper, 500) + .2);
    expect(m.source.mineNode).toHaveBeenCalledWith(copper.id);
  });

  it("without the pickaxe says where to get one, and does not repeat itself every frame", () => {
    const m = miner(copper, { hasPickaxe: () => false });
    m.run(3);
    expect(m.message).toHaveBeenCalledTimes(1);
    expect(m.message).toHaveBeenCalledWith("You need a pickaxe. The Smith in Town has one.", "#ffd75e");
    expect(miningScene.pickaxeOut).toBe(false);
    expect(m.source.mineNode).not.toHaveBeenCalled();
  });

  it("at a vein not open yet says which map opens it", () => {
    const m = miner(iron);
    m.run(1);
    expect(m.message).toHaveBeenCalledWith("Reach Night Forest - 5 to mine Iron Ore.", "#ff9b91");
    const open = miner(iron, { savedProgress: () => ({ infernalUnlocked: true }) });
    open.run(miningBreakSeconds(iron, 0) + .2);
    expect(open.source.mineNode).toHaveBeenCalledWith(iron.id);
  });

  it("with no bag slot for a kind of ore not held yet, says so before a single swing", () => {
    const full: BagSpace = { owned: [], equipped: [], extraCopies: 30, ores: {}, capacity: 30 };
    const m = miner(copper, {}, () => full);
    m.run(miningBreakSeconds(copper, 0) + 1);
    expect(m.message).toHaveBeenCalledWith("Your bag is full. Free a slot for Copper Ore.", "#ff9b91");
    expect(miningScene.pickaxeOut).toBe(false);
    expect(m.source.mineNode).not.toHaveBeenCalled();
    // More of a kind already held needs no slot.
    const held = miner(copper, {}, () => ({ ...full, extraCopies: 29, ores: { copper_ore: 4 } }));
    held.run(miningBreakSeconds(copper, 0) + .2);
    expect(held.source.mineNode).toHaveBeenCalledWith(copper.id);
  });

  it("puts the rock back when the server refuses the break, and says why", async () => {
    const m = miner(copper, { mineNode: vi.fn(async () => ({ ok: false, error: "That rock is still growing back." })) });
    m.run(miningBreakSeconds(copper, 0) + .2);
    await flush();
    expect(miningScene.bare.has(copper.id)).toBe(false);
    expect(m.message).toHaveBeenCalledWith("That rock is still growing back.", "#ff9b91");
  });

  it.each(["account", "connection"])("starts mining afresh after the %s changes, without waiting for an old break", change => {
    let identity = "first-miner", generation = 1;
    const old = pendingReply();
    const mineNode = vi.fn(() => old.promise);
    const m = miner(copper, { mineNode, localIdentity: () => identity, sessionGeneration: () => generation });
    m.run(miningBreakSeconds(copper, 0) + .1);
    expect(mineNode).toHaveBeenCalledTimes(1);
    if (change === "account") identity = "second-miner";
    else generation++;
    m.run(miningBreakSeconds(copper, 0) + .1);
    expect(mineNode).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("ignores an old break's late reply (ok=%s) while the new session's break is pending", async ok => {
    let generation = 1;
    const old = pendingReply(), current = pendingReply();
    const mineNode = vi.fn().mockReturnValueOnce(old.promise).mockReturnValue(current.promise);
    const m = miner(copper, { mineNode, sessionGeneration: () => generation });
    m.run(miningBreakSeconds(copper, 0) + .1);
    generation++;
    m.run(miningBreakSeconds(copper, 0) + .1);
    old.resolve({ ok, error: "Old request timed out." });
    await flush();
    expect(miningScene.bare.has(copper.id)).toBe(true);
    expect(m.message).not.toHaveBeenCalled();
    // A different rock must still wait for the current request.
    const next = MINING_NODES.find(node => node.ore === "copper_ore" && node.kind === "small" && node.id !== copper.id)!;
    m.player.x = next.x; m.player.y = next.y - TOWN_FEET_OFFSET;
    m.run(miningBreakSeconds(next, 0) + 1);
    expect(mineNode).toHaveBeenCalledTimes(2);
    current.resolve({ ok: false, error: "Current break refused." });
    await flush();
    expect(miningScene.bare.has(copper.id)).toBe(false);
    expect(m.message).toHaveBeenCalledExactlyOnceWith("Current break refused.", "#ff9b91");
  });

  it("forgets local bare rocks when Reset Save takes the pickaxe back", async () => {
    let pickaxe = true;
    const m = miner(copper, { hasPickaxe: () => pickaxe });
    m.run(miningBreakSeconds(copper, 0) + .1);
    await flush();
    expect(miningScene.bare.has(copper.id)).toBe(true);
    pickaxe = false;
    m.run(.1);
    pickaxe = true;
    m.run(miningBreakSeconds(copper, 0) + .1);
    expect(m.source.mineNode).toHaveBeenCalledTimes(2);
  });

  it("ignores a previous session's reply even before the next frame sees the changed identity", async () => {
    let identity = "first-miner";
    const old = pendingReply();
    const m = miner(copper, { localIdentity: () => identity, mineNode: () => old.promise });
    m.run(miningBreakSeconds(copper, 0) + .1);
    identity = "second-miner";
    old.resolve({ ok: false, error: "Previous account's error." });
    await flush();
    expect(m.message).not.toHaveBeenCalled();
    m.broke({ nodeId: copper.id, starshard: true, rocksBroken: 1 });
    expect(m.logPickup).not.toHaveBeenCalled();
  });

  it("shows what each break the server takes gave, over its rock", () => {
    const m = miner();
    m.run(.1);
    m.broke({ nodeId: copper.id, starshard: true, rocksBroken: 1 });
    expect(m.logPickup).toHaveBeenCalledWith("+1 Copper Ore", expect.any(String));
    expect(m.logPickup).toHaveBeenCalledWith("+1 Starshard", expect.any(String));
  });

  it("leaves a rock the server lists as broken bare until it grows back", () => {
    let brokenAt = NOW - 30_000;
    const m = miner(copper, { minedNodeAt: id => (id === copper.id ? brokenAt : null) });
    m.run(1);
    expect(miningScene.bare.has(copper.id)).toBe(true);
    expect(miningScene.target).not.toBe(copper.id);
    brokenAt = NOW - MINING_NODE_KINDS.small.respawnSeconds * 1_000 - 1;
    m.run(1);
    expect(miningScene.bare.has(copper.id)).toBe(false);
    expect(miningScene.target).toBe(copper.id);
  });

  it("does nothing away from the hills, or while the player is not free to act", () => {
    const away = miner(TOWN_ARRIVAL);
    away.run(10);
    expect(away.source.mineNode).not.toHaveBeenCalled();
    expect(miningScene.target).toBeNull();
    const busy = miner();
    busy.run(10, false);
    expect(busy.source.mineNode).not.toHaveBeenCalled();
    expect(miningScene.pickaxeOut).toBe(false);
  });
});
