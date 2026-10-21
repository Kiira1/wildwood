import { describe, expect, it } from "vitest";
// The server harness first: it swaps the host SDK in before any server module loads.
import { scenarioWorld, type ScenarioPlayer, type ScenarioWorld } from "./harness/server";
import { Timestamp } from "spacetimedb";
import { NAME_CHANGE_COOLDOWN_MS } from "../../shared/name-change";
import { COSMETIC_CONVERSION_GEM_COST } from "../../shared/cosmetic-conversion";
import { OX_SHOP_GEM_PRICE } from "../../shared/ox-shop";
import { GALAXY_ARMOR, GALAXY_BOOTS, STARTER_BOW, STARTER_STONE, EQUIPMENT_DROP_ITEM_IDS } from "../../shared/items";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
import { GEAR_MAIL_ID, GEAR_MAIL_TITLE, GEAR_MAIL_BODY } from "../../shared/mailbox-equipment";
import { BASE_INVENTORY_SLOT_CAPACITY } from "../../shared/gems";
import { ALPHA_TESTER_GIFT_CAMPAIGN, ALPHA_TESTER_GIFT_ITEM, ALPHA_TESTER_REGISTRATION_START } from "../../shared/item-gifts";
import { linkGuest, setGems } from "./harness/economy";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const gems = (world: ScenarioWorld, player: ScenarioPlayer) => world.db.playerGemWallet.identity.find(player.identity)?.balance ?? 0n;
const ledger = (world: ScenarioWorld, kind: string) => [...world.db.gemTransaction.iter()].filter(row => row.kind === kind);
const nameOf = (world: ScenarioWorld, player: ScenarioPlayer) => world.db.playerProfile.identity.find(player.identity).displayName;
const owner = (world: ScenarioWorld) => world.player("Owner", "owner");

