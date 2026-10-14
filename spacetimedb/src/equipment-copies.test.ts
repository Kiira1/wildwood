import { Timestamp } from "spacetimedb";
import { expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { fillDefeatBudget, reportEnemy } from "../../tests/helpers/enemy-defeat";
import { eraseIdentityRows } from "./account-erasure";
import { bowSkillKey, bowSkillRollFor, duelBowSkillFields } from "./bow-skills";
import { offerDuplicateEquipment, offerItemForFullBag, publishItemDrop } from "./equipment-copies";
import { gearSlotsFor, setGearSlots } from "./gear-cards";
import { oreCount, refineLevelFor, setRefineLevel } from "./item-refine";
import { salvageOre } from "../../shared/refine";
import { inventoryForProgress } from "./progress-helpers";
import { createEmptyResearchRanks } from "../../shared/research";
import {
  EQUIPMENT_OFFER_LIFETIME_MS, MAX_PENDING_EQUIPMENT_OFFERS, bagSlotsUsed, isDuplicateOfferItem,
} from "../../shared/equipment-copies";
import { BASIC_PAPER_HAT, IRON_BOW, SAMURAI_HAT, STARTER_ITEM_IDS, STARTER_STONE, WOODEN_SWORD } from "../../shared/items";
import { BASE_INVENTORY_SLOT_CAPACITY } from "../../shared/gems";
import { ATTACK_BALANCE_VERSION, BOSS_REWARD_CLAIM_BITS, SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
import { cosmeticUnlocks } from "../../shared/cosmetic-conversion";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
type Roll = { arrowStorm: number; ricochet: number; piercingShot: number };
const A: Roll = { arrowStorm: 2, ricochet: 0, piercingShot: 0 };
const B: Roll = { arrowStorm: 0, ricochet: 3, piercingShot: 0 };
const C: Roll = { arrowStorm: 0, ricochet: 0, piercingShot: 4 };
const NONE: Roll = { arrowStorm: 0, ricochet: 0, piercingShot: 0 };

const offers = (f: Fixture, who = f.ctx.sender) => [...f.db.pendingEquipmentOffer.identity.filter(who)];
const copies = (f: Fixture, who = f.ctx.sender) => [...f.db.playerEquipmentCopy.identity.filter(who)];
const rollOf = (row: any): Roll => ({ arrowStorm: row.arrowStorm, ricochet: row.ricochet, piercingShot: row.piercingShot });
const firstRoll = (f: Fixture, itemId = IRON_BOW, who = f.ctx.sender) => rollOf(bowSkillRollFor(f.ctx as any, who, itemId));
const inventory = (f: Fixture, who = f.ctx.sender): string[] => JSON.parse(f.db.playerProgress.identity.find(who).inventoryJson);
const seedFirst = (f: Fixture, roll: Roll, itemId = IRON_BOW, who = f.ctx.sender) =>
  f.seed("playerBowSkill", { key: bowSkillKey(who, itemId), identity: who, itemId, ...roll });
const seedCopy = (f: Fixture, roll: Roll, itemId = IRON_BOW, who = f.ctx.sender) =>
  f.seed("playerEquipmentCopy", { id: 0n, identity: who, itemId, ...roll, acquiredAt: f.ctx.timestamp });
const seedOffer = (f: Fixture, roll: Roll, itemId = IRON_BOW, who = f.ctx.sender, expiresInMs = EQUIPMENT_OFFER_LIFETIME_MS) =>
  f.seed("pendingEquipmentOffer", { id: 0n, identity: who, itemId, ...roll, createdAt: f.ctx.timestamp,
    expiresAt: new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + BigInt(expiresInMs) * 1_000n) });
const later = (f: Fixture, ms: number) => { f.ctx.timestamp = new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + BigInt(ms) * 1_000n); };
/** Every skill appears, at the bottom tenth of its range, and every loot roll wins. */
const luckyRandom = (f: Fixture, float = .1) => {
  Object.assign(f.ctx, { random: Object.assign(() => float, { integerInRange: (min: number) => min }) });
};
/** A player holding an iron bow with roll A in their hand. */
function archer(extra: Record<string, unknown> = {}) {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW, SAMURAI_HAT]), equippedRightHand: IRON_BOW, ...extra });
  seedFirst(f, A);
  return f;
}

