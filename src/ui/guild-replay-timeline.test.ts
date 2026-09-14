import { expect, it } from "vitest";
import { simulateGuildBattle } from "../../shared/guild-combat";
import { buildGuildReplayTimeline } from "./guild-replay-timeline";
const member = (identity: string) => ({ identity, name: identity, fighter: { maxHp: 100, damage: 1000, armor: 0, regen: 0, attackRate: 1 }, range: 160 });
it("keeps both lethal projectiles in flight before simultaneous knockouts", () => {
  const battle = simulateGuildBattle([member("a")], [member("b")]);
  const timeline = buildGuildReplayTimeline(battle);
  expect(timeline.shots).toHaveLength(2);
  for (const shot of timeline.shots) {
    expect(shot.launch).toBeLessThan(shot.impact);
    expect(shot.impact).toBe(timeline.deaths[shot.target]);
    expect(timeline.sample(shot.launch)[shot.actor].hp).toBeGreaterThan(0);
    expect(timeline.sample(shot.impact)[shot.target].hp).toBe(0);
  }
});
it("interpolates movement and allows scrubbing back without changing the saved frames", () => {
  const timeline = buildGuildReplayTimeline(simulateGuildBattle([member("a")], [member("b")]));
  const before = JSON.stringify(timeline.frames);
  const start = timeline.sample(.2), end = timeline.sample(.3), middle = timeline.sample(.25);
  expect(middle[0].x).toBeCloseTo((start[0].x + end[0].x) / 2);
  timeline.sample(90);
  expect(timeline.sample(.25)).toEqual(middle);
  expect(JSON.stringify(timeline.frames)).toBe(before);
});

it("records actual hit damage before regen and HP clipping, including simultaneous lethal hits", () => {
  const timeline = buildGuildReplayTimeline(simulateGuildBattle([member("a")], [member("b")]));
  expect(timeline.damage).toHaveLength(2);
  expect(timeline.damage.map(hit => hit.target).sort()).toEqual([0, 1]);
  for (const hit of timeline.damage) {
    expect(hit.amount).toBe(1000);
    expect(hit.time).toBe(timeline.deaths[hit.target]);
  }
});
it("matches HP accounting with armor, regeneration and multiple simultaneous attackers", () => {
  const fighter = (id: string) => ({ ...member(id), fighter: { maxHp: 10000, damage: 50, armor: 100, regen: 3, attackRate: .05 } });
  const timeline = buildGuildReplayTimeline(simulateGuildBattle([fighter("a"), fighter("b")], [fighter("c")]));
  for (let step = 1; step < timeline.frames.length; step++) {
    const frame = timeline.frames[step], previous = timeline.frames[step - 1];
    for (let i = 0; i < frame.actors.length; i++) {
      if (previous.actors[i].hp <= 0) continue;
      const hits = timeline.damage.filter(hit => hit.time === frame.time && hit.target === i);
      expect(hits.length).toBeLessThanOrEqual(1);
      const hp = Math.min(10000, previous.actors[i].hp + .3) - (hits[0]?.amount ?? 0);
      expect(frame.actors[i].hp).toBeCloseTo(Math.max(0, hp), 8);
    }
  }
});
