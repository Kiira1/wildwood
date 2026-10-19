import { describe, expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { progressOf } from "../../tests/helpers/progress";
import { TOWN_FEET_OFFSET, TOWN_SMITH_POSITION } from "../../shared/town";
import { GRADE_GOLD_PRICE } from "../../shared/gear-grades";
import { masteryPointsForLevel } from "../../shared/weapon-mastery";
import { bagSlotsUsed } from "../../shared/equipment-copies";
import { inventorySlotCapacity } from "../../shared/gems";
import { IRON_BOW } from "../../shared/items";
import { addGold, goldFor } from "./gold";
import { masteryKey } from "./weapon-mastery";
import { inventoryForProgress } from "./progress-helpers";
import type { WeaponSchool } from "../../shared/weapon-mastery";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

/** Beside the Smith with `gold` and each school at a level. */
function atTheSmith(held = 1_000_000, levels: Partial<Record<WeaponSchool, number>> = {}) {
  const f = crystalFixture();
  f.patch("player", { mapId: "town", x: TOWN_SMITH_POSITION.x, y: TOWN_SMITH_POSITION.y - TOWN_FEET_OFFSET });
  f.transaction(() => {
    addGold(f.ctx, f.ctx.sender, held);
    for (const [school, level] of Object.entries(levels)) {
      f.db.playerWeaponMastery.insert({ key: masteryKey(f.ctx.sender, school as WeaponSchool), identity: f.ctx.sender, school, points: BigInt(masteryPointsForLevel(level)) });
    }
  });
  const buy = (itemId: string, expectedPrice = GRADE_GOLD_PRICE[itemId.split("_")[0] as keyof typeof GRADE_GOLD_PRICE] ?? 0) =>
    f.run(server.buyGradeGear, { itemId, expectedPrice: BigInt(expectedPrice) });
  const bag = () => inventoryForProgress(progressOf(f));
  const gold = () => goldFor(f.ctx, f.ctx.sender);
  return { ...f, buy, bag, gold };
}

describe("buying graded gear from the Smith", () => {
  it("takes the price in gold and puts the piece in the bag, collected and not worn", () => {
    const f = atTheSmith(250);
    f.buy("crude_bow");
    expect(f.bag()).toContain("crude_bow");
    expect(f.gold()).toBe(BigInt(250 - GRADE_GOLD_PRICE.crude));
    expect(progressOf(f).equippedRightHand).not.toBe("crude_bow");
    expect(f.db.playerItemCollection.key.find(`${f.ctx.sender.toHexString()}:crude_bow`)).toBeTruthy();
  });

  it("opens a weapon's grade by its school's level", () => {
    const f = atTheSmith(1_000_000, { archery: 5, swordplay: 1 });
    f.buy("rare_bow");
    expect(() => f.buy("sturdy_sword")).toThrow("You need Lv 2 Swordplay.");
    expect(() => f.buy("exquisite_bow")).toThrow("You need Lv 6 Archery.");
    expect(f.bag()).toContain("rare_bow");
    expect(f.gold()).toBe(BigInt(1_000_000 - GRADE_GOLD_PRICE.rare));
  });

  it("opens armor by its class's school, and Heavy by the best school", () => {
    const f = atTheSmith(1_000_000, { sorcery: 5 });
    f.buy("rare_magic_armor");
    f.buy("rare_heavy_helmet");
    expect(() => f.buy("common_light_helmet")).toThrow("You need Lv 1 Archery.");
    expect(() => f.buy("exquisite_heavy_armor")).toThrow("You need Lv 6 Any School.");
    expect(f.bag()).toEqual(expect.arrayContaining(["rare_magic_armor", "rare_heavy_helmet"]));
  });

  it("skips the grades between, and refuses any at or below the best held on the line", () => {
    const f = atTheSmith(1_000_000, { archery: 8 });
    f.buy("crude_bow");
    f.buy("superior_bow");
    expect(() => f.buy("fine_bow")).toThrow("You already have a better one.");
    f.buy("heroic_bow");
    expect(() => f.buy("epic_bow")).toThrow("You already have a better one.");
    // Another line keeps its own best.
    f.buy("fine_light_helmet");
    expect(f.bag()).toEqual(expect.arrayContaining(["crude_bow", "superior_bow", "heroic_bow", "fine_light_helmet"]));
    expect(f.gold()).toBe(BigInt(1_000_000 - GRADE_GOLD_PRICE.crude - GRADE_GOLD_PRICE.superior - GRADE_GOLD_PRICE.heroic - GRADE_GOLD_PRICE.fine));
  });

  it("refuses a piece already held, worn or in the bag", () => {
    const f = atTheSmith();
    f.buy("crude_staff");
    expect(() => f.buy("crude_staff")).toThrow("You already have that.");
    f.patch("playerProgress", { inventoryJson: JSON.stringify(["crude_sword"]), equippedRightHand: "crude_sword" });
    expect(() => f.buy("crude_sword")).toThrow("You already have that.");
    expect(f.gold()).toBe(BigInt(1_000_000 - GRADE_GOLD_PRICE.crude));
  });

  it("refuses when the gold is short, and takes none", () => {
    const f = atTheSmith(GRADE_GOLD_PRICE.crude - 1);
    expect(() => f.buy("crude_bow")).toThrow(`You need ${GRADE_GOLD_PRICE.crude} Gold.`);
    expect(f.gold()).toBe(BigInt(GRADE_GOLD_PRICE.crude - 1));
    expect(f.bag()).not.toContain("crude_bow");
  });

  it("refuses a stale price, and anything he does not sell", () => {
    const f = atTheSmith();
    expect(() => f.buy("crude_bow", 90)).toThrow("The Smith's price changed.");
    expect(() => f.buy(IRON_BOW, 100)).toThrow("The Smith does not sell that.");
    expect(f.gold()).toBe(1_000_000n);
  });

  it("needs a free bag slot", () => {
    const f = atTheSmith();
    f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
    const used = bagSlotsUsed(f.bag(), [IRON_BOW], 0);
    for (let index = used; index < inventorySlotCapacity(0); index++) {
      f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp });
    }
    expect(() => f.buy("crude_bow")).toThrow("Your bag is full. Free a slot first.");
    expect(f.gold()).toBe(1_000_000n);
  });

  it("is only done beside the Smith in the Town", () => {
    const f = atTheSmith();
    f.patch("player", { mapId: "town", x: TOWN_SMITH_POSITION.x + 400, y: TOWN_SMITH_POSITION.y - TOWN_FEET_OFFSET });
    expect(() => f.buy("crude_bow")).toThrow("Talk to the Smith first.");
    f.patch("player", { mapId: "crystal_hollows", x: TOWN_SMITH_POSITION.x, y: TOWN_SMITH_POSITION.y - TOWN_FEET_OFFSET });
    expect(() => f.buy("crude_bow")).toThrow("Talk to the Smith first.");
    expect(f.gold()).toBe(1_000_000n);
  });
});