it("offers equipment only: never cosmetic looks, starter or developer items", () => {
  expect(isDuplicateOfferItem(IRON_BOW)).toBe(true);
  expect(isDuplicateOfferItem(SAMURAI_HAT)).toBe(true);
  expect(isDuplicateOfferItem(WOODEN_SWORD)).toBe(true);
  expect(isDuplicateOfferItem(BASIC_PAPER_HAT)).toBe(false);
  expect(isDuplicateOfferItem(STARTER_STONE)).toBe(false);
  expect(isDuplicateOfferItem("galaxy_bow")).toBe(false);
  expect(isDuplicateOfferItem("unknown")).toBe(false);
  // Equipped items and cosmetics take no bag slot; each kept copy takes one.
  expect(bagSlotsUsed([IRON_BOW, SAMURAI_HAT, BASIC_PAPER_HAT, IRON_BOW], [IRON_BOW], 2)).toBe(3);
});

it("settles a duplicate enemy drop on the spot: no offer and no spare copy", () => {
  const f = crystalFixture();
  luckyRandom(f);
  f.patch("playerProgress", { damage: 1e15, inventoryJson: '["crystal_armor"]' });
  fillDefeatBudget(f, "crystal_hollows", "Shard Hopper");
  reportEnemy(f, "Shard Hopper", 1);
  // The bow and helmet were new and went into the bag; the armor already held is simply settled.
  expect(inventory(f)).toEqual(expect.arrayContaining(["crystal_bow", "crystal_helmet", "crystal_armor"]));
  expect(inventory(f).filter(id => id === "crystal_armor")).toHaveLength(1);
  expect(offers(f)).toEqual([]);
  expect(copies(f)).toEqual([]);
  // The drop event still says "already owned", which older clients ignore.
  expect(f.db.playerItemDrop.key.find(`${f.ctx.sender.toHexString()}:crystal_armor`).alreadyOwned).toBe(true);
});

it("raises the held weapon's skills in place, each to the higher of the two rolls, never lower", () => {
  const f = archer();
  const weak = { arrowStorm: .1, ricochet: 0, piercingShot: 0 };
  f.db.playerBowSkill.key.update({ key: bowSkillKey(f.ctx.sender, IRON_BOW), identity: f.ctx.sender, itemId: IRON_BOW, ...weak });
  f.transaction(() => {
    setRefineLevel(f.ctx as any, f.ctx.sender, IRON_BOW, 0n, 4);
    setGearSlots(f.ctx as any, f.ctx.sender, IRON_BOW, 0n, { slots: 2, cards: ["needle_card"] });
  });
  f.seed("playerEquipmentLock", { key: `${f.ctx.sender.toHexString()}:${IRON_BOW}`, identity: f.ctx.sender, itemId: IRON_BOW, copyId: 0n });
  luckyRandom(f, .05);
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, IRON_BOW, true));
  const upgraded = firstRoll(f);
  // Every skill rolled, so every skill is at least A's; the refine, cards, slots and lock stay with the weapon.
  expect(upgraded.arrowStorm).toBeGreaterThanOrEqual(weak.arrowStorm);
  expect(upgraded.ricochet).toBeGreaterThan(0);
  expect(upgraded.piercingShot).toBeGreaterThan(0);
  expect(refineLevelFor(f.ctx as any, f.ctx.sender, IRON_BOW)).toBe(4);
  expect(gearSlotsFor(f.ctx as any, f.ctx.sender, IRON_BOW).cards).toEqual(["needle_card"]);
  expect([offers(f), copies(f)]).toEqual([[], []]);
  // A high skill stays high; the drop's low ones are added beside it.
  const strong = { arrowStorm: 99, ricochet: 0, piercingShot: 0 };
  f.db.playerBowSkill.key.update({ key: bowSkillKey(f.ctx.sender, IRON_BOW), identity: f.ctx.sender, itemId: IRON_BOW, ...strong });
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, IRON_BOW, true));
  expect(firstRoll(f)).toEqual({ arrowStorm: 99, ricochet: upgraded.ricochet, piercingShot: upgraded.piercingShot });
  // An equal roll changes nothing either.
  f.db.playerBowSkill.key.update({ key: bowSkillKey(f.ctx.sender, IRON_BOW), identity: f.ctx.sender, itemId: IRON_BOW, ...upgraded });
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, IRON_BOW, true));
  expect(firstRoll(f)).toEqual(upgraded);
});

