import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture } from "../../tests/helpers/crystal-hollows-fixture";
import { fillDefeatBudget, reportEnemy } from "../../tests/helpers/enemy-defeat";
import { awardCardDrops } from "./card-drops";
import { cardCount, gearSlotsFor } from "./gear-cards";
import { publishItemDrop } from "./equipment-copies";
import { setGearSlots } from "./gear-cards";
import { CARD_DROP_OUTCOMES, cardMeterFull } from "../../shared/cards";
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

  it("guarantees a card once its meter fills, at twice the average kills, and starts the meter again", () => {
    const f = crystalFixture();
    always(f, .999); // every roll loses
    const meter = () => f.db.playerCardMeter.key.find(`${f.ctx.sender.toHexString()}:needle_card`)?.progress ?? 0;
    award(f, "tutorial_forest", [{ enemy: "Needle", count: cardMeterFull("regular") - 1 }]);
    expect(cards(f, "needle_card")).toBe(0);
    expect(meter()).toBe(cardMeterFull("regular") - 1);
    award(f, "tutorial_forest", [{ enemy: "Needle", count: 1 }]);
    expect(cards(f, "needle_card")).toBe(1);
    expect(meter()).toBe(0);
    // A lucky roll empties the meter too.
    award(f, "tutorial_forest", [{ enemy: "Needle", count: 10 }]);
    always(f, 0);
    award(f, "tutorial_forest", [{ enemy: "Needle", count: 1 }]);
    expect(meter()).toBe(0);
  });

  it("rolls a boss card at most once per boss respawn on each map, so a repeated boss claim rolls nothing", () => {
    const f = crystalFixture();
    always(f, 0); // every roll wins
    const at = (seconds: number) => { f.ctx.timestamp = new Timestamp(10_000_000n + BigInt(seconds * 1_000_000)); };
    at(0);
    award(f, "tutorial_forest", [], 5);
    expect(cards(f, "dragon_card")).toBe(1);
    // The Dragon respawns in 45 seconds; a claim well inside that rolls nothing, and the gate is not the card's to judge.
    at(20);
    award(f, "tutorial_forest", [], 1);
    expect(cards(f, "dragon_card")).toBe(1);
    // Another map's boss keeps its own timer.
    award(f, "beginner_desert", [], 1);
    expect(f.db.playerCard.count()).toBe(2n);
    at(34);
    award(f, "tutorial_forest", [], 1);
    expect(cards(f, "dragon_card")).toBe(2);
    // Boss Respawn research brings the boss back sooner, and its card with it.
    f.transaction(() => f.ctx.db.playerResearch.insert({ ...f.ctx.db.playerResearch.identity.find(f.ctx.sender), identity: f.ctx.sender, bossRespawn: 5 }));
    at(65);
    award(f, "tutorial_forest", [], 1);
    expect(cards(f, "dragon_card")).toBe(3);
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

  it("raises the kept copy with the fewest slots once your item has all four", () => {
    const f = crystalFixture();
    f.transaction(() => setGearSlots(f.ctx, f.ctx.sender, IRON_BOW, 0n, { slots: 4, cards: ["needle_card"] }));
    const keep = () => f.transaction(() => f.ctx.db.playerEquipmentCopy.insert({ id: 0n, identity: f.ctx.sender, itemId: IRON_BOW,
      arrowStorm: 0, ricochet: 0, piercingShot: 0, whirlwind: 0, deflect: 0, shockwave: 0, acquiredAt: f.ctx.timestamp }).id as bigint);
    const older = keep(), newer = keep();
    f.transaction(() => setGearSlots(f.ctx, f.ctx.sender, IRON_BOW, older, { slots: 2, cards: ["needle_card"] }));
    const slots = (copyId = 0n) => gearSlotsFor(f.ctx, f.ctx.sender, IRON_BOW, copyId);
    always(f, .99); // 3 slots: the newer copy has only the default one
    drop(f, IRON_BOW, true);
    expect([slots(), slots(older), slots(newer)]).toEqual([
      { slots: 4, cards: ["needle_card"] }, { slots: 2, cards: ["needle_card"] }, { slots: 3, cards: [] }]);
    // Now the older copy has the fewest; it keeps its card.
    drop(f, IRON_BOW, true);
    expect(slots(older)).toEqual({ slots: 3, cards: ["needle_card"] });
    // A roll that beats neither changes nothing.
    always(f, .5);
    drop(f, IRON_BOW, true);
    expect([slots(older).slots, slots(newer).slots]).toEqual([3, 3]);
  });

  it("gives no slots to gear that takes no cards", () => {
    const f = crystalFixture();
    always(f, .995);
    drop(f, BLACK_BOOTS, false);
    drop(f, "basic_paper_hat", false);
    expect(f.db.playerGearSlots.count()).toBe(0n);
  });
});
