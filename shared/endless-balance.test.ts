import { describe, expect, it } from "vitest";
import { endlessScaling } from "./endless-balance";
import { generatedBossStats, generatedEnemyStats } from "./procedural-maps";

describe("compressed Endless progression", () => {
  it("adds 20% of the first map per tier while endurance outpaces rewards", () => {
    expect(endlessScaling(21).stats).toBe(5);
    for (const n of [1, 2, 21, 1000, Number.MAX_SAFE_INTEGER]) {
      const normal = generatedEnemyStats({ number: n }, "Cindermaw");
      const boss = generatedBossStats({ number: n });
      expect(boss.rewards.map(r => r.type)).toEqual(["damage", "health", "armor", "regen"]);
      expect(normal.hp).toBeLessThan(1e36); expect(boss.hp).toBeLessThan(1e36);
      if (n > 1) expect(normal.hp / normal.reward.amount).toBeGreaterThan(generatedEnemyStats({ number: 1 }, "Cindermaw").hp / generatedEnemyStats({ number: 1 }, "Cindermaw").reward.amount);
    }
  });
});
