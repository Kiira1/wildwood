import { describe, expect, it } from "vitest";
import { CAMPAIGN_MAPS } from "./campaign-registry";
import { CURVE_STEPS } from "./curve-steps";
import { defaultBalanceSettings, resolveMapBalance } from "./map-balance";

const settings = defaultBalanceSettings();
const damageCamp = (mapId: string) => {
  const snapshot = resolveMapBalance(mapId, settings, 0);
  const rows = mapId.startsWith("endless_") ? Object.entries(snapshot.lanes).filter(([lane]) => lane === "Cindermaw").map(([, row]) => row)
    : Object.values(snapshot.enemies).filter(row => !row.elite && row.reward.type === "damage" && row.hp !== 8);
  return { hp: rows[0].hp, damage: rows[0].damage, reward: rows[0].reward.amount };
};

describe("the balance curve", () => {
  it("is the default, with every Balance Lab control at 1", () => {
    expect(settings.curveVersion).toBe(2);
    for (const factors of Object.values(settings.maps)) for (const value of Object.values(factors)) expect(value).toBe(1);
  });

  it("grows every map's damage camp by the same steps, from the Forest on through Endless", () => {
    const maps = [...CAMPAIGN_MAPS.map(map => map.id), "endless_1", "endless_2", "endless_3"];
    for (let i = 2; i < maps.length; i++) {
      const before = damageCamp(maps[i - 1]), now = damageCamp(maps[i]);
      expect(now.hp / before.hp, maps[i]).toBeCloseTo(CURVE_STEPS.health, 3);
      expect(now.damage / before.damage, maps[i]).toBeCloseTo(CURVE_STEPS.damage, 3);
      expect(now.reward / before.reward, maps[i]).toBeCloseTo(CURVE_STEPS.reward, 3);
    }
  });

  it("grows each boss by the health step too", () => {
    for (let i = 2; i < CAMPAIGN_MAPS.length; i++) {
      const before = resolveMapBalance(CAMPAIGN_MAPS[i - 1].id, settings, 0).boss!.hp, now = resolveMapBalance(CAMPAIGN_MAPS[i].id, settings, 0).boss!.hp;
      expect(now / before, CAMPAIGN_MAPS[i].id).toBeCloseTo(CURVE_STEPS.health, 3);
    }
  });
});
