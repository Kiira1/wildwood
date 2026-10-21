import { Timestamp } from "spacetimedb";
import { describe, expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { bowSkillKey, bowSkillRollFor } from "./bow-skills";
import { publishItemDrop } from "./equipment-copies";
import { refineLevelFor, setRefineLevel } from "./item-refine";
import { EQUIPMENT_OFFER_LIFETIME_MS } from "../../shared/equipment-copies";
import { IRON_BOW, SAMURAI_HAT } from "../../shared/items";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

// A refine belongs to one copy of an item, and follows it wherever the copy goes (item-refine.ts).
type Fixture = ReturnType<typeof crystalFixture>;
const A = { arrowStorm: 2, ricochet: 0, piercingShot: 0 };

function archer() {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW, SAMURAI_HAT]), equippedRightHand: IRON_BOW });
  f.seed("playerBowSkill", { key: bowSkillKey(f.ctx.sender, IRON_BOW), identity: f.ctx.sender, itemId: IRON_BOW, ...A });
  return f;
}
const level = (f: Fixture, itemId = IRON_BOW, copyId = 0n) => refineLevelFor(f.ctx, f.ctx.sender, itemId, copyId);
const inventory = (f: Fixture): string[] => JSON.parse(progressOf(f, f.ctx.sender).inventoryJson);

// Select, destroy, prestige, sign-in and login moves are in tests/scenarios/gear.test.ts (GEAR-12).
describe("a refine follows its copy", () => {
  it("does not carry over to a kept offer that becomes the first copy after the old one was destroyed", () => {
    const f = archer();
    setRefineLevel(f.ctx, f.ctx.sender, IRON_BOW, 0n, 7);
    const offer = f.seed("pendingEquipmentOffer", { id: 0n, identity: f.ctx.sender, itemId: IRON_BOW, ...A, createdAt: f.ctx.timestamp,
      expiresAt: new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + BigInt(EQUIPMENT_OFFER_LIFETIME_MS) * 1_000n) });
    f.run(server.destroyEquipment, { itemId: IRON_BOW });
    // A stale row left by any other path must not hand the new copy someone else's +7.
    setRefineLevel(f.ctx, f.ctx.sender, IRON_BOW, 0n, 7);
    f.run(server.resolveEquipmentOffer, { id: offer.id, keep: true });
    expect(inventory(f)).toContain(IRON_BOW);
    expect(level(f)).toBe(0);
  });
});

describe("duplicate drops on a refined weapon", () => {
  const luckyRandom = (f: Fixture) => Object.assign(f.ctx, { random: Object.assign(() => .1, { integerInRange: (min: number) => min }) });

  const offers = (f: Fixture) => [...f.db.pendingEquipmentOffer.identity.filter(f.ctx.sender)];

  it("raises a refined weapon's skills in place, keeping the refine", () => {
    const f = archer();
    setRefineLevel(f.ctx, f.ctx.sender, IRON_BOW, 0n, 3);
    const key = bowSkillKey(f.ctx.sender, IRON_BOW);
    f.db.playerBowSkill.key.update({ key, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: .1, ricochet: 0, piercingShot: 0 });
    luckyRandom(f);
    publishItemDrop(f.ctx, f.ctx.sender, IRON_BOW, true, 1);
    const roll = bowSkillRollFor(f.ctx, f.ctx.sender, IRON_BOW);
    expect(roll.ricochet > 0 && roll.piercingShot > 0 && roll.arrowStorm >= .1).toBe(true);
    expect(level(f)).toBe(3);
    expect(offers(f)).toEqual([]);
  });

  it("offers nothing for a refined first copy when the new roll is no better", () => {
    const f = archer();
    setRefineLevel(f.ctx, f.ctx.sender, IRON_BOW, 0n, 3);
    const key = bowSkillKey(f.ctx.sender, IRON_BOW);
    f.db.playerBowSkill.key.update({ key, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 50, ricochet: 50, piercingShot: 50 });
    luckyRandom(f);
    publishItemDrop(f.ctx, f.ctx.sender, IRON_BOW, true, 1);
    expect(offers(f)).toEqual([]);
  });

  it("keeps a high skill and adds the drop's lower ones beside it", () => {
    const f = archer();
    const key = bowSkillKey(f.ctx.sender, IRON_BOW);
    f.db.playerBowSkill.key.update({ key, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 50, ricochet: 0, piercingShot: 0 });
    luckyRandom(f);
    publishItemDrop(f.ctx, f.ctx.sender, IRON_BOW, true, 1);
    const roll = bowSkillRollFor(f.ctx, f.ctx.sender, IRON_BOW);
    expect(roll.arrowStorm).toBe(50);
    expect(roll.ricochet > 0 && roll.piercingShot > 0).toBe(true);
    expect(offers(f)).toEqual([]);
  });
});
