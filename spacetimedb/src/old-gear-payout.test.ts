import { Timestamp } from "spacetimedb";
import { expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { fillDefeatBudget, reportEnemy } from "../../tests/helpers/enemy-defeat";
import { progressOf } from "../../tests/helpers/progress";
import { MODULE_MIGRATION_VERSION } from "./module-migrations";
import { REFINE_MASTERY_CAP, REFINE_STAR_MASTERY_POINTS, isOldMapGear, payOutAllOldGear, payOutOldGear, progressWithoutOldGear } from "./old-gear-payout";
import { goldFor } from "./gold";
import { equippedRightHandForProgress } from "./progress-helpers";
import { weaponMasteryPoints } from "./weapon-mastery";
import { prestigePerkRanks, writePrestigePerkRanks } from "./prestige";
import { oldTierSalePrice } from "../../shared/gear-grades";
import { itemTier } from "../../shared/item-tier";
import { gradeItemId } from "../../shared/grade-equipment";
import { GEAR_MAIL_ID } from "../../shared/mailbox-equipment";
import {
  BASIC_PAPER_HAT, BLACK_BOOTS, DIAMOND_GALAXY_BOW, GALAXY_BOW, IRON_BOW, SAMURAI_BOW, SAMURAI_HAT, STARTER_BOW, STARTER_STAFF,
  STARTER_STONE, SUPERIOR_GOLDEN_HELMET, WOODEN_ARMOR, WOODEN_SWORD,
} from "../../shared/items";
import { ATTACK_BALANCE_VERSION, BOSS_REWARD_CLAIM_BITS, SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
const RARE_BOW = gradeItemId("bow", "rare"), RARE_SWORD = gradeItemId("sword", "rare");
const RARE_HELMET = gradeItemId("helmet", "rare", "light"), RARE_ARMOR = gradeItemId("armor", "rare", "light");
const price = (itemId: string) => oldTierSalePrice(itemTier(itemId)!);
const priceOf = (itemIds: string[]) => itemIds.reduce((sum, itemId) => sum + price(itemId), 0);
const hex = (f: Fixture, who = f.ctx.sender) => who.toHexString();
const inventory = (f: Fixture, who = f.ctx.sender): string[] => JSON.parse(progressOf(f, who).inventoryJson);
const payout = (f: Fixture, who = f.ctx.sender) => f.db.oldGearPayout.identity.find(who);
const entries = (f: Fixture, who = f.ctx.sender): any[] => JSON.parse(payout(f, who).itemsJson);
const later = (micros: bigint, f: Fixture) => new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + micros);
const roll = { arrowStorm: 1, ricochet: 1, piercingShot: 1 };
const skillRow = (f: Fixture, table: string, itemId: string, extra: Record<string, unknown>) =>
  f.seed(table, { key: `${hex(f)}:${itemId}`, identity: f.ctx.sender, itemId, ...extra });
const benchJob = (itemId: string, f: Fixture) => ({ identity: f.ctx.sender, itemId, currentLevel: 3, targetLevel: 4,
  startedAt: f.ctx.timestamp, completesAt: later(60_000_000n, f), paused: false, remainingMicros: 60_000_000n });
const save = (inventoryJson: string[], extra: Record<string, unknown> = {}) => JSON.stringify({ maxHp: 100, damage: 10, armor: 1, regen: 1,
  attackRate: 1, inventoryJson: JSON.stringify(inventoryJson), equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: "",
  equippedLeftHand: "", bowCount: 0, woodenArmorCount: 0, ...extra });
const migrate = (f: Fixture) => {
  f.seed("moduleMigrationState", { id: 0, version: 61 });
  const connectionId = f.ctx.connectionId;
  f.ctx.connectionId = null;
  f.run(server.onConnect);
  f.ctx.connectionId = connectionId;
};

/** Ion bow, helmet and armor worn with Black Boots, old and graded gear in the bag, and old gear in every other place. */
function veteran() {
  const f = crystalFixture();
  f.patch("playerProgress", {
    inventoryJson: JSON.stringify(["ion_bow", "ion_helmet", "ion_armor", BLACK_BOOTS, IRON_BOW, WOODEN_SWORD, WOODEN_ARMOR,
      RARE_BOW, RARE_HELMET, STARTER_STAFF, BASIC_PAPER_HAT, SUPERIOR_GOLDEN_HELMET, GALAXY_BOW]),
    bowCount: 1, woodenArmorCount: 1, cosmeticItemsJson: JSON.stringify([SAMURAI_HAT]),
    equippedRightHand: "ion_bow", equippedHead: "ion_helmet", equippedChest: "ion_armor", equippedFeet: BLACK_BOOTS,
  });
  f.seed("playerItemUpgrade", { key: `${hex(f)}:HAND`, identity: f.ctx.sender, itemId: "HAND", level: 12 });
  f.seed("playerItemRefine", { key: `${hex(f)}:ion_bow`, identity: f.ctx.sender, itemId: "ion_bow", level: 7 });
  f.seed("playerItemRefine", { key: `${hex(f)}:${RARE_BOW}`, identity: f.ctx.sender, itemId: RARE_BOW, level: 5 });
  skillRow(f, "playerBowSkill", "ion_bow", roll);
  skillRow(f, "playerBowSkill", RARE_BOW, roll);
  skillRow(f, "playerBowSkill", "crystal_bow", roll); // a destroyed bow's roll, kept since
  skillRow(f, "playerSwordSkill", WOODEN_SWORD, { whirlwind: 1, deflect: 1, shockwave: 1 });
  f.seed("playerWornSkill", { identity: f.ctx.sender, itemId: "ion_bow", ...roll, whirlwind: 0, deflect: 0, shockwave: 0 });
  // Kept copies and waiting offers, a staff's roll beside its row.
  const bowCopy = f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: "ion_bow", ...roll, acquiredAt: f.ctx.timestamp });
  f.seed("playerCopyRefine", { copyId: bowCopy.id, identity: f.ctx.sender, itemId: "ion_bow", level: 3 });
  const staffCopy = f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: "ion_staff", arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp });
  f.seed("playerStaffSkill", { key: `copy:${staffCopy.id}`, identity: f.ctx.sender, itemId: "ion_staff", copyId: staffCopy.id, offerId: 0n, meteor: 1, chain: 1, frostNova: 1 });
  const keptCopy = f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: RARE_BOW, ...roll, acquiredAt: f.ctx.timestamp });
  f.seed("pendingEquipmentOffer", { id: 0n, identity: f.ctx.sender, itemId: "neon_helmet", arrowStorm: 0, ricochet: 0, piercingShot: 0,
    createdAt: f.ctx.timestamp, expiresAt: later(300_000_000n, f) });
  // A slot upgrade running on the bench, and a job from before slot tiers holding a bow out of the bag.
  f.seed("activeItemUpgrade", benchJob("HAND", f));
  f.seed("activeItemUpgradeSlotTwo", benchJob("crystal_bow", f));
  f.seed("itemUpgradeCompletionSchedule", { scheduledId: 0n, scheduledAt: { tag: "Time", value: later(60_000_000n, f) }, identity: f.ctx.sender,
    itemId: "crystal_bow", targetLevel: 4, completesAtMicros: 0n, slot: 2 });
  // Unclaimed gear mail, and an unclaimed gift naming old gear.
  f.seed("mailboxEquipment", { key: `${GEAR_MAIL_ID}:${hex(f)}`, identity: f.ctx.sender, letterId: GEAR_MAIL_ID,
    itemIdsJson: JSON.stringify(["cloudspire_helmet", "cloudspire_armor", "cloudspire_bow"]), mapId: "cloudspire", upgradeLevel: 9, createdAt: f.ctx.timestamp });
  f.seed("playerItemGift", { key: `test-gift:${hex(f)}`, identity: f.ctx.sender, campaign: "test-gift", itemId: "moonfen_armor", claimed: false, createdAt: f.ctx.timestamp });
  // Locks, loot filter entries and a saved build naming old gear.
  f.seed("playerEquipmentLock", { key: `${hex(f)}:ion_bow`, identity: f.ctx.sender, itemId: "ion_bow", copyId: 0n });
  f.seed("playerEquipmentLock", { key: `${hex(f)}:${RARE_BOW}`, identity: f.ctx.sender, itemId: RARE_BOW, copyId: 0n });
  f.seed("playerIgnoredDrop", { key: `${hex(f)}:ion_helmet`, identity: f.ctx.sender, itemId: "ion_helmet" });
  f.seed("playerIgnoredDrop", { key: `${hex(f)}:slot:HAND`, identity: f.ctx.sender, itemId: "slot:HAND" });
  f.seed("playerBuild", { key: `${hex(f)}:0`, identity: f.ctx.sender, slot: 0,
    gearJson: JSON.stringify({ HEAD: "ion_helmet", CHEST: RARE_ARMOR, FEET: BLACK_BOOTS, HAND: RARE_BOW }), cardsJson: "{}", savedAt: f.ctx.timestamp });
  // A challenge's saved main run, and the Endless rebase archive.
  f.seed("prestigeChallengeBackup", { identity: f.ctx.sender, progressJson: save(["ion_bow", SAMURAI_BOW], { equippedRightHand: SAMURAI_BOW }),
    completedEndless: 3, mapId: "crystal_hollows", x: 1, y: 1 });
  // Parked runs: one holds the Ion bow again (paid once), the other a bow found nowhere else.
  f.seed("prestigeChallengeRun", { identity: f.ctx.sender, progressJson: save(["ion_bow"]), completedEndless: 0, mapId: "crystal_hollows", x: 1, y: 1 });
  f.seed("aggroChallengeRun", { identity: f.ctx.sender, progressJson: save(["verdant_bow"], { equippedRightHand: "verdant_bow" }), completedEndless: 0, mapId: "crystal_hollows", x: 1, y: 1 });
  f.seed("playerEndlessRebaseBackup", { identity: f.ctx.sender, maxHp: 1, damage: 1, armor: 1, regen: 1, attackRate: 1, beforePower: 1, afterPower: 1,
    recordedAt: f.ctx.timestamp, progressJson: save(["frost_bow"], { equippedRightHand: "frost_bow" }), contextJson: "{}", earnedSeconds: 0 });
  return { ...f, keptCopy };
}