describe("Gem spends on the server", () => {
  it("the first rename is free; the next waits a day and costs exactly the 50 Gems shown, once, and a refused one costs nothing", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann");
    setGems(world, ann, 0n);
    // An unexpected price is refused even for the free one.
    expect(ann.refusal("changeDisplayName", { displayName: "First Name", expectedCost: 50 })).not.toBeNull();
    ann.call("setDisplayName", { displayName: "First Name" });
    expect([nameOf(world, ann), gems(world, ann)]).toEqual(["First Name", 0n]);
    setGems(world, ann, 100n);
    world.advance(NAME_CHANGE_COOLDOWN_MS - 1);
    expect(ann.refusal("changeDisplayName", { displayName: "New Name", expectedCost: 50 })).not.toBeNull();
    world.advance(1);
    // A free-looking call, or a different price, never spends.
    expect(ann.refusal("setDisplayName", { displayName: "Another Name" })).not.toBeNull();
    expect(ann.refusal("changeDisplayName", { displayName: "New Name", expectedCost: 1 })).not.toBeNull();
    expect(ann.refusal("changeDisplayName", { displayName: "!invalid!", expectedCost: 50 })).not.toBeNull();
    const bob = world.join("Bob");
    bob.call("setDisplayName", { displayName: "Taken Name" });
    expect(ann.refusal("changeDisplayName", { displayName: "taken name", expectedCost: 50 })).not.toBeNull();
    expect([nameOf(world, ann), gems(world, ann)]).toEqual(["First Name", 100n]);
    ann.call("changeDisplayName", { displayName: "New Name", expectedCost: 50 });
    expect([nameOf(world, ann), gems(world, ann)]).toEqual(["New Name", 50n]);
    // A retry of the same name does not charge again; a new one waits another day.
    ann.call("changeDisplayName", { displayName: "New Name", expectedCost: 50 });
    expect(gems(world, ann)).toBe(50n);
    expect(ledger(world, "name_change")).toHaveLength(1);
    expect(ann.refusal("changeDisplayName", { displayName: "Third Name", expectedCost: 50 })).not.toBeNull();
    // Short of Gems: refused, nothing changes.
    world.advance(NAME_CHANGE_COOLDOWN_MS);
    setGems(world, ann, 49n);
    expect(ann.refusal("changeDisplayName", { displayName: "Third Name", expectedCost: 50 })).not.toBeNull();
    expect([nameOf(world, ann), gems(world, ann)]).toEqual(["New Name", 49n]);
  });

  it("an item's look costs exactly 10 Gems and keeps the item; the look outlasts the item, a prestige and a reset; short of Gems, nothing changes", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann");
    ann.patch("playerProgress", { inventoryJson: JSON.stringify([STARTER_STONE, STARTER_BOW]), equippedRightHand: STARTER_BOW });
    setGems(world, ann, COSMETIC_CONVERSION_GEM_COST - 1n);
    expect(ann.refusal("convertItemToCosmetic", { itemId: STARTER_BOW })).not.toBeNull();
    expect(JSON.parse(ann.progress().cosmeticItemsJson)).toEqual([]);
    setGems(world, ann, 25n);
    ann.call("convertItemToCosmetic", { itemId: STARTER_BOW });
    const progress = ann.progress();
    expect(JSON.parse(progress.cosmeticItemsJson)).toEqual([STARTER_BOW]);
    expect(JSON.parse(progress.inventoryJson)).toContain(STARTER_BOW);
    expect(progress.equippedRightHand).toBe(STARTER_BOW);
    expect(gems(world, ann)).toBe(25n - COSMETIC_CONVERSION_GEM_COST);
    expect(ledger(world, "cosmetic_conversion").map(row => row.delta)).toEqual([-COSMETIC_CONVERSION_GEM_COST]);
    expect(ann.refusal("convertItemToCosmetic", { itemId: STARTER_BOW })).not.toBeNull();
    // Destroyed, the look stays wearable.
    ann.call("destroyEquipment", { itemId: STARTER_BOW });
    ann.call("savePlayerProgress", { ...ann.progress(), cosmeticRightHand: STARTER_BOW, enemyKills: 0 });
    expect(ann.progress().cosmeticRightHand).toBe(STARTER_BOW);
    ann.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
    ann.call("prestigeAccount");
    expect(JSON.parse(ann.progress().cosmeticItemsJson)).toContain(STARTER_BOW);
    ann.call("resetPlayerProgress");
    expect(JSON.parse(ann.progress().cosmeticItemsJson)).toContain(STARTER_BOW);
  });

  it("Ox sells each Galaxy piece once for 750 Gems as a look to wear; short, or asked for something else, he takes nothing; a forged save cannot wear one", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann"), cheat = world.join("Cheat");
    setGems(world, ann, 1_000n);
    ann.call("buyOxShopCosmetic", { itemId: GALAXY_ARMOR });
    expect(JSON.parse(ann.progress().cosmeticItemsJson)).toEqual([GALAXY_ARMOR]);
    expect(gems(world, ann)).toBe(1_000n - OX_SHOP_GEM_PRICE);
    expect(ledger(world, "ox_shop_cosmetic").map(row => row.delta)).toEqual([-OX_SHOP_GEM_PRICE]);
    ann.call("savePlayerProgress", { ...ann.progress(), cosmeticChest: GALAXY_ARMOR, enemyKills: 0 });
    expect(ann.progress().cosmeticChest).toBe(GALAXY_ARMOR);
    expect(ann.refusal("buyOxShopCosmetic", { itemId: GALAXY_ARMOR })).not.toBeNull();
    expect(ann.refusal("buyOxShopCosmetic", { itemId: GALAXY_BOOTS })).not.toBeNull();
    expect(ann.refusal("buyOxShopCosmetic", { itemId: STARTER_BOW })).not.toBeNull();
    expect(gems(world, ann)).toBe(250n);
    // A bought piece outlasts a reset.
    ann.call("resetPlayerProgress");
    expect(JSON.parse(ann.progress().cosmeticItemsJson)).toEqual([GALAXY_ARMOR]);
    cheat.call("savePlayerProgress", { ...cheat.progress(), cosmeticChest: GALAXY_ARMOR, enemyKills: 0 });
    expect(cheat.progress().cosmeticChest).toBe("");
  });
});

