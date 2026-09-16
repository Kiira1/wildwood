import { expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { HIDDEN_COSMETIC_ITEM_ID } from "../../shared/equipment-appearance";
import { duelPositionsAt } from "../../shared/duel-approach";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it.each(["starter_bow", "wooden_sword"])("freezes the actual %s separately from hidden cosmetics through the saved replay", weapon => {
  const f = crystalFixture(), opponent = identity("b");
  f.patch("playerProgress", { inventoryJson: JSON.stringify([weapon]), equippedRightHand: weapon,
    cosmeticRightHand: HIDDEN_COSMETIC_ITEM_ID, damage: 10, maxHp: 10000 });
  f.progress(opponent, { inventoryJson: '["starter_bow"]', equippedRightHand: "starter_bow", damage: 10, maxHp: 10000 });
  f.seed("playerProfile", { identity: opponent, displayName: "Opponent" });
  f.seed("player", { ...f.db.player.identity.find(f.ctx.sender), identity: opponent });
  f.run(server.requestDuel, { opponent });
  const duel = [...f.db.duel.iter()][0];
  expect(duel).toMatchObject({ challengerWeaponItem: weapon, challengerRightHandItem: "", challengerLeftHandItem: "", challengerAttackRate: 1 });
  expect(duelPositionsAt(duel, 1).challengerMoving).toBe(weapon === "wooden_sword");
  f.ctx.timestamp = new Timestamp(duel.endsAtMicros + 1_000_000n); f.run(server.pulseDuel);
  const finishing = f.db.duel.id.find(duel.id);
  expect(finishing.challengerAttacks).toBeGreaterThan(0);
  expect(finishing.challengerDamageDealt).toBeGreaterThan(0);
  f.ctx.timestamp = new Timestamp(finishing.endsAtMicros); f.run(server.pulseDuel);
  expect(f.db.duelReplay.id.find(duel.id)).toMatchObject({ challengerWeaponItem: weapon, challengerRightHandItem: "" });
});
