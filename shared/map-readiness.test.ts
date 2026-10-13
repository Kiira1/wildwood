import { describe, expect, it } from "vitest";
import { mapReadiness, READINESS_LIMITS } from "./map-readiness";
import { resolveMapBalance } from "./map-balance";
import { LIVE_BALANCE } from "../src/balance/live-balance";

const fresh = { maxHp: 100, damage: 3.15, attackRate: 1.56, armor: 0, regen: .2 };
const desert = resolveMapBalance("beginner_desert", LIVE_BALANCE.settings, LIVE_BALANCE.revision);

describe("map readiness", () => {
  it("reads a map's live enemies: a fresh character is short of both, a far stronger one is ready", () => {
    expect(mapReadiness("beginner_desert", fresh, desert)).toEqual({ ready: false, needs: "both" });
    expect(mapReadiness("beginner_desert", { ...fresh, damage: 3_000, maxHp: 1e6 }, desert)).toEqual({ ready: true, needs: null });
  });

  it("names what is missing: damage alone, or health alone", () => {
    expect(mapReadiness("beginner_desert", { ...fresh, maxHp: 1e6 }, desert)?.needs).toBe("damage");
    expect(mapReadiness("beginner_desert", { ...fresh, damage: 3_000 }, desert)?.needs).toBe("health");
  });

  it("asks Move At times as much: ready at 1x is not ready against enemies ten times as strong", () => {
    let damage = 1;
    while (!mapReadiness("beginner_desert", { ...fresh, damage, maxHp: 1e9 }, desert)?.ready) damage *= 1.1;
    expect(mapReadiness("beginner_desert", { ...fresh, damage, maxHp: 1e9 }, desert, 10)?.ready).toBe(false);
    expect(mapReadiness("beginner_desert", { ...fresh, damage: damage * 10, maxHp: 1e9 }, desert, 10)?.ready).toBe(true);
  });

  it("counts crits as power does, and regeneration that out-heals the enemies as enough health", () => {
    let damage = 1;
    while (!mapReadiness("beginner_desert", { ...fresh, damage, maxHp: 1e9 }, desert)?.ready) damage *= 1.1;
    const short = { ...fresh, damage: damage / 3, maxHp: 1e9 };
    expect(mapReadiness("beginner_desert", short, desert)?.ready).toBe(false);
    expect(mapReadiness("beginner_desert", { ...short, critChance: .5, critMultiplier: 10 }, desert)?.ready).toBe(true);
    expect(mapReadiness("beginner_desert", { ...fresh, damage: 3_000, maxHp: 1, regen: 1e9 }, desert)?.ready).toBe(true);
    expect(READINESS_LIMITS.hits).toBeGreaterThan(1);
  });
});
