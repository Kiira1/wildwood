import { Timestamp } from "spacetimedb";
import { expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { reportEnemy } from "../../tests/helpers/enemy-defeat";
import { eraseIdentityRows } from "./account-erasure";
import { ignoredDropKey, isDropIgnored, keepWantedDrops } from "./ignored-drops";
import { awardDrops } from "./enemy-loot-award";
import { EQUIPMENT_OFFER_LIFETIME_MS } from "../../shared/equipment-copies";
import { MAX_LOOT_FILTER_BATCH, isDropFiltered, lootFilterId } from "../../shared/loot-filter";
import { BASIC_PAPER_HAT, FROST_BOW, GALAXY_BOW, IRON_BOW, SAMURAI_BOW, SAMURAI_HAT, STARTER_STONE, WOODEN_SWORD } from "../../shared/items";
import { ATTACK_BALANCE_VERSION, BOSS_REWARD_CLAIM_BITS, SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;

const listed = (f: Fixture, who = f.ctx.sender) => [...f.db.playerIgnoredDrop.identity.filter(who)].map(row => row.itemId).sort();
const offers = (f: Fixture, who = f.ctx.sender) => [...f.db.pendingEquipmentOffer.identity.filter(who)];
const inventory = (f: Fixture, who = f.ctx.sender): string[] => JSON.parse(progressOf(f, who).inventoryJson);
const drops = (f: Fixture) => [...f.db.playerItemDrop.byIdentity.filter(f.ctx.sender)].map(row => row.itemId).sort();
const filter = (f: Fixture, itemIds: string[], off = true) => f.run(server.setIgnoredDrops, { itemIds, ignored: off });
const seedListed = (f: Fixture, filterId: string, who = f.ctx.sender) =>
  f.seed("playerIgnoredDrop", { key: ignoredDropKey(who, filterId), identity: who, itemId: filterId });
const seedOffer = (f: Fixture, itemId: string, who = f.ctx.sender) =>
  f.seed("pendingEquipmentOffer", { id: 0n, identity: who, itemId, arrowStorm: 0, ricochet: 0, piercingShot: 0, createdAt: f.ctx.timestamp,
    expiresAt: new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + BigInt(EQUIPMENT_OFFER_LIFETIME_MS) * 1_000n) });
/** Every loot roll wins. */
const luckyRandom = (f: Fixture) => {
  Object.assign(f.ctx, { random: Object.assign(() => .1, { integerInRange: (min: number) => min }) });
};
/**
 * Crystal Hollows' old gear arriving as rolled drops, the way kill loot is awarded: the filter, then the bag.
 * Kills no longer drop gear, so the rolls are given; the paper hat test below runs a real kill report.
 */
function hunt(f: Fixture) {
  luckyRandom(f);
  const rolled = new Map(["crystal_bow", "crystal_sword", "crystal_staff", "crystal_armor", "crystal_helmet"].map(id => [id, 1]));
  f.transaction(() => awardDrops(f.ctx as any, keepWantedDrops(f.ctx, f.ctx.sender, rolled)));
}

it("accepts the four slot entries and droppable items, and nothing else", () => {
  expect(["slot:HAND", "slot:CHEST", "slot:HEAD", "slot:FEET"].map(lootFilterId)).toEqual(["slot:HAND", "slot:CHEST", "slot:HEAD", "slot:FEET"]);
  expect(lootFilterId(IRON_BOW)).toBe(IRON_BOW);
  // A cosmetic look that drops can be filtered too: "only bows" means only bows.
  expect(lootFilterId(BASIC_PAPER_HAT)).toBe(BASIC_PAPER_HAT);
  // A sword drops like any bow, so an archer can turn it off.
  expect(lootFilterId(WOODEN_SWORD)).toBe(WOODEN_SWORD);
  for (const bad of ["slot:LEFT_HAND", "slot:", "slot:hand", STARTER_STONE, GALAXY_BOW, "unknown", "", 7]) {
    expect(lootFilterId(bad), String(bad)).toBeUndefined();
  }
  const f = crystalFixture();
  for (const bad of ["slot:RIGHT_HAND", STARTER_STONE, GALAXY_BOW, "unknown"]) {
    expect(() => filter(f, [IRON_BOW, bad])).toThrow(/cannot be filtered/);
  }
  expect(() => filter(f, Array.from({ length: MAX_LOOT_FILTER_BATCH + 1 }, () => IRON_BOW))).toThrow(/at most/);
  expect(listed(f)).toEqual([]);
  filter(f, ["slot:FEET", IRON_BOW, IRON_BOW]);
  expect(listed(f)).toEqual([IRON_BOW, "slot:FEET"]);
});

it("filters an item when its slot is off or it is off itself", () => {
  const set = (...ids: string[]) => (id: string) => ids.includes(id);
  expect(isDropFiltered(IRON_BOW, set())).toBe(false);
  expect(isDropFiltered(IRON_BOW, set(IRON_BOW))).toBe(true);
  expect(isDropFiltered(IRON_BOW, set("slot:HAND"))).toBe(true);
  expect(isDropFiltered(IRON_BOW, set("slot:HEAD", SAMURAI_BOW))).toBe(false);
  expect(isDropFiltered(SAMURAI_HAT, set("slot:HEAD"))).toBe(true);
  // An item turned back on stays filtered while its slot is off.
  expect(isDropFiltered(SAMURAI_HAT, set("slot:HEAD", "slot:HAND"))).toBe(true);
  // Nothing that never drops is ever filtered.
  expect(isDropFiltered(GALAXY_BOW, set("slot:HAND", GALAXY_BOW))).toBe(false);
});

it("marks and unmarks entries for the caller only, and reads them back through its own view", () => {
  const f = crystalFixture();
  seedListed(f, SAMURAI_HAT, identity("3"));
  filter(f, [IRON_BOW, "slot:HEAD"]);
  expect((server.myIgnoredDrops as any)(f.ctx).map((row: any) => row.itemId).sort()).toEqual([IRON_BOW, "slot:HEAD"]);
  filter(f, ["slot:HEAD"], false);
  expect(listed(f)).toEqual([IRON_BOW]);
  expect(listed(f, identity("3"))).toEqual([SAMURAI_HAT]);
});

it("needs the controlling session", () => {
  const f = crystalFixture();
  f.db.playerController.identity.delete(f.ctx.sender);
  expect(() => filter(f, [IRON_BOW])).toThrow();
  expect(listed(f)).toEqual([]);
});

it("never lands a filtered first copy: no bag entry, no offer, no drop event", () => {
  const f = crystalFixture();
  filter(f, ["crystal_bow"]);
  hunt(f);
  expect(inventory(f)).not.toContain("crystal_bow");
  expect(inventory(f)).toEqual(expect.arrayContaining(["crystal_armor", "crystal_helmet", "crystal_sword", "crystal_staff"]));
  expect(offers(f)).toEqual([]);
  expect(drops(f)).toEqual(["crystal_armor", "crystal_helmet", "crystal_staff", "crystal_sword"]);
});

it("drops a filtered duplicate without an offer, and never swaps it for another item", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: '["crystal_armor"]' });
  filter(f, ["crystal_armor"]);
  hunt(f);
  expect(offers(f)).toEqual([]);
  expect(drops(f)).toEqual(["crystal_bow", "crystal_helmet", "crystal_staff", "crystal_sword"]);
  // The roll is taken and thrown away, not spent on something else.
  const rolled = new Map([["crystal_armor", 2], ["crystal_bow", 1]]);
  f.run((ctx: any) => keepWantedDrops(ctx, ctx.sender, rolled));
  expect([...rolled]).toEqual([["crystal_bow", 1]]);
});

