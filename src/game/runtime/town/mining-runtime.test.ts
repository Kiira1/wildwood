import { afterEach, describe, expect, it, vi } from "vitest";
import { MINING_NODES, MINING_NODE_KINDS, miningBreakSeconds } from "../../../../shared/mining";
import { TOWN_ARRIVAL, TOWN_FEET_OFFSET } from "../../../../shared/town";
import { createMiningRuntime, miningHitAt, miningHits, moreGatheredText, type MiningSource } from "./mining-runtime";
import { miningScene, resetMiningScene } from "./mining-scene";
import type { PlayerState } from "../types";
import type { BagSpace } from "../../../../shared/ore-bag";

afterEach(() => resetMiningScene());

const rock = (ore: string, kind: string) => MINING_NODES.find(node => node.ore === ore && node.kind === kind)!;
const copper = rock("copper_ore", "small"), iron = rock("iron_ore", "small");
const NOW = 1_800_000_000_000;

/** A miner standing with their feet on a rock's foot, with the pickaxe every player holds; breaks queue as the session's do. */
function miner(at: { x: number; y: number } = copper, overrides: Partial<MiningSource> = {}, bag?: () => BagSpace) {
  const player = { x: at.x, y: at.y - TOWN_FEET_OFFSET, hp: 100, moving: false } as PlayerState;
  const queued = new Map<number, number>();
  let onRejected: ((text: string) => void) | null = null;
  let onExtra: ((ores: Record<string, number>) => void) | null = null;
  const source: MiningSource = {
    mining: () => 0, minedNodeAt: id => queued.get(id) ?? null, serverNowMs: () => NOW,
    queueMiningBreak: vi.fn((id: number, atMs: number) => { queued.set(id, atMs); }),
    flushMining: vi.fn(),
    setOnMiningRejected: callback => { onRejected = callback; },
    setOnMiningExtra: callback => { onExtra = callback as typeof onExtra; },
    ...overrides,
  };
  const message = vi.fn(), logPickup = vi.fn(), burst = vi.fn();
  const runtime = createMiningRuntime({ source: () => source, player, message, logPickup, burst, bag });
  /** Runs the runtime for `seconds` in frames of a tenth of a second. */
  const run = (seconds: number, active = true) => { for (let t = 0; t < seconds - 1e-9; t += .1) runtime.update(.1, active); };
  /** The session's report came back without this break. */
  const refuse = (id: number, text: string) => { queued.delete(id); onRejected?.(text); };
  /** The session's report came back with more than the breaks showed. */
  const extra = (ores: Record<string, number>) => onExtra?.(ores);
  return { player, source, runtime, run, message, logPickup, burst, refuse, extra };
}
const queuedBreaks = (m: { source: MiningSource }) => (m.source.queueMiningBreak as ReturnType<typeof vi.fn>).mock.calls;