it("settles every copy past the first when one report drops several, keeping none", () => {
  const f = crystalFixture();
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, IRON_BOW, false, 3));
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, IRON_BOW, true, 2));
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, BASIC_PAPER_HAT, true, 2));
  expect([offers(f), copies(f)]).toEqual([[], []]);
});

it("offers a gifted item the player already has instead of dropping it", () => {
  const f = archer();
  f.seed("playerItemGift", { key: "test:gift", identity: f.ctx.sender, campaign: "test", itemId: IRON_BOW, claimed: false, createdAt: f.ctx.timestamp });
  f.run(server.claimDeveloperItemGift, { key: "test:gift" });
  expect(offers(f).map(offer => offer.itemId)).toEqual([IRON_BOW]);
  expect(firstRoll(f)).toEqual(A);
});

it("keeps an offered copy as another copy in the bag with its own roll, and ignores idempotently", () => {
  const f = archer();
  const kept = seedOffer(f, B);
  const ignored = seedOffer(f, C);
  f.run(server.resolveEquipmentOffer, { id: kept.id, keep: true });
  expect(copies(f).map(rollOf)).toEqual([B]);
  expect(copies(f)[0].itemId).toBe(IRON_BOW);
  expect(firstRoll(f)).toEqual(A);
  expect(inventory(f).filter(id => id === IRON_BOW)).toHaveLength(1);
  f.run(server.resolveEquipmentOffer, { id: ignored.id, keep: false });
  expect(offers(f)).toEqual([]);
  expect(copies(f)).toHaveLength(1);
  // Answering again, either way, changes nothing.
  f.run(server.resolveEquipmentOffer, { id: kept.id, keep: true });
  f.run(server.resolveEquipmentOffer, { id: ignored.id, keep: true });
  expect(copies(f)).toHaveLength(1);
});

it("never lets another player answer an offer", () => {
  const f = archer();
  const theirs = seedOffer(f, B, IRON_BOW, identity("2"));
  f.run(server.resolveEquipmentOffer, { id: theirs.id, keep: true });
  f.run(server.resolveEquipmentOffer, { id: theirs.id, keep: false });
  expect(offers(f, identity("2"))).toHaveLength(1);
  expect(copies(f)).toEqual([]);
  expect((server.myEquipmentOffers as any)(f.ctx)).toEqual([]);
  expect((server.myEquipmentCopies as any)(f.ctx)).toEqual([]);
});

it("refuses Keep with a full bag and leaves the offer waiting", () => {
  // The bow is equipped, the hat and starter items take their slots, and kept copies fill the rest.
  const f = archer();
  const used = bagSlotsUsed([SAMURAI_HAT, ...STARTER_ITEM_IDS], [], 0);
  for (let n = used; n < BASE_INVENTORY_SLOT_CAPACITY; n += 1) seedCopy(f, NONE, SAMURAI_HAT);
  const offer = seedOffer(f, B);
  expect(() => f.run(server.resolveEquipmentOffer, { id: offer.id, keep: true })).toThrow("bag is full");
  expect(offers(f)).toHaveLength(1);
  // One more bag slot, and it fits.
  f.seed("playerInventoryCapacity", { identity: f.ctx.sender, slotsUnlocked: 1, updatedAt: f.ctx.timestamp });
  f.run(server.resolveEquipmentOffer, { id: offer.id, keep: true });
  expect(offers(f)).toEqual([]);
});