it("turns a whole slot off on a map the player never set anything on", () => {
  const f = crystalFixture();
  // "Only weapons": armor, helmets and boots off, nothing said about Crystal Hollows itself.
  filter(f, ["slot:CHEST", "slot:HEAD", "slot:FEET"]);
  hunt(f);
  expect(drops(f)).toEqual(["crystal_bow", "crystal_staff", "crystal_sword"]);
  expect(inventory(f)).toEqual(expect.arrayContaining(["crystal_bow", "crystal_staff", "crystal_sword"]));
  expect(inventory(f)).not.toContain("crystal_armor");
  expect(inventory(f)).not.toContain("crystal_helmet");
});

it("keeps an item filtered by its slot even when the item itself is on, and lets it through once the slot is back on", () => {
  const f = crystalFixture();
  filter(f, ["slot:HAND"]);
  f.run((ctx: any) => expect(isDropIgnored(ctx, ctx.sender, "crystal_bow")).toBe(true));
  filter(f, ["slot:HAND"], false);
  filter(f, ["crystal_helmet"]);
  hunt(f);
  expect(drops(f)).toEqual(["crystal_armor", "crystal_bow", "crystal_staff", "crystal_sword"]);
});

it("filters what kills still drop: the forest's paper hat, by item or by its slot", () => {
  for (const entry of [BASIC_PAPER_HAT, "slot:HEAD", null]) {
    const f = crystalFixture();
    f.patch("player", { mapId: "tutorial_forest" });
    f.patch("playerProgress", { damage: 1e15, inventoryJson: '["starter_stone"]' });
    if (entry) filter(f, [entry]);
    luckyRandom(f);
    reportEnemy(f);
    expect(drops(f), String(entry)).toEqual(entry ? [] : [BASIC_PAPER_HAT]);
    expect(inventory(f).includes(BASIC_PAPER_HAT), String(entry)).toBe(!entry);
  }
});

