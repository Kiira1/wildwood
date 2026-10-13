import { Timestamp } from "spacetimedb";
import { describe, expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { bowSkillKey, bowSkillRollFor } from "./bow-skills";
import { publishItemDrop } from "./equipment-copies";
import { refineLevelFor, setRefineLevel } from "./item-refine";
import { EQUIPMENT_OFFER_LIFETIME_MS } from "../../shared/equipment-copies";
import { IRON_BOW, SAMURAI_HAT } from "../../shared/items";
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
const keepCopy = (f: Fixture, itemId = IRON_BOW) =>
  f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId, arrowStorm: 0, ricochet: 3, piercingShot: 0, acquiredAt: f.ctx.timestamp });
const level = (f: Fixture, itemId = IRON_BOW, copyId = 0n) => refineLevelFor(f.ctx, f.ctx.sender, itemId, copyId);
const inventory = (f: Fixture): string[] => JSON.parse(f.db.playerProgress.identity.find(f.ctx.sender).inventoryJson);

describe("a refine follows its copy", () => {
  it("swaps with the first copy when a kept copy is chosen, bow or not", () => {
    const f = archer();
    const bow = keepCopy(f), hat = keepCopy(f, SAMURAI_HAT);
    setRefineLevel(f.ctx, f.ctx.sender, IRON_BOW, 0n, 5);
    setRefineLevel(f.ctx, f.ctx.sender, IRON_BOW, bow.id, 2);
    setRefineLevel(f.ctx, f.ctx.sender, SAMURAI_HAT, hat.id, 4);
    f.run(server.selectEquipmentCopy, { copyId: bow.id });
    expect([level(f), level(f, IRON_BOW, bow.id)]).toEqual([2, 5]);
    f.run(server.selectEquipmentCopy, { copyId: hat.id });
    expect([level(f, SAMURAI_HAT), level(f, SAMURAI_HAT, hat.id)]).toEqual([4, 0]);
  });

  it("goes with a kept copy that is destroyed", () => {
    const f = archer();
    const bow = keepCopy(f);
    setRefineLevel(f.ctx, f.ctx.sender, IRON_BOW, bow.id, 6);
    f.run(server.destroyEquipmentCopy, { itemId: IRON_BOW, copyId: bow.id });
    expect(f.db.playerCopyRefine.copyId.find(bow.id)).toBeFalsy();
  });

  it("goes with a destroyed first copy, and the kept copy taking over brings its own", () => {
    const f = archer();
    const bow = keepCopy(f);
    setRefineLevel(f.ctx, f.ctx.sender, IRON_BOW, 0n, 7);
    setRefineLevel(f.ctx, f.ctx.sender, IRON_BOW, bow.id, 3);
    f.run(server.destroyEquipment, { itemId: IRON_BOW });
    expect(level(f)).toBe(3);
    expect(f.db.playerCopyRefine.copyId.find(bow.id)).toBeFalsy();
    expect(inventory(f)).toContain(IRON_BOW);
    // The last copy destroyed: the item and its refine are gone.
    f.run(server.destroyEquipment, { itemId: IRON_BOW });
    expect(inventory(f)).not.toContain(IRON_BOW);
    expect(level(f)).toBe(0);
  });

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

describe("Auto keep best", () => {
  const luckyRandom = (f: Fixture) => Object.assign(f.ctx, { random: Object.assign(() => .1, { integerInRange: (min: number) => min }) });

  it("never replaces a refined first copy, even with a better roll", () => {
    const f = archer();
    setRefineLevel(f.ctx, f.ctx.sender, IRON_BOW, 0n, 3);
    luckyRandom(f);
    publishItemDrop(f.ctx, f.ctx.sender, IRON_BOW, true, 1);
    expect(bowSkillRollFor(f.ctx, f.ctx.sender, IRON_BOW)).toMatchObject(A);
    expect(level(f)).toBe(3);
  });

  it("still replaces an unrefined one, as before", () => {
    const f = archer();
    luckyRandom(f);
    publishItemDrop(f.ctx, f.ctx.sender, IRON_BOW, true, 1);
    expect(bowSkillRollFor(f.ctx, f.ctx.sender, IRON_BOW)).not.toMatchObject(A);
  });
});