it("makes a kept copy the first one when the copy the player had is gone", () => {
  const f = archer({ inventoryJson: JSON.stringify([SAMURAI_HAT]), equippedRightHand: "" });
  const offer = seedOffer(f, B);
  f.run(server.resolveEquipmentOffer, { id: offer.id, keep: true });
  expect(inventory(f)).toContain(IRON_BOW);
  expect(copies(f)).toEqual([]);
  expect(firstRoll(f)).toEqual(B);
});

/** Bag slots in use, counted as the server counts them (starter items included). */
const bagUsed = (f: Fixture) => {
  const progress = f.db.playerProgress.identity.find(f.ctx.sender);
  return bagSlotsUsed(inventoryForProgress(progress), [progress.equippedHead, progress.equippedChest, progress.equippedFeet, progress.equippedRightHand, progress.equippedLeftHand], copies(f).length);
};
/** Fills the bag with kept hat copies until `free` slots are left. */
const fillBag = (f: Fixture, free: number) => {
  for (let n = bagUsed(f); n < BASE_INVENTORY_SLOT_CAPACITY - free; n += 1) seedCopy(f, NONE, SAMURAI_HAT);
};
const NEW_CRYSTAL_GEAR = ["crystal_bow", "crystal_helmet", "crystal_armor", "crystal_sword"];

it("turns new drops that find the bag full into offers, so the bag never holds more than its size", () => {
  const f = archer({ damage: 1e15 });
  luckyRandom(f);
  fillBag(f, 1);
  fillDefeatBudget(f, "crystal_hollows", "Shard Hopper");
  reportEnemy(f, "Shard Hopper", 1);
  // One slot was free: one new item went in, and the rest wait.
  const kept = NEW_CRYSTAL_GEAR.filter(itemId => inventory(f).includes(itemId));
  expect(kept).toHaveLength(1);
  expect(offers(f).map(offer => offer.itemId).sort()).toEqual(NEW_CRYSTAL_GEAR.filter(itemId => !kept.includes(itemId)).sort());
  expect(bagUsed(f)).toBe(BASE_INVENTORY_SLOT_CAPACITY);
  // An item waiting in an offer is not announced as found.
  for (const offer of offers(f)) expect(f.db.playerItemDrop.key.find(`${f.ctx.sender.toHexString()}:${offer.itemId}`)).toBeFalsy();
});

it("offers every new drop when the bag is full, and Keep makes one the first copy with its own slots once a slot is free", () => {
  const f = archer({ damage: 1e15 });
  luckyRandom(f);
  fillBag(f, 0);
  const before = inventory(f);
  fillDefeatBudget(f, "crystal_hollows", "Shard Hopper");
  reportEnemy(f, "Shard Hopper", 1);
  expect(inventory(f)).toEqual(before);
  expect(offers(f).map(offer => offer.itemId).sort()).toEqual([...NEW_CRYSTAL_GEAR].sort());
  const bow = offers(f).find(offer => offer.itemId === "crystal_bow")!;
  expect(() => f.run(server.resolveEquipmentOffer, { id: bow.id, keep: true })).toThrow("bag is full");
  f.seed("playerInventoryCapacity", { identity: f.ctx.sender, slotsUnlocked: 1, updatedAt: f.ctx.timestamp });
  f.run(server.resolveEquipmentOffer, { id: bow.id, keep: true });
  expect(inventory(f)).toContain("crystal_bow");
  // It rolls its slots as a drop does: 100 of 1,000 is no slot.
  expect(gearSlotsFor(f.ctx, f.ctx.sender, "crystal_bow")).toEqual({ slots: 0, cards: [] });
});