it("never rolls boss equipment, regardless of the loot filter", () => {
  const f = crystalFixture();
  f.patch("player", { mapId: "intermediate_snowlands" });
  filter(f, [FROST_BOW]); luckyRandom(f);
  reportEnemy(f, "boss");
  expect(drops(f)).toEqual([]);
});

it("clears waiting offers the new entries cover, by item or by slot, and leaves the rest", () => {
  const f = crystalFixture();
  seedOffer(f, IRON_BOW);
  seedOffer(f, SAMURAI_BOW);
  seedOffer(f, SAMURAI_HAT);
  seedOffer(f, IRON_BOW, identity("2"));
  filter(f, [SAMURAI_HAT]);
  expect(offers(f).map(offer => offer.itemId)).toEqual([IRON_BOW, SAMURAI_BOW]);
  filter(f, ["slot:HAND"]);
  expect(offers(f)).toEqual([]);
  expect(offers(f, identity("2"))).toHaveLength(1);
});

it("still hands over a gift of a filtered item: a gift is deliberate", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW]) });
  filter(f, ["slot:HAND"]);
  f.seed("playerItemGift", { key: "test:gift", identity: f.ctx.sender, campaign: "test", itemId: IRON_BOW, claimed: false, createdAt: f.ctx.timestamp });
  f.run(server.claimDeveloperItemGift, { key: "test:gift" });
  expect(offers(f).map(offer => offer.itemId)).toEqual([IRON_BOW]);
});

it("survives prestige and reset, like the account's other settings", () => {
  const f = crystalFixture();
  filter(f, [IRON_BOW, SAMURAI_HAT]);
  const before = listed(f);
  f.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
  f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 1 });
  f.run(server.prestigeAccount, {});
  expect(f.db.playerPrestige.identity.find(f.ctx.sender)).toMatchObject({ level: 1 });
  expect(listed(f)).toEqual(before);
  f.run(server.resetPlayerProgress, {});
  expect(listed(f)).toEqual(before);
});

it("is erased with the account and leaves other accounts alone", () => {
  const f = crystalFixture();
  filter(f, [IRON_BOW, "slot:HEAD"]);
  seedListed(f, IRON_BOW, identity("3"));
  eraseIdentityRows(f.ctx, [f.ctx.sender]);
  expect(listed(f)).toEqual([]);
  expect(listed(f, identity("3"))).toEqual([IRON_BOW]);
});

it("joins a guest's list to the account's on link and leaves no guest rows", () => {
  const f = crystalFixture();
  const guest = identity("2");
  seedListed(f, IRON_BOW);
  seedListed(f, IRON_BOW, guest);
  seedListed(f, "slot:FEET", guest);
  f.db.playerProgress.identity.delete(f.ctx.sender);
  f.progress(guest);
  f.seed("playerBalanceVersion", { identity: guest, version: ATTACK_BALANCE_VERSION });
  f.seed("accountLink", { code: "ignore-link", guest, createdAt: f.ctx.timestamp });
  f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
  f.run(server.claimGuestAccount, { code: "ignore-link" });
  expect(listed(f)).toEqual([IRON_BOW, "slot:FEET"]);
  expect(listed(f, guest)).toEqual([]);
});
