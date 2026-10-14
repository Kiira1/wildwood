import { describe, expect, it, vi } from "vitest";
import { crystalFixture } from "../../tests/helpers/crystal-hollows-fixture";
import { fillDefeatBudget, reportEnemy } from "../../tests/helpers/enemy-defeat";
import { awardCardDrops } from "./card-drops";
import { cardCount, gearSlotsFor } from "./gear-cards";
import { publishItemDrop } from "./equipment-copies";
import { setGearSlots } from "./gear-cards";
import { CARD_DROP_OUTCOMES } from "../../shared/cards";
import { BLACK_BOOTS, IRON_BOW } from "../../shared/items";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
/** ctx.random answering `value` every time; loot's integer rolls lose unless `lootWins`. */
const always = (f: Fixture, value: number, lootWins = false) => {
  Object.assign(f.ctx, { random: Object.assign(() => value, { integerInRange: (min: number, max: number) => lootWins ? min : max }) });
};
const award = (f: Fixture, mapId: string, kills: { enemy: string; count: number }[], bossKills = 0, multiplier = 1) =>
  f.transaction(() => awardCardDrops(f.ctx, f.ctx.sender, mapId, kills, bossKills, multiplier));
const cards = (f: Fixture, cardId: string) => cardCount(f.ctx, f.ctx.sender, cardId);

describe("card drops", () => {
  it("drops a regular enemy's card once in 10,000 kills, an elite's in 20,000, a boss's in 1,000 boss kills", () => {
    const f = crystalFixture();
    // ctx.random() * outcomes < 1 wins: just under 1 / outcomes wins, 1 / outcomes itself does not.
    always(f, .99 / CARD_DROP_OUTCOMES.regular);
    award(f, "tutorial_forest", [{ enemy: "Needle", count: 3 }, { enemy: "King Slime", count: 1 }]);
    expect(cards(f, "needle_card")).toBe(3);
    expect(cards(f, "king_slime_card")).toBe(0); // an elite's chance is half
    always(f, .99 / CARD_DROP_OUTCOMES.elite);
    award(f, "tutorial_forest", [{ enemy: "King Slime", count: 1 }], 1);
    expect(cards(f, "king_slime_card")).toBe(1);
    expect(cards(f, "dragon_card")).toBe(1);
    always(f, 1 / CARD_DROP_OUTCOMES.boss);
    award(f, "tutorial_forest", [{ enemy: "Needle", count: 5 }], 3);
    expect([cards(f, "needle_card"), cards(f, "dragon_card")]).toEqual([3, 1]);
  });

  it("raises every chance alike with a multiplier", () => {
    const f = crystalFixture();
    always(f, 1.5 / CARD_DROP_OUTCOMES.regular);
    award(f, "tutorial_forest", [{ enemy: "Needle", count: 1 }]);
    expect(cards(f, "needle_card")).toBe(0);
    award(f, "tutorial_forest", [{ enemy: "Needle", count: 1 }], 0, 2);
    expect(cards(f, "needle_card")).toBe(1);
  });

  it("drops nothing on maps without cards, and nothing for an enemy that is not on the map", () => {
    const f = crystalFixture();
    always(f, 0);
    award(f, "endless_1", [{ enemy: "site:0", count: 5 }], 1);
    award(f, "beginner_desert", [{ enemy: "Needle", count: 5 }]); // Needle lives in the forest
    expect(f.db.playerCard.count()).toBe(0n);
    expect(f.db.playerCardDrop.count()).toBe(0n);
  });

  it("tells the client what was found, counting every card", () => {
    const f = crystalFixture();
    always(f, 0);
    award(f, "tutorial_forest", [{ enemy: "Needle", count: 2 }]);
    expect(f.db.playerCardDrop.identity.find(f.ctx.sender)).toMatchObject({ cardIds: ["needle_card", "needle_card"], sequence: 2n });
    award(f, "tutorial_forest", [{ enemy: "Brood", count: 1 }]);
    expect(f.db.playerCardDrop.identity.find(f.ctx.sender)).toMatchObject({ cardIds: ["brood_card"], sequence: 3n });
  });

  it("rolls the cards of a paid kill report on Crystal Hollows", () => {
    const f = crystalFixture();
    f.patch("playerProgress", { damage: 1e15 });
    always(f, 0); // every card roll wins; gear loot loses
    fillDefeatBudget(f, "crystal_hollows", "Shard Hopper");
    reportEnemy(f, "Shard Hopper", 2);
    expect(cards(f, "shard_hopper_card")).toBe(2);
  });
});

describe("slots from drops", () => {
  const drop = (f: Fixture, itemId: string, alreadyOwned: boolean, quantity = 1) =>
    f.transaction(() => publishItemDrop(f.ctx, f.ctx.sender, itemId, alreadyOwned, quantity));

  it("rolls 0 to 4 slots for gear entering the bag", () => {
    const f = crystalFixture();
    always(f, .99); // 990 of 1,000: 3 slots (940 + 30 + 18 = 988 are 0 to 2)
    drop(f, IRON_BOW, false);
    expect(gearSlotsFor(f.ctx, f.ctx.sender, IRON_BOW)).toEqual({ slots: 3, cards: [] });
    always(f, .1);
    drop(f, "snow_helmet", false);
    expect(gearSlotsFor(f.ctx, f.ctx.sender, "snow_helmet")).toEqual({ slots: 0, cards: [] });
  });

  it("raises your item's slots with a duplicate that rolls more, keeping its cards, and never lowers them", () => {
    const f = crystalFixture();
    f.transaction(() => setGearSlots(f.ctx, f.ctx.sender, IRON_BOW, 0n, { slots: 2, cards: ["needle_card"] }));
    always(f, .1); // 0 slots: no change
    drop(f, IRON_BOW, true);
    expect(gearSlotsFor(f.ctx, f.ctx.sender, IRON_BOW)).toEqual({ slots: 2, cards: ["needle_card"] });
    always(f, .998); // 4 slots
    drop(f, IRON_BOW, true);
    expect(gearSlotsFor(f.ctx, f.ctx.sender, IRON_BOW)).toEqual({ slots: 4, cards: ["needle_card"] });
    // Gear owned before cards (no row) has one slot to raise from.
    always(f, .5);
    drop(f, "snow_helmet", true);
    expect(gearSlotsFor(f.ctx, f.ctx.sender, "snow_helmet")).toEqual({ slots: 1, cards: [] });
    always(f, .975); // 2 slots
    drop(f, "snow_helmet", true, 2);
    expect(gearSlotsFor(f.ctx, f.ctx.sender, "snow_helmet")).toEqual({ slots: 2, cards: [] });
  });

  it("gives no slots to gear that takes no cards", () => {
    const f = crystalFixture();
    always(f, .995);
    drop(f, BLACK_BOOTS, false);
    drop(f, "basic_paper_hat", false);
    expect(f.db.playerGearSlots.count()).toBe(0n);
  });
});