it("counts Bag Slots research as room for a new drop", () => {
  const f = archer({ damage: 1e15 });
  luckyRandom(f);
  fillBag(f, 0);
  f.seed("playerResearch", { identity: f.ctx.sender, frontierMastery: 0, ...createEmptyResearchRanks(), inventorySlots: 1 });
  fillDefeatBudget(f, "crystal_hollows", "Shard Hopper");
  reportEnemy(f, "Shard Hopper", 1);
  expect(NEW_CRYSTAL_GEAR.filter(itemId => inventory(f).includes(itemId))).toHaveLength(1);
});

it("waits once for gear without skills, but offers each weapon roll, when the bag is full", () => {
  const f = archer();
  f.run((ctx: any) => { offerItemForFullBag(ctx, ctx.sender, "crystal_helmet"); offerItemForFullBag(ctx, ctx.sender, "crystal_helmet", 2); });
  f.run((ctx: any) => { offerItemForFullBag(ctx, ctx.sender, "crystal_bow"); offerItemForFullBag(ctx, ctx.sender, "crystal_bow", 2); });
  expect(offers(f).map(offer => offer.itemId)).toEqual(["crystal_helmet", "crystal_bow", "crystal_bow", "crystal_bow"]);
});

it("rolls a kept copy's own slots instead of handing it a free one", () => {
  const f = archer();
  const offer = seedOffer(f, B);
  luckyRandom(f, .998); // 998 of 1,000: four slots
  f.run(server.resolveEquipmentOffer, { id: offer.id, keep: true });
  const [copy] = copies(f);
  expect(gearSlotsFor(f.ctx, f.ctx.sender, IRON_BOW, copy.id)).toEqual({ slots: 4, cards: [] });
});

it("ignores unanswered offers after five minutes, and an ignored offer cannot be kept", () => {
  const f = archer();
  const offer = seedOffer(f, B);
  later(f, EQUIPMENT_OFFER_LIFETIME_MS - 1);
  f.run(server.runMaintenance, {});
  expect(offers(f)).toHaveLength(1);
  later(f, 1);
  expect(() => f.run(server.resolveEquipmentOffer, { id: offer.id, keep: true })).toThrow("ran out of time");
  f.run(server.runMaintenance, {});
  expect(offers(f)).toEqual([]);
  expect(copies(f)).toEqual([]);
});

it(`caps waiting offers at ${MAX_PENDING_EQUIPMENT_OFFERS}, ignoring the oldest`, () => {
  const f = archer();
  for (let n = 0; n < MAX_PENDING_EQUIPMENT_OFFERS + 2; n += 1) {
    f.run((ctx: any) => offerDuplicateEquipment(ctx, ctx.sender, n < 2 ? SAMURAI_HAT : IRON_BOW));
  }
  expect(offers(f)).toHaveLength(MAX_PENDING_EQUIPMENT_OFFERS);
  expect(offers(f).map(offer => offer.itemId)).not.toContain(SAMURAI_HAT);
  // Someone else's offers do not count against this player's.
  f.run((ctx: any) => offerDuplicateEquipment(ctx, identity("2"), IRON_BOW, 50));
  expect(offers(f, identity("2"))).toHaveLength(MAX_PENDING_EQUIPMENT_OFFERS);
  expect(offers(f)).toHaveLength(MAX_PENDING_EQUIPMENT_OFFERS);
});