// Paid once each: the bag and worn gear, the stored runs' Samurai and Verdant bows, the bench's bow, the mail and the gift.
const FIRSTS = ["ion_bow", "ion_helmet", "ion_armor", IRON_BOW, WOODEN_SWORD, WOODEN_ARMOR, STARTER_BOW, SAMURAI_BOW,
  "verdant_bow",
  "crystal_bow", "cloudspire_helmet", "cloudspire_armor", "cloudspire_bow", "moonfen_armor"];
// Paid apiece: two kept copies and an offer.
const EXTRAS = ["ion_bow", "ion_staff", "neon_helmet"];

it("counts old map and campaign gear only: graded gear, the stone, cosmetics and developer items stay", () => {
  for (const itemId of ["ion_bow", "ion_sword", "ion_staff", "forest_cap", IRON_BOW, STARTER_BOW, WOODEN_ARMOR, WOODEN_SWORD, SAMURAI_HAT]) {
    expect(isOldMapGear(itemId), itemId).toBe(true);
  }
  for (const itemId of [STARTER_STONE, STARTER_STAFF, BLACK_BOOTS, RARE_BOW, RARE_SWORD, RARE_HELMET, gradeItemId("boots", "rare", "ranger"),
    BASIC_PAPER_HAT, SUPERIOR_GOLDEN_HELMET, GALAXY_BOW, DIAMOND_GALAXY_BOW, "slot:HAND", "", "nonsense"]) {
    expect(isOldMapGear(itemId), itemId).toBe(false);
  }
});

