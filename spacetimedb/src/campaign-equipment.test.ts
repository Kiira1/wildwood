import { STARTER_BOW } from "../../shared/items";
import { CAMPAIGN_UNLOCK_FIELDS } from "../../shared/equipment-access";
import { MAP_IDS } from "../../shared/rules";
import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { reportKills } from "../../tests/helpers/enemy-defeat";
import { CAMPAIGN_EQUIPMENT } from "../../shared/campaign-equipment";
import { ENEMY_TYPES } from "../../shared/enemy-definitions";
import { enemyDefeatDefinition } from "../../shared/enemy-defeats";
import { regularMapLoot } from "../../shared/regular-map-loot";
import { canReplayRegularEnemyLoot, rollRegularEnemyLoot } from "./regular-enemy-loot";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const maps = [...new Set(Object.values(CAMPAIGN_EQUIPMENT).map(entry => entry.mapId))];
it.each(maps)("drops none of %s's old gear, and equips it when owned with no map reached", mapId => {
  const f = crystalFixture();
  f.patch("player", { mapId });
  f.patch("playerProgress", { equippedRightHand: STARTER_BOW, inventoryJson: '["starter_bow"]', damage: 1e15 });
  f.patch("playerProgress", Object.fromEntries(CAMPAIGN_UNLOCK_FIELDS.map((field, i) => [field, i < MAP_IDS.indexOf(mapId)])));
  f.ctx.random.integerInRange = () => 1;
  const enemy = Object.keys(ENEMY_TYPES).find(kind => enemyDefeatDefinition(mapId, kind))!;
  expect(enemy).toBeTruthy();
  const batch = { streamId: "campaign-loot-test-1234", sequence: 1n, mapId, enemies: [{ enemy, count: 1 }] };
  reportKills(f, batch);
  const gear = Object.entries(CAMPAIGN_EQUIPMENT).filter(([, entry]) => entry.mapId === mapId);
  let progress = progressOf(f, f.ctx.sender);
  for (const [id] of gear) expect(JSON.parse(progress.inventoryJson)).not.toContain(id);
  // Owned old gear goes on whatever maps are reached: none at all here.
  f.patch("playerProgress", { ...Object.fromEntries(CAMPAIGN_UNLOCK_FIELDS.map(field => [field, false])),
    inventoryJson: JSON.stringify(["starter_bow", ...gear.map(([id]) => id)]) });
  progress = progressOf(f, f.ctx.sender);
  for (const [id, entry] of gear) {
    const field = entry.definition.slot === "HEAD" ? "equippedHead" : entry.definition.slot === "CHEST" ? "equippedChest" : "equippedRightHand";
    f.run(server.savePlayerProgress, { ...progress, inventoryJson: "[]", [field]: id });
    progress = progressOf(f, f.ctx.sender);
    expect(progress[field]).toBe(id);
    expect(JSON.parse(progress.inventoryJson)).toContain(id);
  }
});
it.each(Object.entries(CAMPAIGN_EQUIPMENT))("never rolls %s, even from a balance pinned before gear stopped dropping", (id, entry) => {
  const f = crystalFixture();
  f.ctx.random.integerInRange = () => 1;
  expect(rollRegularEnemyLoot(f.ctx as any, entry.mapId, 1).has(id)).toBe(false);
  expect(rollRegularEnemyLoot(f.ctx as any, entry.mapId, 1, [{ itemId: id as never, wins: entry.wins, outcomes: entry.outcomes }]).has(id)).toBe(false);
  expect(regularMapLoot(entry.mapId).map(drop => drop.itemId)).not.toContain(id);
});
it("supports delayed loot replay eligibility on the final campaign map", () => {
  expect(canReplayRegularEnemyLoot("ion_citadel", { ionCitadelUnlocked: true })).toBe(true);
  expect(canReplayRegularEnemyLoot("ion_citadel", { ionCitadelUnlocked: false })).toBe(false);
});
