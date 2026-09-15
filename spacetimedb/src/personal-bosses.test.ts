import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { reportEnemy } from "../../tests/helpers/enemy-defeat";
import { MAP_IDS, BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
import { personalBossDefinition } from "../../shared/personal-bosses";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));
it.each([...MAP_IDS, "endless_40"].filter(mapId => personalBossDefinition(mapId)))("awards the reporting player's personal clear on %s", mapId => {
  const f = crystalFixture(); f.patch("player", { mapId });
  reportEnemy(f, "boss");
  const definition = personalBossDefinition(mapId)!;
  if (definition.kind === "procedural") expect(f.db.proceduralProgress.identity.find(f.ctx.sender).completed).toBe(40);
  else expect(f.db.playerProgress.identity.find(f.ctx.sender).bossRewardClaims & (BOSS_REWARD_CLAIM_BITS as any)[definition.kind]).not.toBe(0);
  // Client simulation never writes shared HP, contribution tables or reward schedules.
  expect([...f.db.dragonContribution.iter()]).toHaveLength(0);
  expect([...f.db.proceduralInstanceContribution.iter()]).toHaveLength(0);
  expect([...f.db.dragonRespawnSchedule.iter()]).toHaveLength(0);
});
it.each(["damageDragon", "damageSpiderFromPosition", "damageFrostclawFromPosition", "damageMagmaliskFromPosition", "damageGloomrootFromPosition", "damageTidewyrmFromPosition", "damageKoiShogunFromPosition", "damageTempestKirinFromPosition", "damageMiremawFromPosition", "damagePrismshellFromPosition", "damageIronhornFromPosition", "damageDreadreaperFromPosition", "damageVoltwardenFromPosition", "damageGravebloomFromPosition", "damageAegisPrimeFromPosition", "hitProceduralBoss", "hitProceduralBossBatch"])("blocks old shared combat endpoint %s", name => {
  const f = crystalFixture();
  expect(() => f.run((server as any)[name], { hits: 100, x: 4050, y: 4050, mapId: "endless_1", encounter: 1n, bossKey: "old" })).toThrow("updated");
});