it("migration 62 wipes old gear from everywhere a player holds it and pays each piece in gold", () => {
  const f = veteran();
  migrate(f);
  expect(f.db.moduleMigrationState.id.find(0).version).toBe(MODULE_MIGRATION_VERSION);
  expect(MODULE_MIGRATION_VERSION).toBe(62);
  // Everyone gets the fresh-start letter with its gems.
  expect(f.db.mailboxLetter.id.find("gear-overhaul-2026-10-19")).toMatchObject({ title: "New Gear, Fresh Start", gems: 150n });

  const gold = priceOf(FIRSTS) + priceOf(EXTRAS);
  expect(goldFor(f.ctx, f.ctx.sender)).toBe(BigInt(gold));
  // Worn Ion bow, helmet and armor alone are 3 x 31.
  expect(priceOf(["ion_bow", "ion_helmet", "ion_armor"])).toBe(93);

  // The bag keeps graded gear, the stone, the Smith's staff, the paper hat and developer gear; worn slots are empty.
  const progress = progressOf(f);
  expect(inventory(f).sort()).toEqual([STARTER_STONE, SUPERIOR_GOLDEN_HELMET, GALAXY_BOW, STARTER_STAFF, RARE_BOW, RARE_HELMET, BASIC_PAPER_HAT, BLACK_BOOTS].sort());
  // Black Boots stay worn.
  expect(progress).toMatchObject({ equippedHead: "", equippedChest: "", equippedFeet: BLACK_BOOTS, equippedLeftHand: "", bowCount: 0, woodenArmorCount: 0 });
  // The bow hand falls back to the best kept bow, as an empty hand would.
  expect(progress.equippedRightHand).toBe(RARE_BOW);
  expect(progress.cosmeticItemsJson).toBe(JSON.stringify([SAMURAI_HAT]));
  // Others see the new loadout.
  expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ headItem: "", chestItem: "", feetItem: BLACK_BOOTS, rightHandItem: RARE_BOW });
  expect(f.db.playerWornSkill.identity.find(f.ctx.sender)?.itemId ?? "").not.toBe("ion_bow");

  // Copies, offers, the old bench job and its schedule, the mail and the gift are gone; the slot job and tier stay.
  expect([...f.db.playerEquipmentCopy.identity.filter(f.ctx.sender)].map((row: any) => row.id)).toEqual([f.keptCopy.id]);
  expect([...f.db.pendingEquipmentOffer.identity.filter(f.ctx.sender)]).toEqual([]);
  expect([...f.db.playerStaffSkill.identity.filter(f.ctx.sender)]).toEqual([]);
  expect(f.db.activeItemUpgradeSlotTwo.identity.find(f.ctx.sender)).toBeNull();
  expect([...f.db.itemUpgradeCompletionSchedule.identity.filter(f.ctx.sender)]).toEqual([]);
  expect(f.db.activeItemUpgrade.identity.find(f.ctx.sender)?.itemId).toBe("HAND");
  expect(f.db.playerItemUpgrade.key.find(`${hex(f)}:HAND`).level).toBe(12);
  expect(f.db.mailboxEquipment.key.find(`${GEAR_MAIL_ID}:${hex(f)}`)).toBeNull();
  expect(f.db.playerItemGift.key.find(`test-gift:${hex(f)}`).claimed).toBe(true);

  // Refines, rolls, locks, filter entries and build slots naming old gear go; the graded bow's stay.
  expect([...f.db.playerItemRefine.identity.filter(f.ctx.sender)].map((row: any) => [row.itemId, row.level])).toEqual([[RARE_BOW, 5]]);
  expect([...f.db.playerCopyRefine.identity.filter(f.ctx.sender)]).toEqual([]);
  expect([...f.db.playerBowSkill.identity.filter(f.ctx.sender)].map((row: any) => row.itemId)).toEqual([RARE_BOW]);
  expect([...f.db.playerSwordSkill.identity.filter(f.ctx.sender)]).toEqual([]);
  expect([...f.db.playerEquipmentLock.identity.filter(f.ctx.sender)].map((row: any) => row.itemId)).toEqual([RARE_BOW]);
  expect([...f.db.playerIgnoredDrop.identity.filter(f.ctx.sender)].map((row: any) => row.itemId)).toEqual(["slot:HAND"]);
  expect(JSON.parse(f.db.playerBuild.key.find(`${hex(f)}:0`).gearJson)).toEqual({ HEAD: "", CHEST: RARE_ARMOR, FEET: BLACK_BOOTS, HAND: RARE_BOW });

  // Stored saves lose their old gear too.
  const backup = JSON.parse(f.db.prestigeChallengeBackup.identity.find(f.ctx.sender).progressJson);
  expect(JSON.parse(backup.inventoryJson)).toEqual([STARTER_STONE]);
  expect(backup.equippedRightHand).toBe(STARTER_STONE);
  for (const handle of [f.db.prestigeChallengeRun, f.db.aggroChallengeRun]) {
    expect(JSON.parse(JSON.parse(handle.identity.find(f.ctx.sender).progressJson).inventoryJson)).toEqual([STARTER_STONE]);
  }
  const archive = JSON.parse(f.db.playerEndlessRebaseBackup.identity.find(f.ctx.sender).progressJson);
  expect(JSON.parse(archive.inventoryJson)).toEqual([STARTER_STONE]);

  // The record: every piece with its refine and gold; the archive's Frost Bow wiped but unpaid.
  expect(payout(f).gold).toBe(BigInt(gold));
  const record = entries(f);
  expect(record.find(entry => entry.itemId === "ion_bow" && entry.from.includes("worn"))).toMatchObject({ count: 1, refines: [7], gold: 31, tier: 15, from: ["parked run", "saved run", "worn"] });
  expect(record.find(entry => entry.itemId === "ion_bow" && entry.from.includes("copy"))).toMatchObject({ count: 1, refines: [3], gold: 31 });
  expect(record.find(entry => entry.itemId === SAMURAI_BOW)).toMatchObject({ count: 1, from: ["saved run"] });
  expect(record.find(entry => entry.itemId === "frost_bow")).toMatchObject({ count: 0, gold: 0, from: ["archive"] });
  expect(record.reduce((sum, entry) => sum + entry.gold, 0)).toBe(gold);
});