describe("mining in the Copper Hills", () => {
  it("swings at the rock in reach while the player stands still, and queues the break the moment it breaks", () => {
    const m = miner();
    m.run(1);
    expect(miningScene).toMatchObject({ target: copper.id, pickaxeOut: true });
    // A 4 s rock takes 6 hits, the first landing at 0.5 s.
    expect(miningScene.progress).toBeCloseTo(1 / 6, 5);
    expect(m.source.queueMiningBreak).not.toHaveBeenCalled();
    m.run(miningBreakSeconds(copper, 0));
    expect(m.source.queueMiningBreak).toHaveBeenCalledExactlyOnceWith(copper.id, NOW);
    // Bare and its ore shown at once, before any report goes out.
    expect(miningScene.bare.has(copper.id)).toBe(true);
    expect(m.logPickup).toHaveBeenCalledWith("+1 Copper Ore", expect.any(String));
    expect(m.source.flushMining).not.toHaveBeenCalled();
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
        if (queuedBreaks(m).length) breakAt = at;
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

  it("goes straight on to the next rock without waiting for the server", () => {
    const next = MINING_NODES.find(node => node.ore === "copper_ore" && node.kind === "small" && node.id !== copper.id)!;
    const m = miner();
    m.run(miningBreakSeconds(copper, 0) + .1);
    m.player.x = next.x; m.player.y = next.y - TOWN_FEET_OFFSET;
    m.run(miningBreakSeconds(next, 0) + 1);
    expect(queuedBreaks(m).map(([id]) => id)).toEqual([copper.id, next.id]);
  });

  it("pauses while the player walks, keeping the progress made", () => {
    const m = miner();
    m.run(2);
    const made = miningScene.progress;
    m.player.moving = true;
    m.run(3);
    expect(miningScene.progress).toBeCloseTo(made, 5);
    expect(m.source.queueMiningBreak).not.toHaveBeenCalled();
  });

  it("is quicker with more Mining", () => {
    const m = miner(copper, { mining: () => 500 });
    m.run(miningBreakSeconds(copper, 500) + .2);
    expect(queuedBreaks(m)[0]?.[0]).toBe(copper.id);
  });

  it("is quicker with an upgraded pickaxe, timed as the server checks it, and holds it in its level's colours", () => {
    const m = miner(copper, { toolLevel: tool => (tool === "pickaxe" ? 10 : 0) });
    const seconds = miningBreakSeconds(copper, 0, 0, 10);
    expect(seconds).toBeCloseTo(miningBreakSeconds(copper, 0) / 2);
    m.run(seconds - .2);
    expect(m.source.queueMiningBreak).not.toHaveBeenCalled();
    expect(miningScene.toolLevel).toBe(10);
    m.run(.4);
    expect(queuedBreaks(m)[0]?.[0]).toBe(copper.id);
  });

  it("at a vein whose Mining is not reached yet says the Mining it needs, once, and not every frame", () => {
    const m = miner(iron, { mining: () => 49 });
    m.run(3);
    expect(m.message).toHaveBeenCalledExactlyOnceWith("Reach Mining 50 to mine Iron Ore.", "#ff9b91");
    expect(miningScene.pickaxeOut).toBe(false);
    expect(m.source.queueMiningBreak).not.toHaveBeenCalled();
    const open = miner(iron, { mining: () => 50 });
    open.run(miningBreakSeconds(iron, 50) + .2);
    expect(queuedBreaks(open)[0]?.[0]).toBe(iron.id);
  });

  it("at a crystal rock asks for Mining first, then mines it into crystal", () => {
    const crystal = MINING_NODES.find(node => node.kind === "crystal" && node.vein === 0)!;
    const m = miner(crystal, { mining: () => 24 });
    m.run(1);
    expect(m.message).toHaveBeenCalledWith("Reach Mining 25 to mine Arcane Crystal.", "#ff9b91");
    expect(miningScene.pickaxeOut).toBe(false);
    const ready = miner(crystal, { mining: () => 25 });
    ready.run(miningBreakSeconds(crystal, 25) + .2);
    expect(queuedBreaks(ready)[0]?.[0]).toBe(crystal.id);
    expect(ready.logPickup).toHaveBeenCalledWith("+1 Arcane Crystal", expect.any(String));
  });

  it("shows a Mysterious rock's ore and Starshard as it breaks", () => {
    const mysterious = rock("copper_ore", "mysterious");
    const m = miner(mysterious);
    m.run(miningBreakSeconds(mysterious, 0) + .2);
    expect(m.logPickup).toHaveBeenCalledWith("+2 Copper Ore", expect.any(String));
    expect(m.logPickup).toHaveBeenCalledWith("+1 Starshard", expect.any(String));
  });

  it("reports a Mysterious rock at once and shows the Starshards and ore the server rolled beyond it", () => {
    const mysterious = rock("copper_ore", "mysterious");
    const m = miner(mysterious);
    m.run(miningBreakSeconds(mysterious, 0) + .2);
    expect(m.source.flushMining).toHaveBeenCalledTimes(1);
    m.logPickup.mockClear();
    m.extra({ starshard: 2, copper_ore: 1 });
    expect(m.logPickup.mock.calls.map(call => call[0])).toEqual(["+2 More Starshards", "+1 More Copper Ore"]);
    expect([moreGatheredText("starshard", 1), moreGatheredText("iron_ore", 3), moreGatheredText("pine_log", 2)])
      .toEqual(["+1 More Starshard", "+3 More Iron Ore", "+2 More Pine Logs"]);
  });

  it("with no bag slot for a kind of ore not held yet, says so before a single swing", () => {
    const full: BagSpace = { owned: [], equipped: [], extraCopies: 30, ores: {}, capacity: 30 };
    const m = miner(copper, {}, () => full);
    m.run(miningBreakSeconds(copper, 0) + 1);
    expect(m.message).toHaveBeenCalledWith("Your bag is full. Free a slot for Copper Ore.", "#ff9b91");
    expect(miningScene.pickaxeOut).toBe(false);
    expect(m.source.queueMiningBreak).not.toHaveBeenCalled();
    // More of a kind already held needs no slot.
    const held = miner(copper, {}, () => ({ ...full, extraCopies: 29, ores: { copper_ore: 4 } }));
    held.run(miningBreakSeconds(copper, 0) + .2);
    expect(queuedBreaks(held)[0]?.[0]).toBe(copper.id);
  });

  it("stands the rock again when the server's report leaves the break out, and says so", () => {
    const m = miner();
    m.run(miningBreakSeconds(copper, 0) + .2);
    expect(miningScene.bare.has(copper.id)).toBe(true);
    m.refuse(copper.id, "A broken rock did not count.");
    m.run(.1);
    expect(miningScene.bare.has(copper.id)).toBe(false);
    expect(m.message).toHaveBeenCalledWith("A broken rock did not count.", "#ff9b91");
  });

  it("sends the queued breaks as the player leaves the hills, and not before", () => {
    const m = miner();
    m.run(miningBreakSeconds(copper, 0) + .2);
    expect(m.source.flushMining).not.toHaveBeenCalled();
    m.player.x = TOWN_ARRIVAL.x; m.player.y = TOWN_ARRIVAL.y;
    m.run(.2);
    expect(m.source.flushMining).toHaveBeenCalledTimes(1);
    // Through a door or on a trip counts as leaving too.
    const door = miner();
    door.run(.5);
    door.run(.2, false);
    expect(door.source.flushMining).toHaveBeenCalledTimes(1);
  });

  it.each(["account", "connection"])("starts mining afresh after the %s changes", change => {
    let identity = "first-miner", generation = 1;
    const m = miner(copper, { localIdentity: () => identity, sessionGeneration: () => generation, minedNodeAt: () => null });
    m.run(miningBreakSeconds(copper, 0) + .1);
    expect(m.source.queueMiningBreak).toHaveBeenCalledTimes(1);
    if (change === "account") identity = "second-miner";
    else generation++;
    m.run(miningBreakSeconds(copper, 0) + .1);
    expect(m.source.queueMiningBreak).toHaveBeenCalledTimes(2);
  });

  it("ignores a previous session's refusal", () => {
    let identity = "first-miner";
    const m = miner(copper, { localIdentity: () => identity });
    m.run(miningBreakSeconds(copper, 0) + .1);
    identity = "second-miner";
    m.refuse(copper.id, "Previous account's report.");
    expect(m.message).not.toHaveBeenCalled();
  });

  it("stands a rock again once Reset Save clears the session's list of bare rocks", () => {
    let listed: number | null = null;
    const m = miner(copper, { minedNodeAt: id => (id === copper.id ? listed : null) });
    m.run(miningBreakSeconds(copper, 0) + .1);
    listed = NOW;
    m.run(.6);
    expect(miningScene.bare.has(copper.id)).toBe(true);
    listed = null;
    m.run(.6 + miningBreakSeconds(copper, 0));
    expect(m.source.queueMiningBreak).toHaveBeenCalledTimes(2);
  });

  it("leaves a rock the session lists as broken bare until it grows back", () => {
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
    expect(away.source.queueMiningBreak).not.toHaveBeenCalled();
    expect(away.source.flushMining).not.toHaveBeenCalled();
    expect(miningScene.target).toBeNull();
    const busy = miner();
    busy.run(10, false);
    expect(busy.source.queueMiningBreak).not.toHaveBeenCalled();
    expect(miningScene.pickaxeOut).toBe(false);
  });
});
