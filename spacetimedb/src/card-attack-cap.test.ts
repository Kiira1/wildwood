import { expect, it, vi } from "vitest";
import { crystalFixture } from "../../tests/helpers/crystal-hollows-fixture";
import { fillDefeatBudget, reportEnemy } from "../../tests/helpers/enemy-defeat";
import { setGearSlots } from "./gear-cards";
import { attackCapInPlay } from "./prestige";
import { syncCardAttackCap } from "./card-attack-cap";
import { readPlayerProgress } from "./wide-stats";
import { attackIntervalForRating, attackIntervalUnderNewCap, ratingForLevels } from "../../shared/stat-rating";
import { IRON_BOW } from "../../shared/items";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

/** An archer twenty levels into attack speed, with a slot free in the bow. */
function archer() {
  const f = crystalFixture();
  const baseCap = attackCapInPlay(f.ctx, f.ctx.sender);
  f.patch("playerProgress", { damage: 1e15, inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW,
    attackRate: attackIntervalForRating(ratingForLevels(20), baseCap) });
  return { f, baseCap, rate: () => readPlayerProgress(f.ctx, f.ctx.sender).attackRate as number };
}
const slot = (f: any, cards: string[]) => f.transaction(() => setGearSlots(f.ctx, f.ctx.sender, IRON_BOW, 0n, { slots: 2, cards }));

it("keeps the run's attack speed rating when a Quick Draw card raises the cap, and when it comes out", () => {
  const { f, baseCap, rate } = archer();
  const before = rate();
  slot(f, ["ion_needle_card"]);
  const raised = attackCapInPlay(f.ctx, f.ctx.sender);
  expect(raised.raise).toBeGreaterThan(baseCap.raise);
  f.transaction(() => syncCardAttackCap(f.ctx, f.ctx.sender));
  // Faster at once, exactly where the same rating sits under the higher cap.
  expect(rate()).toBeLessThan(before);
  expect(rate()).toBeCloseTo(attackIntervalUnderNewCap(before, baseCap, raised), 12);
  expect(f.db.playerCardAttackCap.identity.find(f.ctx.sender).raise).toBeCloseTo(raised.raise - baseCap.raise, 12);
  // Nothing moved: a second sync changes nothing.
  const synced = rate();
  f.transaction(() => syncCardAttackCap(f.ctx, f.ctx.sender));
  expect(rate()).toBe(synced);
  // The card out again: back where it started.
  slot(f, []);
  f.transaction(() => syncCardAttackCap(f.ctx, f.ctx.sender));
  expect(rate()).toBeCloseTo(before, 12);
});

it("catches up on the next kill report after a card goes in", () => {
  const { f, rate } = archer();
  const before = rate();
  slot(f, ["ion_needle_card"]);
  fillDefeatBudget(f, "crystal_hollows", "Shard Hopper");
  reportEnemy(f, "Shard Hopper", 1);
  expect(f.db.playerCardAttackCap.identity.find(f.ctx.sender)).toBeTruthy();
  expect(rate()).toBeLessThan(before);
});
