import { expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { advanceDuelCombat, initialDuelCombatState, DUEL_COMBAT_VERSION } from "../../shared/duel-combat";
import { setGearSlots } from "./gear-cards";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("freezes each side's cards for a duel, Reflect cards in its chance, and resolves them as a replay will", () => {
  const f = crystalFixture(), opponent = identity("b"), who = f.ctx.sender;
  f.patch("playerProgress", { inventoryJson: '["starter_bow","wooden_armor"]', equippedRightHand: "starter_bow", equippedChest: "wooden_armor",
    damage: 10, maxHp: 10000 });
  f.progress(opponent, { inventoryJson: '["starter_bow"]', equippedRightHand: "starter_bow", damage: 10, maxHp: 10000 });
  f.seed("playerProfile", { identity: opponent, displayName: "Opponent" });
  f.seed("player", { ...f.db.player.identity.find(who), identity: opponent });
  setGearSlots(f.ctx as any, who, "starter_bow", 0n, { slots: 2, cards: ["magmalisk_card", "koi_shogun_card"] });
  setGearSlots(f.ctx as any, who, "wooden_armor", 0n, { slots: 1, cards: ["bramble_card"] });
  f.run(server.requestDuel, { opponent });
  const duel = [...f.db.duel.iter()][0];
  const frozen = f.db.duelCombatSnapshot.duelId.find(duel.id);
  expect(duel.combatVersion).toBe(DUEL_COMBAT_VERSION);
  expect(frozen).toMatchObject({ challengerCards: ["magmalisk_card", "koi_shogun_card", "bramble_card"], opponentCards: [], opponentFirstHit: 1 });
  expect(frozen.challengerFirstHit).toBeGreaterThan(1);
  expect(frozen.challengerRiposte).toBeCloseTo(.015, 9);
  f.ctx.timestamp = new Timestamp(duel.endsAtMicros + 1_000_000n); f.run(server.pulseDuel);
  const finishing = f.db.duel.id.find(duel.id);
  const fight = { ...duel, ...frozen };
  const predicted = advanceDuelCombat(fight, initialDuelCombatState(fight), 0, Number(finishing.lastResolvedAt.microsSinceUnixEpoch - duel.startsAtMicros));
  expect(finishing.opponentHp).toBeCloseTo(predicted.opponentHp, 4);
  expect(finishing.challengerDamageDealt).toBeCloseTo(predicted.challengerDamageDealt, 4);
  expect(finishing.challengerDamageDealt).toBeGreaterThan(0);
  expect("cards" in finishing).toBe(false);
});