describe("Gifts that pay once", () => {
  it("Daily Gems pay a guest once a day, not again in the account it links to that day, and again the next day", () => {
    const world = scenarioWorld();
    const gina = world.join("Gina");
    expect(gina.view("my_daily_gem_bonus")[0]).toBeTruthy();
    const before = gems(world, gina);
    gina.call("claimDailyGemBonus");
    const paid = gems(world, gina) - before;
    expect(paid).toBeGreaterThan(0n);
    expect(gina.refusal("claimDailyGemBonus")).not.toBeNull();
    expect(gems(world, gina) - before).toBe(paid);
    // Linked the same day, the account carries today's claim.
    const al = linkGuest(world, gina, "Al");
    expect(al.refusal("claimDailyGemBonus")).not.toBeNull();
    expect(gems(world, al) - before).toBe(paid);
    world.advance(DAY);
    al.disconnect(); al.connect();
    al.call("enterWorldWithTutorial", { tabId: `tab-${al.hex.slice(0, 12)}`, forceTakeover: false });
    al.call("claimDailyGemBonus");
    expect(gems(world, al) - before).toBe(BigInt(paid) * 2n);
  });

  it("a Gem letter is read without paying, pays once on claim, and is gone with its receipts a week after it was sent", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann");
    world.advance(HOUR);
    owner(world).call("devPublishMailboxLetter", { id: "thanks", title: "Thanks", body: "For playing.", gems: 75n });
    expect(ann.refusal("devPublishMailboxLetter", { id: "forged", title: "x", body: "x", gems: 999n })).not.toBeNull();
    const mail = () => ann.view("my_mailbox_v2").filter(row => row.id === "thanks");
    expect(mail()).toEqual([expect.objectContaining({ id: "thanks", gems: 75n, read: false, claimed: false })]);
    ann.call("readMailboxLetter", { id: "thanks" });
    expect(mail()[0]).toMatchObject({ read: true, claimed: false });
    expect(gems(world, ann)).toBe(0n);
    ann.call("claimMailboxGift", { id: "thanks" });
    ann.call("claimMailboxGift", { id: "thanks" });
    expect(gems(world, ann)).toBe(75n);
    expect(ledger(world, "mailbox_gift")).toHaveLength(1);
    expect(ann.refusal("claimMailboxGift", { id: "made-up" })).not.toBeNull();
    // A wording fix keeps the claim; the amount cannot change once out.
    owner(world).call("devPublishMailboxLetter", { id: "thanks", title: "Thank you", body: "For playing.", gems: 75n });
    expect(owner(world).refusal("devPublishMailboxLetter", { id: "thanks", title: "Thank you", body: "For playing.", gems: 500n })).not.toBeNull();
    expect(mail()[0]).toMatchObject({ title: "Thank you", claimed: true });
    // Someone who joins after it went out never sees it.
    world.advance(1);
    const late = world.join("Late");
    expect(late.view("my_mailbox_v2").filter(row => row.id === "thanks")).toEqual([]);
    // Six days on it is there; a week on it is gone, and sent again it cannot pay twice.
    world.advance(6 * DAY);
    world.runDue(["maintenanceSweepSchedule"]);
    expect(mail()).toHaveLength(1);
    world.advance(DAY);
    world.runDue(["maintenanceSweepSchedule"]);
    expect(mail()).toEqual([]);
    expect([...world.db.mailboxReceipt.iter()].filter(row => row.letterId === "thanks" || row.id === "thanks")).toEqual([]);
    owner(world).call("devPublishMailboxLetter", { id: "thanks", title: "Thanks", body: "For playing.", gems: 75n });
    ann.call("claimMailboxGift", { id: "thanks" });
    expect(gems(world, ann)).toBe(75n);
  });

  it("a guest's claimed letter stays claimed in the account it links to", () => {
    const world = scenarioWorld();
    const gina = world.join("Gina");
    world.advance(HOUR);
    owner(world).call("devPublishMailboxLetter", { id: "thanks", title: "Thanks", body: "For playing.", gems: 75n });
    gina.call("claimMailboxGift", { id: "thanks" });
    const al = linkGuest(world, gina, "Al");
    expect(al.view("my_mailbox_v2").find(row => row.id === "thanks")).toMatchObject({ claimed: true });
    al.call("claimMailboxGift", { id: "thanks" });
    expect(ledger(world, "mailbox_gift")).toHaveLength(1);
  });

  it("gear mail freezes the highest map's set, claims once into the bag at +9 (keeping a higher slot), waits for bag room and a running upgrade", () => {
    const world = scenarioWorld();
    const [ann, full, busy] = ["Ann", "Full", "Busy"].map(name => world.join(name));
    ann.patch("playerProgress", { ionCitadelUnlocked: true });
    expect(ann.refusal("devDeliverEquipmentMail", { recipients: [ann.identity] })).not.toBeNull();
    owner(world).call("devDeliverEquipmentMail", { recipients: [ann.identity, full.identity, busy.identity] });
    owner(world).call("devPublishMailboxLetter", { id: GEAR_MAIL_ID, title: GEAR_MAIL_TITLE, body: GEAR_MAIL_BODY, gems: 0n });
    const letter = () => ann.view("my_mailbox_v2").find(row => row.id === GEAR_MAIL_ID);
    // The set for the highest map she had then; delivering again later changes nothing.
    expect(letter()).toMatchObject({ itemIds: ["ion_helmet", "ion_armor", "ion_bow"], upgradeLevel: 9, claimed: false });
    ann.patch("playerProgress", { ionCitadelUnlocked: false });
    owner(world).call("devDeliverEquipmentMail", { recipients: [ann.identity] });
    expect(letter()!.itemIds).toEqual(["ion_helmet", "ion_armor", "ion_bow"]);
    const hand = `${ann.hex}:HAND`;
    world.setup(ctx => ctx.db.playerItemUpgrade.insert({ key: hand, identity: ann.identity, itemId: "ion_bow", level: 10 }));
    const wearing = ann.progress().equippedRightHand;
    ann.call("claimMailboxGift", { id: GEAR_MAIL_ID });
    expect(JSON.parse(ann.progress().inventoryJson)).toEqual(expect.arrayContaining(["ion_helmet", "ion_armor", "ion_bow"]));
    expect(ann.progress().equippedRightHand).toBe(wearing);
    expect(world.db.playerItemUpgrade.key.find(hand).level).toBe(10);
    expect(world.db.playerItemUpgrade.key.find(`${ann.hex}:HEAD`).level).toBe(9);
    // Gear thrown away does not come back from a second claim.
    ann.patch("playerProgress", { inventoryJson: "[]" });
    ann.call("claimMailboxGift", { id: GEAR_MAIL_ID });
    expect(ann.progress().inventoryJson).toBe("[]");
    // A full bag: refused, nothing changes, it waits; with room, it comes.
    const filler = EQUIPMENT_DROP_ITEM_IDS.filter(id => !["forest_cap", "wooden_armor", "starter_bow"].includes(id)).slice(0, BASE_INVENTORY_SLOT_CAPACITY);
    full.patch("playerProgress", { inventoryJson: JSON.stringify(filler) });
    const before = full.progress();
    expect(full.refusal("claimMailboxGift", { id: GEAR_MAIL_ID })).not.toBeNull();
    expect(full.progress()).toEqual(before);
    expect(full.view("my_mailbox_v2").find(row => row.id === GEAR_MAIL_ID).claimed).toBe(false);
    full.patch("playerProgress", { inventoryJson: "[]" });
    full.call("claimMailboxGift", { id: GEAR_MAIL_ID });
    expect(full.view("my_mailbox_v2").find(row => row.id === GEAR_MAIL_ID).claimed).toBe(true);
    // An upgrade running on the gifted gear: finish it first.
    world.setup(ctx => ctx.db.activeItemUpgrade.insert({ identity: busy.identity, itemId: busy.view("my_mailbox_v2").find(row => row.id === GEAR_MAIL_ID).itemIds[2], currentLevel: 8, targetLevel: 9, startedAt: world.timestamp(), completesAt: new Timestamp(BigInt(world.now() + DAY) * 1000n) } as never));
    expect(busy.refusal("claimMailboxGift", { id: GEAR_MAIL_ID })).not.toBeNull();
    expect(busy.view("my_mailbox_v2").find(row => row.id === GEAR_MAIL_ID).claimed).toBe(false);
    // Linked, a claimed gear letter stays claimed.
    const al = linkGuest(world, full, "Al");
    expect(al.view("my_mailbox_v2").find(row => row.id === GEAR_MAIL_ID)).toMatchObject({ claimed: true, upgradeLevel: 9 });
  });

  it("a developer item gift reaches only that day's newcomers, waits for its own player, and adds the item once without touching what they wear", () => {
    const world = scenarioWorld();
    const [ann, bob, old] = ["Ann", "Bob", "Old"].map(name => world.join(name));
    for (const player of [ann, bob]) world.setup(ctx => ctx.db.playerAccessAudit.identity.update({ ...ctx.db.playerAccessAudit.identity.find(player.identity), firstSeenAt: new Timestamp(ALPHA_TESTER_REGISTRATION_START) }));
    world.setup(ctx => ctx.db.playerAccessAudit.identity.update({ ...ctx.db.playerAccessAudit.identity.find(old.identity), firstSeenAt: new Timestamp(ALPHA_TESTER_REGISTRATION_START - 1n) }));
    expect(ann.refusal("devDeliverAlphaTesterGifts", { recipients: [ann.identity] })).not.toBeNull();
    expect(owner(world).refusal("devDeliverAlphaTesterGifts", { recipients: [old.identity] })).not.toBeNull();
    owner(world).call("devDeliverAlphaTesterGifts", { recipients: [ann.identity, bob.identity] });
    owner(world).call("devDeliverAlphaTesterGifts", { recipients: [ann.identity] });
    const key = `${ALPHA_TESTER_GIFT_CAMPAIGN}:${ann.hex}`;
    expect(ann.view("my_item_gifts")).toHaveLength(1);
    expect(bob.view("my_item_gifts").map(row => row.key)).not.toContain(key);
    expect(bob.refusal("claimDeveloperItemGift", { key })).not.toBeNull();
    const wearing = ann.progress();
    ann.call("claimDeveloperItemGift", { key });
    ann.call("claimDeveloperItemGift", { key });
    owner(world).call("devDeliverAlphaTesterGifts", { recipients: [ann.identity] });
    const after = ann.progress();
    expect(JSON.parse(after.inventoryJson).filter((id: string) => id === ALPHA_TESTER_GIFT_ITEM)).toHaveLength(1);
    expect([after.equippedHead, after.maxHp]).toEqual([wearing.equippedHead, wearing.maxHp]);
    expect(ann.view("my_item_gifts")).toEqual([]);
    // Bob's, unclaimed, follows him into his account.
    const al = linkGuest(world, bob, "Al");
    expect(al.view("my_item_gifts")).toHaveLength(1);
  });

  it("an owner's compensation gifts each pay once per player, add to the notice still showing, and skip the deleted", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann");
    const notice = () => world.db.balanceApologyNotice.identity.find(ann.identity)?.amount ?? 0n;
    expect(ann.refusal("devDeliverDisconnectCompensation", { recipients: [ann.identity] })).not.toBeNull();
    owner(world).call("devDeliverDisconnectCompensation", { recipients: [ann.identity, ann.identity] });
    expect([gems(world, ann), notice()]).toEqual([20n, 20n]);
    // Seen and dismissed, then sent again: no second payment.
    ann.call("acknowledgeBalanceApologyGift");
    owner(world).call("devDeliverDisconnectCompensation", { recipients: [ann.identity] });
    expect([gems(world, ann), notice()]).toEqual([20n, 0n]);
    // The other campaigns pay on their own, each once, and add to a notice still up.
    owner(world).call("devDeliverCombatUpdateGift", { recipients: [ann.identity] });
    owner(world).call("devDeliverOutageCompensation", { recipients: [ann.identity] });
    owner(world).call("devDeliverAutofarmTestGift", { recipients: [ann.identity, ann.identity] });
    expect([gems(world, ann), notice()]).toEqual([65n, 45n]);
    for (const reducer of ["devDeliverCombatUpdateGift", "devDeliverOutageCompensation", "devDeliverAutofarmTestGift"]) owner(world).call(reducer, { recipients: [ann.identity] });
    expect(gems(world, ann)).toBe(65n);
    // Too many at once: none paid.
    const crowd = Array.from({ length: 101 }, () => ann.identity);
    expect(owner(world).refusal("devDeliverOutageCompensation", { recipients: crowd })).not.toBeNull();
    // An erased player is skipped.
    const gone = world.join("Gone");
    owner(world).call("devEraseAccount", { identityHex: gone.hex, confirmation: "ERASE", reason: "Asked to be forgotten" });
    owner(world).call("devDeliverOutageCompensation", { recipients: [gone.identity] });
    expect(world.db.playerGemWallet.identity.find(gone.identity)).toBeFalsy();
    // The announcement goes out once and moves no Gems.
    owner(world).call("devAnnounceOutageCompensation");
    owner(world).call("devAnnounceOutageCompensation");
    expect([...world.db.chatMessage.iter()]).toHaveLength(1);
  });
});