it("equips a chosen copy by swapping rolls, so kill bounds and duels read the copy in hand", () => {
  const f = archer();
  const b = seedCopy(f, B);
  const c = seedCopy(f, C);
  f.run(server.selectEquipmentCopy, { copyId: c.id });
  expect(firstRoll(f)).toEqual(C);
  expect(copies(f).map(row => [row.id, rollOf(row)])).toEqual([[b.id, B], [c.id, A]]);
  expect(duelBowSkillFields(f.ctx as any, { challenger: f.ctx.sender, opponent: identity("2"), challengerWeaponItem: IRON_BOW }))
    .toMatchObject({ challengerArrowStorm: 0, challengerRicochet: 0, challengerPiercingShot: 4 });
  expect(() => f.run(server.selectEquipmentCopy, { copyId: 999n })).toThrow("not in your inventory");
});

it("gives a bow held before skills existed an explicit no-skills roll when another copy is equipped", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW });
  const b = seedCopy(f, B);
  f.run(server.selectEquipmentCopy, { copyId: b.id });
  expect(firstRoll(f)).toEqual(B);
  expect(copies(f).map(rollOf)).toEqual([NONE]);
});

it("destroys exactly the copy asked for, and a destroyed first copy is replaced by the oldest kept one", () => {
  const f = archer();
  const b = seedCopy(f, B);
  const c = seedCopy(f, C);
  f.run(server.destroyEquipmentCopy, { itemId: IRON_BOW, copyId: c.id });
  expect(copies(f).map(row => row.id)).toEqual([b.id]);
  expect(firstRoll(f)).toEqual(A);
  // The first copy is the equipped one: B takes its place, still in hand.
  f.run(server.destroyEquipmentCopy, { itemId: IRON_BOW, copyId: 0n });
  expect(firstRoll(f)).toEqual(B);
  expect(copies(f)).toEqual([]);
  expect(f.db.playerProgress.identity.find(f.ctx.sender).equippedRightHand).toBe(IRON_BOW);
  // The last copy goes the way it always has, and its roll goes with it.
  f.run(server.destroyEquipment, { itemId: IRON_BOW });
  expect(inventory(f)).not.toContain(IRON_BOW);
  expect(f.db.playerProgress.identity.find(f.ctx.sender).equippedRightHand).toBe("");
  expect(f.db.playerBowSkill.key.find(bowSkillKey(f.ctx.sender, IRON_BOW))).toBeNull();
});

it("routes the old destroy_equipment through the same replacement rule and refuses a copy of another item", () => {
  const f = archer();
  const hat = seedCopy(f, NONE, SAMURAI_HAT);
  seedCopy(f, C);
  f.run(server.destroyEquipment, { itemId: IRON_BOW });
  expect(inventory(f)).toContain(IRON_BOW);
  expect(firstRoll(f)).toEqual(C);
  expect(() => f.run(server.destroyEquipmentCopy, { itemId: IRON_BOW, copyId: hat.id })).toThrow("not in your inventory");
  expect(() => f.run(server.destroyEquipmentCopy, { itemId: STARTER_STONE, copyId: 0n })).toThrow("cannot be destroyed");
  const theirs = seedCopy(f, B, IRON_BOW, identity("2"));
  expect(() => f.run(server.destroyEquipmentCopy, { itemId: IRON_BOW, copyId: theirs.id })).toThrow("not in your inventory");
});

it("converts an item to a cosmetic without touching any copy", () => {
  const f = archer();
  seedCopy(f, B);
  f.seed("playerGemWallet", { identity: f.ctx.sender, balance: 100n, revision: 0n, updatedAt: f.ctx.timestamp });
  f.run(server.convertItemToCosmetic, { itemId: IRON_BOW });
  expect(cosmeticUnlocks(f.db.playerProgress.identity.find(f.ctx.sender).cosmeticItemsJson)).toContain(IRON_BOW);
  expect(copies(f).map(rollOf)).toEqual([B]);
  expect(firstRoll(f)).toEqual(A);
});

