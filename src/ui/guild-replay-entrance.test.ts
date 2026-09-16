import { expect, it } from "vitest";
import { simulateGuildBattle } from "../../shared/guild-combat";
import { buildGuildReplayEntrance, guildEntrancePosition } from "./guild-replay-entrance";
const team = (prefix: string, count = 20) => Array.from({ length: count }, (_, i) => ({ identity: `${prefix}${i}`, name: `${prefix}${i}`,
  fighter: { maxHp: 100, damage: 10, armor: 0, regen: 0, attackRate: 1 } }));
it("introduces at most two per wave, with varied gaps and a bounded full-team entrance", () => {
  const battle = simulateGuildBattle(team("A"), team("B"));
  const plan = buildGuildReplayEntrance(battle);
  const waves = new Map<number, number>();
  for (const arrival of plan.arrivals) waves.set(arrival.start, (waves.get(arrival.start) ?? 0) + 1);
  expect(Math.max(...waves.values())).toBe(2);
  expect(waves.size).toBeGreaterThanOrEqual(20);
  const starts = [...waves.keys()].sort((a, b) => a - b);
  expect(new Set(starts.slice(1).map((time, i) => (time - starts[i]).toFixed(3))).size).toBeGreaterThan(5);
  expect(plan.duration).toBeLessThanOrEqual(30);
  expect(buildGuildReplayEntrance(battle)).toEqual(plan);
});
it("starts outside opposite screen edges, skips hidden actors, and settles without snapping", () => {
  const arrival = { start: 1, travel: 1, lane: 20 }, point = { x: 100, y: 300 };
  expect(guildEntrancePosition(arrival, .5, point, 0, 390).visible).toBe(false);
  expect(guildEntrancePosition(arrival, 1, point, 0, 390).x).toBeLessThan(0);
  expect(guildEntrancePosition(arrival, 1, point, 1, 390).x).toBeGreaterThan(390);
  expect(guildEntrancePosition(arrival, 2, point, 0, 390)).toEqual({ ...point, visible: true, entering: false });
  expect(guildEntrancePosition(arrival, 1.9999, point, 0, 390).x).toBeCloseTo(point.x, 1);
});
it("assigns every fighter exactly once on uneven teams", () => {
  const plan = buildGuildReplayEntrance(simulateGuildBattle(team("A", 1), team("B")));
  expect(plan.arrivals).toHaveLength(21);
  expect(plan.arrivals.every(arrival => arrival.travel >= .65 && arrival.start > 0)).toBe(true);
});

it("keeps paired arrivals fair and unchanged when a saved player is renamed or deleted", () => {
  const battle = simulateGuildBattle(team("A"), team("B"));
  const plan = buildGuildReplayEntrance(battle);
  for (let i = 0; i < 20; i++) {
    expect(plan.arrivals[i].start).toBe(plan.arrivals[i + 20].start);
    expect(plan.arrivals[i].travel).toBe(plan.arrivals[i + 20].travel);
  }
  battle.attackers[0].identity = ""; battle.attackers[0].name = "Deleted player";
  expect(buildGuildReplayEntrance(battle)).toEqual(plan);
});

it.each([.4, 1.2])("walks into position at combat speed without easing (projection=%s)", scale => {
  const arrival = { start: 1, travel: 5, lane: 20 }, destination = { x: 250, y: 300 }, speed = 90 * scale;
  for (const side of [0, 1]) {
    const sample = (time: number) => guildEntrancePosition(arrival, time, destination, side, 900, speed);
    const start = sample(2), middle = sample(3), end = sample(4);
    expect(Math.abs(middle.x - start.x)).toBeCloseTo(speed);
    expect(Math.abs(end.x - middle.x)).toBeCloseTo(speed);
    expect(start.y).toBe(destination.y);
    expect(sample(6)).toEqual({ ...destination, visible: true, entering: false });
    expect(Math.abs(sample(6).x - sample(5.99).x)).toBeCloseTo(speed * .01);
  }
});
it("preserves the short schedule for existing version 3 replays", () => {
  const battle = simulateGuildBattle(team("A"), team("B"), undefined, 3);
  expect(buildGuildReplayEntrance(battle).duration).toBeLessThanOrEqual(6.1);
});
