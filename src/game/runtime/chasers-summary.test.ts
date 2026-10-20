import { describe, expect, it } from "vitest";
import { chasersSummary } from "./chasers-summary";
import { listChasers } from "./enemies/enemy-threat";
import type { EnemyState } from "./types";

const enemy = (extra: Partial<EnemyState> = {}) => ({
  x: 0, y: 0, r: 14, hp: 100, damage: 10, dead: false, engaged: true, leashing: false,
  definition: { attackSpeed: 1, ranged: false }, ...extra,
}) as unknown as EnemyState;

describe("chasers", () => {
  it("lists only the live enemies attacking this player", () => {
    const attacking = enemy();
    const others = [enemy({ dead: true }), enemy({ leashing: true }), enemy({ aggroTargetId: "someone-else" }), enemy({ generatedBoss: true } as never)];
    expect(listChasers([attacking, ...others], "me")).toEqual([attacking]);
  });

  it("adds up their damage and blows a second after armor, less regen", () => {
    const summary = chasersSummary([enemy(), enemy()], { armor: 0, regenPerSecond: 5 });
    expect(summary).toEqual({ count: 2, damagePerSecond: 20, hitsPerSecond: 2, netHealthPerSecond: -15 });
    const shooter = enemy({ definition: { attackSpeed: .5, ranged: true } } as never);
    expect(chasersSummary([enemy(), shooter], { armor: 0, regenPerSecond: 0 }).damagePerSecond).toBe(15);
  });
});
