import { expect, it } from "vitest";
import { createLatencyProbe } from "./latency-probe";
import { createMainThreadStalls } from "./main-thread-stalls";

function setup() {
  let time = 1_000, hidden = false, visibilityChanged = () => {};
  const spikes: string[] = [], stalls = createMainThreadStalls(15_000, () => time);
  const probe = createLatencyProbe(detail => spikes.push(detail), {
    now: () => time, hidden: () => hidden, stalls,
    onVisibilityChange: listener => { visibilityChanged = listener; },
  });
  return { probe, spikes, stalls, advance: (ms: number) => { time += ms; }, at: () => time,
    hide: () => { hidden = true; visibilityChanged(); }, show: () => { hidden = false; visibilityChanged(); } };
}

it("reads a round trip and times at most four a second", () => {
  const t = setup();
  const first = t.probe.begin();
  expect(t.probe.begin()).toBeNull();
  t.advance(90); t.probe.finish(first);
  expect(t.probe.value()).toBe(90);
  t.advance(200);
  expect(t.probe.begin()).not.toBeNull();
});

it("drops a reply that waited while the tab was hidden", () => {
  const t = setup();
  const probe = t.probe.begin();
  t.hide(); t.advance(40_000); t.show();
  t.probe.finish(probe);
  expect(t.probe.value()).toBeNull();
  expect(t.spikes).toHaveLength(0);
});

it("reports a spike once a minute with how long this device was blocked", () => {
  const t = setup();
  const probe = t.probe.begin();
  t.stalls.note(t.at() + 100, 450);
  t.advance(700); t.probe.finish(probe);
  expect(t.spikes).toEqual(["round trip 700 ms · device blocked 450 ms"]);
  t.advance(1_000);
  const again = t.probe.begin(); t.advance(800); t.probe.finish(again);
  expect(t.spikes).toHaveLength(1);
});