it("keeps kept copies through prestige but takes them on reset; waiting offers go either way", () => {
  for (const [reducer, keepsCopies] of [["prestigeAccount", true], ["resetPlayerProgress", false]] as const) {
    const f = archer({ bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
    f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 1 });
    seedCopy(f, B);
    seedOffer(f, C);
    seedCopy(f, B, IRON_BOW, identity("2"));
    f.run(server[reducer], {});
    expect(copies(f).map(rollOf)).toEqual(keepsCopies ? [B] : []);
    expect(offers(f)).toEqual([]);
    expect(copies(f, identity("2"))).toHaveLength(1);
    expect(firstRoll(f)).toEqual(A); // Rolls are never taken: a bow dropping again keeps its roll.
  }
});

it("moves a guest's copies and offers to the account it links to, replacing the account's copies", () => {
  const f = crystalFixture();
  const guest = identity("2");
  seedCopy(f, NONE, SAMURAI_HAT); // the account's own, from a bag the guest's replaces
  f.db.playerProgress.identity.delete(f.ctx.sender);
  f.progress(guest, { inventoryJson: JSON.stringify([IRON_BOW]) });
  f.seed("playerBalanceVersion", { identity: guest, version: ATTACK_BALANCE_VERSION });
  seedCopy(f, B, IRON_BOW, guest);
  seedOffer(f, C, IRON_BOW, guest);
  f.seed("accountLink", { code: "copy-link", guest, createdAt: f.ctx.timestamp });
  f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
  f.run(server.claimGuestAccount, { code: "copy-link" });
  expect(copies(f, guest)).toEqual([]);
  expect(offers(f, guest)).toEqual([]);
  expect(copies(f).map(row => [row.itemId, rollOf(row)])).toEqual([[IRON_BOW, B]]);
  expect(offers(f).map(rollOf)).toEqual([C]);
});

it("is erased with the account and leaves other accounts alone", () => {
  const f = archer();
  seedCopy(f, B);
  seedOffer(f, C);
  seedCopy(f, B, IRON_BOW, identity("3"));
  eraseIdentityRows(f.ctx, [f.ctx.sender]);
  expect(copies(f)).toEqual([]);
  expect(offers(f)).toEqual([]);
  expect(copies(f, identity("3"))).toHaveLength(1);
});

it("gives back one ore of the gear's refine grade when it is destroyed, a kept copy included", () => {
  const f = archer();
  const ore = salvageOre(IRON_BOW)!;
  expect(ore).toBeTruthy();
  seedCopy(f, B);
  const [copy] = copies(f);
  f.run(server.destroyEquipmentCopy, { itemId: IRON_BOW, copyId: copy.id });
  expect(oreCount(f.ctx as any, f.ctx.sender, ore)).toBe(1);
  f.patch("playerProgress", { equippedRightHand: "" });
  f.run(server.destroyEquipment, { itemId: IRON_BOW });
  expect(oreCount(f.ctx as any, f.ctx.sender, ore)).toBe(2);
  // Gear without a refine grade gives nothing back.
  expect(salvageOre(BASIC_PAPER_HAT)).toBeNull();
});

it("records each item that drops in the Gear Collection once, for good", () => {
  const f = crystalFixture();
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, IRON_BOW, false));
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, IRON_BOW, true, 3));
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, SAMURAI_HAT, false));
  expect([...f.db.playerItemCollection.identity.filter(f.ctx.sender)].map((row: any) => row.itemId).sort()).toEqual([IRON_BOW, SAMURAI_HAT].sort());
});

it("forgets a weapon's roll once its last copy is destroyed, so the next one to drop rolls fresh", () => {
  const f = archer();
  f.patch("playerProgress", { equippedRightHand: "" });
  f.run(server.destroyEquipment, { itemId: IRON_BOW });
  expect(f.db.playerBowSkill.key.find(bowSkillKey(f.ctx.sender, IRON_BOW))).toBeNull();
  luckyRandom(f, .05);
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, IRON_BOW, false));
  expect(firstRoll(f)).not.toEqual(A);
});