it("changes nothing when it runs again", () => {
  const f = veteran();
  migrate(f);
  const before = { gold: goldFor(f.ctx, f.ctx.sender), payout: { ...payout(f) }, progress: progressOf(f) };
  f.transaction(() => payOutAllOldGear(f.ctx));
  expect(f.transaction(() => payOutOldGear(f.ctx, f.ctx.sender))).toEqual({ gold: 0, changed: false });
  expect(goldFor(f.ctx, f.ctx.sender)).toBe(before.gold);
  expect(payout(f)).toEqual(before.payout);
  expect(progressOf(f)).toEqual(before.progress);
});

it("leaves a player with no old gear untouched, with no record", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([RARE_BOW, RARE_HELMET]), equippedRightHand: RARE_BOW, equippedHead: RARE_HELMET });
  const before = progressOf(f);
  migrate(f);
  expect(progressOf(f)).toEqual(before);
  expect(payout(f)).toBeNull();
  expect(goldFor(f.ctx, f.ctx.sender)).toBe(0n);
});

it("falls the weapon hand back to a kept weapon of its kind, else the stone, and the player still kills", () => {
  const hand = (inventoryJson: string[], right: string, left = "") =>
    progressWithoutOldGear({ identity: identity("9"), inventoryJson: JSON.stringify(inventoryJson), equippedRightHand: right, equippedLeftHand: left,
      equippedHead: "", equippedChest: "", equippedFeet: "", bowCount: 0, woodenArmorCount: 0 }).progress;
  expect(hand(["ion_sword", RARE_SWORD], "ion_sword")).toMatchObject({ equippedRightHand: RARE_SWORD, equippedLeftHand: "" });
  expect(hand(["ion_staff", STARTER_STAFF], "ion_staff")).toMatchObject({ equippedRightHand: STARTER_STAFF });
  expect(hand(["ion_sword"], "ion_sword")).toMatchObject({ equippedRightHand: STARTER_STONE });
  expect(hand([IRON_BOW], "", IRON_BOW)).toMatchObject({ equippedRightHand: STARTER_STONE, equippedLeftHand: "" });
  expect(hand([IRON_BOW, RARE_BOW], RARE_BOW, IRON_BOW)).toMatchObject({ equippedRightHand: RARE_BOW, equippedLeftHand: "" });

  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify(["ion_sword"]), equippedRightHand: "ion_sword", damage: 1e15 });
  migrate(f);
  expect(equippedRightHandForProgress(progressOf(f))).toBe(STARTER_STONE);
  fillDefeatBudget(f, "crystal_hollows", "Shard Hopper");
  reportEnemy(f, "Shard Hopper", 2);
  expect(weaponMasteryPoints(f.ctx, f.ctx.sender).archery).toBe(2n);
});

