import { MODULE_MIGRATION_VERSION } from "./module-migrations";
import { expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { rebaseProgressByEffort } from "../../shared/progression-rebase";
import { CAMPAIGN_UNLOCK_FIELDS } from "../../shared/equipment-access";
import { progressOf } from "../../tests/helpers/progress";
import { progressWithoutOldGear } from "./old-gear-payout";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("takes a cached pre-conversion loadout like any other: owned gear goes on, stats stay the server's", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { ionCitadelUnlocked: false, inventoryJson: '["ion_bow","starter_bow"]', equippedRightHand: "starter_bow" });
  const current = progressOf(f, f.ctx.sender);
  f.seed("playerEndlessRebaseBackup", { identity: f.ctx.sender,
    progressJson: JSON.stringify({ equippedRightHand: "ion_bow" }) });
  expect(() => f.run(server.savePlayerProgress, { ...current, equippedRightHand: "ion_bow", damage: 1e25 })).not.toThrow();
  expect(progressOf(f, f.ctx.sender)).toMatchObject({ equippedRightHand: "ion_bow", damage: current.damage });
  // Gear not owned is still refused, without an error: the head stays as it was.
  expect(() => f.run(server.savePlayerProgress, { ...progressOf(f, f.ctx.sender), equippedHead: "ion_helmet" })).not.toThrow();
  expect(progressOf(f, f.ctx.sender).equippedHead).not.toBe("ion_helmet");
});

it("converts online and offline accounts once, backs up stats, gates gear and retains loot receipts", () => {
  const f = crystalFixture();
  f.seed("moduleMigrationState", { id: 0, version: 31 });
  f.ctx.connectionId = null;
  f.patch("playerProgress", { damage: 1e20, maxHp: 2e20, armor: 1e19, regen: 1e18 });
  const original = f.progress(identity("2"), { damage: 1e22, maxHp: 2e22, armor: 1e21, regen: 1e20,
    ...Object.fromEntries(CAMPAIGN_UNLOCK_FIELDS.map(field => [field, true])), bossRewardClaims: 32767, inventoryJson: '["starter_stone","starter_bow","basic_paper_hat"]', equippedRightHand: "starter_bow" });
  f.seed("regularEnemyLootCursor", { key: "receipt", identity: identity("2"), sequence: 12n });
  // 63's Crude weapons have their own tests (starter-chest.test.ts).
  for (const who of [f.ctx.sender, identity("2")]) f.seed("playerStarterWeapon", { identity: who, kind: "all", at: f.ctx.timestamp });
  f.run(server.onConnect);
  const next = progressOf(f, identity("2"));
  const expected = rebaseProgressByEffort(original, null, () => 0);
  // 62 then pays the old Forest bow out; the rest of the bag stays.
  expect(next).toMatchObject(progressWithoutOldGear(expected.progress).progress);
  expect(next.ionCitadelUnlocked).toBe(false);
  expect(next.inventoryJson).toContain("basic_paper_hat");
  expect(f.db.playerEndlessRebaseBackup.identity.find(identity("2"))).toMatchObject({ damage: original.damage, maxHp: original.maxHp });
  expect(f.db.regularEnemyLootCursor.key.find("receipt")).toBeTruthy();
  expect(f.db.playerBalanceVersion.identity.find(identity("2")).version).toBe(9);
  expect(f.db.moduleMigrationState.id.find(0).version).toBe(MODULE_MIGRATION_VERSION);
  f.patch("playerProgress", { damage: next.damage + 1000 }, identity("2"));
  f.run(server.onConnect);
  expect(progressOf(f, identity("2")).damage).toBe(next.damage + 1000);
  expect(f.db.playerEndlessRebaseBackup.identity.find(identity("2")).damage).toBe(original.damage);
});