it("a challenge's saved run comes back without old gear after the wipe", () => {
  const f = crystalFixture();
  f.seed("playerPrestige", { identity: f.ctx.sender, level: 1, perkPoints: 0, peakPower: 0, prestigedAt: f.ctx.timestamp });
  writePrestigePerkRanks(f.ctx, f.ctx.sender, prestigePerkRanks(f.ctx, f.ctx.sender));
  f.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime, inventoryJson: JSON.stringify(["ion_bow", RARE_BOW]), equippedRightHand: "ion_bow" });
  f.run(server.startPrestigeChallenge);
  expect(JSON.parse(JSON.parse(f.db.prestigeChallengeBackup.identity.find(f.ctx.sender).progressJson).inventoryJson)).toContain("ion_bow");
  migrate(f);
  // Paid once, though both the challenge run and the saved run held it.
  expect(goldFor(f.ctx, f.ctx.sender)).toBe(BigInt(price("ion_bow")));
  f.run(server.abandonPrestigeChallenge);
  expect(inventory(f)).not.toContain("ion_bow");
  expect(inventory(f)).toContain(RARE_BOW);
  expect(progressOf(f).equippedRightHand).toBe(RARE_BOW);
});

it("pays out a guest save still holding old gear when it links to an account, and moves the guest's record", () => {
  const f = crystalFixture();
  const guest = identity("2");
  f.seed("moduleMigrationState", { id: 0, version: MODULE_MIGRATION_VERSION });
  f.db.playerProgress.identity.delete(f.ctx.sender);
  f.progress(guest, { inventoryJson: JSON.stringify(["ion_helmet", RARE_BOW]), equippedHead: "ion_helmet", equippedRightHand: RARE_BOW });
  f.seed("playerBalanceVersion", { identity: guest, version: ATTACK_BALANCE_VERSION });
  f.seed("playerEquipmentCopy", { id: 0n, identity: guest, itemId: "ion_helmet", arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp });
  f.seed("oldGearPayout", { identity: guest, itemsJson: JSON.stringify([{ itemId: "ion_bow", count: 1, gold: 31 }]), gold: 31n, at: f.ctx.timestamp });
  f.seed("playerGold", { identity: guest, gold: 31n });
  f.seed("accountLink", { code: "gear-link", guest, createdAt: f.ctx.timestamp });
  f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
  f.run(server.claimGuestAccount, { code: "gear-link" });

  expect(inventory(f)).not.toContain("ion_helmet");
  expect(progressOf(f)).toMatchObject({ equippedHead: "", equippedRightHand: RARE_BOW });
  expect([...f.db.playerEquipmentCopy.identity.filter(f.ctx.sender)]).toEqual([]);
  expect(goldFor(f.ctx, f.ctx.sender)).toBe(31n + 2n * BigInt(price("ion_helmet")));
  expect(payout(f, guest)).toBeNull();
  expect(payout(f).gold).toBe(31n + 2n * BigInt(price("ion_helmet")));
  expect(entries(f).map(entry => entry.itemId)).toEqual(["ion_bow", "ion_helmet", "ion_helmet"]);
});

it("pays refine stars as a little Mastery: a weapon's to its school, armor's to the school of the weapon in hand", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify(["ion_sword", "ion_helmet", "ion_bow"]), equippedRightHand: "ion_sword", equippedHead: "ion_helmet" });
  f.seed("playerItemRefine", { key: `${hex(f)}:ion_sword`, identity: f.ctx.sender, itemId: "ion_sword", level: 6 });
  f.seed("playerItemRefine", { key: `${hex(f)}:ion_helmet`, identity: f.ctx.sender, itemId: "ion_helmet", level: 4 });
  f.seed("playerItemRefine", { key: `${hex(f)}:ion_bow`, identity: f.ctx.sender, itemId: "ion_bow", level: 3 });
  f.transaction(() => payOutOldGear(f.ctx, f.ctx.sender));
  const points = weaponMasteryPoints(f.ctx, f.ctx.sender);
  // Sword 6 and helmet 4 go to Swordplay (the sword is in hand); the bow's 3 to Archery.
  expect(points.swordplay).toBe(BigInt(10 * REFINE_STAR_MASTERY_POINTS));
  expect(points.archery).toBe(BigInt(3 * REFINE_STAR_MASTERY_POINTS));
  expect(JSON.parse(f.db.oldGearPayout.identity.find(f.ctx.sender).masteryJson)).toEqual({ swordplay: 300, archery: 90 });
});

it("caps the refine Mastery at the Lv 8 total, shared out by school", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify(["ion_bow", "ion_helmet", "ion_armor"]), equippedRightHand: "ion_bow" });
  for (const itemId of ["ion_bow", "ion_helmet", "ion_armor"]) {
    f.seed("playerItemRefine", { key: `${hex(f)}:${itemId}`, identity: f.ctx.sender, itemId, level: 30 });
  }
  f.transaction(() => payOutOldGear(f.ctx, f.ctx.sender));
  const archery = Number(weaponMasteryPoints(f.ctx, f.ctx.sender).archery);
  expect(archery).toBeLessThanOrEqual(REFINE_MASTERY_CAP);
  expect(archery).toBeGreaterThan(REFINE_MASTERY_CAP - 2);
});
