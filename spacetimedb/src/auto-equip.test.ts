import { Identity } from "spacetimedb";
import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { fillDefeatBudget, reportEnemy, seedDefeatClock } from "../../tests/helpers/enemy-defeat";
import { bowSkillKey, bowSkillRollFor } from "./bow-skills";
import { publishItemDrop } from "./equipment-copies";
import { CAMPAIGN_UNLOCK_FIELDS } from "../../shared/equipment-access";
import { gearSlotsKey } from "../../shared/cards";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
import { TERMS_VERSION } from "../../shared/legal";
import { IRON_BOW, SAMURAI_HAT, STARTER_BOW, STARTER_STONE, WOODEN_SWORD } from "../../shared/items";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
type Roll = { arrowStorm: number; ricochet: number; piercingShot: number };
const LOW: Roll = { arrowStorm: 1, ricochet: 0, piercingShot: 0 }; // Skills +2.5%
const TOP: Roll = { arrowStorm: 3, ricochet: 3, piercingShot: 3 }; // a starter bow's best: +17.1%
const NONE: Roll = { arrowStorm: 0, ricochet: 0, piercingShot: 0 };
const ALL_MAPS = Object.fromEntries(CAMPAIGN_UNLOCK_FIELDS.map(field => [field, true]));
const UP_TO_CRYSTAL = Object.fromEntries(CAMPAIGN_UNLOCK_FIELDS.slice(0, CAMPAIGN_UNLOCK_FIELDS.indexOf("crystalHollowsUnlocked") + 1).map(field => [field, true]));

const rollOf = (row: any): Roll => ({ arrowStorm: row.arrowStorm, ricochet: row.ricochet, piercingShot: row.piercingShot });
const firstRoll = (f: Fixture, itemId = STARTER_BOW) => rollOf(bowSkillRollFor(f.ctx as any, f.ctx.sender, itemId));
const offers = (f: Fixture) => [...f.db.pendingEquipmentOffer.identity.filter(f.ctx.sender)];
const copies = (f: Fixture) => [...f.db.playerEquipmentCopy.identity.filter(f.ctx.sender)];
const progress = (f: Fixture) => progressOf(f, f.ctx.sender);
const inventory = (f: Fixture): string[] => JSON.parse(progress(f).inventoryJson);
const seedFirst = (f: Fixture, roll: Roll, itemId = STARTER_BOW) =>
  f.seed("playerBowSkill", { key: bowSkillKey(f.ctx.sender, itemId), identity: f.ctx.sender, itemId, ...roll });
const seedCopy = (f: Fixture, roll: Roll, itemId = STARTER_BOW) =>
  f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId, ...roll, acquiredAt: f.ctx.timestamp });
const settings = (f: Fixture, autoKeepBest: boolean, autoEquipBest: boolean) =>
  f.seed("playerLootSetting", { identity: f.ctx.sender, autoKeepBest, autoEquipBest, updatedAt: f.ctx.timestamp });
/** ctx.random answering from a list, round and round. */
const draws = (f: Fixture, values: number[]) => {
  let next = 0;
  Object.assign(f.ctx, { random: Object.assign(() => values[next++ % values.length], { integerInRange: (min: number) => min }) });
};
const plainRandom = (f: Fixture) => {
  Object.assign(f.ctx, { random: Object.assign(() => .5, { integerInRange: (min: number, max: number) => Math.floor((min + max) / 2) }) });
};
// Each skill draws appearance then chance: 0 appears, .999 lands at the top of the range, .9 never appears.
const EVERY_SKILL_AT_THE_TOP = [0, .999];
const ARROW_STORM_ONLY_AT_THE_TOP = [0, .999, .9, .9, .9, .9];
const NO_SKILLS = [.9];

// Kill-claim bounds, as in bow-skills.test.ts: one arrow a second that
// one-shots and ten seconds banked, so without skills 12 kills are paid.
const ENEMY = "Shard Hopper";
const kills = (f: Fixture) => Number(f.db.playerLifetime.identity.find(f.ctx.sender)?.enemyKills ?? 0n);
function archer(roll: Roll = LOW) {
  const f = crystalFixture();
  f.patch("playerProgress", { equippedRightHand: STARTER_BOW, inventoryJson: '["starter_bow"]', bowCount: 1, damage: 1e15, attackRate: 1, projectileCount: 1 });
  seedFirst(f, roll);
  fillDefeatBudget(f, "crystal_hollows", ENEMY);
  seedDefeatClock(f, "combat", 10);
  return f;
}

it("puts a better duplicate roll on the first copy, so the bow in hand reads it for kill bounds", () => {
  const plain = archer(NONE);
  reportEnemy(plain, ENEMY, 16);
  expect(kills(plain)).toBe(12);

  const f = archer();
  draws(f, EVERY_SKILL_AT_THE_TOP);
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, STARTER_BOW, true));
  expect(firstRoll(f)).toEqual(TOP);
  expect(offers(f)).toEqual([]);
  expect(copies(f)).toEqual([]);
  expect(progress(f).equippedRightHand).toBe(STARTER_BOW);
  // 1 + .03 * (5 + 2 + 4) = 1.33 enemies an arrow, within the 1.25 tolerance: 16.
  plainRandom(f);
  reportEnemy(f, ENEMY, 16);
  expect(kills(f)).toBe(16);
});

it("throws away a worse or equal duplicate without an offer", () => {
  for (const sequence of [NO_SKILLS, EVERY_SKILL_AT_THE_TOP]) {
    const f = archer(TOP);
    draws(f, sequence);
    f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, STARTER_BOW, true, 3));
    expect(firstRoll(f)).toEqual(TOP);
    expect(offers(f)).toEqual([]);
    expect(copies(f)).toEqual([]);
  }
});

it("measures a duplicate against the weapon itself, upgrades it in place, and never touches kept copies", () => {
  const f = archer(LOW);
  seedCopy(f, TOP);
  draws(f, ARROW_STORM_ONLY_AT_THE_TOP);
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, STARTER_BOW, true));
  // Higher Arrow Storm, nothing lower: raised in place, even with a better copy kept aside.
  expect(firstRoll(f).arrowStorm).toBeGreaterThan(LOW.arrowStorm);
  draws(f, EVERY_SKILL_AT_THE_TOP);
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, STARTER_BOW, true));
  expect(firstRoll(f)).toEqual(TOP);
  expect(copies(f).map(rollOf)).toEqual([TOP]);
  expect(offers(f)).toEqual([]);
});

it("throws away duplicates of gear without skills, silently", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([SAMURAI_HAT]) });
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, SAMURAI_HAT, true, 2));
  expect(offers(f)).toEqual([]);
  expect(copies(f)).toEqual([]);
  expect(inventory(f).filter(id => id === SAMURAI_HAT)).toHaveLength(1);
  expect(f.db.playerItemDrop.key.find(`${f.ctx.sender.toHexString()}:${SAMURAI_HAT}`).alreadyOwned).toBe(true);
});

it("upgrades in place even for an account that once turned the old Auto keep best switch off", () => {
  const f = archer(LOW);
  settings(f, false, true);
  draws(f, EVERY_SKILL_AT_THE_TOP);
  f.run((ctx: any) => publishItemDrop(ctx, ctx.sender, STARTER_BOW, true));
  expect(offers(f)).toEqual([]);
  expect(firstRoll(f)).toEqual(TOP);
});

it("lets the loot filter win: a filtered bow never drops, so it is never compared", () => {
  const f = crystalFixture();
  draws(f, [0]);
  f.patch("playerProgress", { damage: 1e15, inventoryJson: JSON.stringify(["crystal_bow"]) });
  seedFirst(f, NONE, "crystal_bow");
  f.run(server.setIgnoredDrops, { itemIds: ["crystal_bow"], ignored: true });
  fillDefeatBudget(f, "crystal_hollows", ENEMY);
  reportEnemy(f, ENEMY, 1);
  expect(firstRoll(f, "crystal_bow")).toEqual(NONE);
  expect(f.db.playerItemDrop.key.find(`${f.ctx.sender.toHexString()}:crystal_bow`)).toBeNull();
  expect(offers(f)).toEqual([]);
});

/** A player on Crystal Hollows who has reached it, with a weaker bow in hand. */
function looter(extra: Record<string, unknown> = {}) {
  const f = crystalFixture();
  draws(f, [0]); // every loot roll wins
  f.patch("playerProgress", { damage: 1e15, inventoryJson: JSON.stringify([IRON_BOW]), equippedRightHand: IRON_BOW, ...UP_TO_CRYSTAL, ...extra });
  fillDefeatBudget(f, "crystal_hollows", ENEMY);
  return f;
}

it("equips a better new drop, with the player row showing it", () => {
  const f = looter();
  reportEnemy(f, ENEMY, 1);
  expect(inventory(f)).toContain("crystal_bow");
  expect(progress(f).equippedRightHand).toBe("crystal_bow");
  expect(f.db.player.identity.find(f.ctx.sender).rightHandItem).toBe("crystal_bow");
});

it("leaves a new drop in the bag when it is worse, locked, or the player turned Auto equip off", () => {
  // Skills count: the new crystal bow rolls every skill, so the ion bow in hand needs its own to stay ahead.
  const worse = looter({ inventoryJson: JSON.stringify(["ion_bow"]), equippedRightHand: "ion_bow", ...ALL_MAPS });
  seedFirst(worse, { arrowStorm: 15, ricochet: 15, piercingShot: 15 }, "ion_bow");
  reportEnemy(worse, ENEMY, 1);
  expect(inventory(worse)).toContain("crystal_bow");
  expect(progress(worse).equippedRightHand).toBe("ion_bow");

  const locked = looter({ crystalHollowsUnlocked: false });
  reportEnemy(locked, ENEMY, 1);
  expect(inventory(locked)).toContain("crystal_bow");
  expect(progress(locked).equippedRightHand).toBe(IRON_BOW);

  const off = looter();
  settings(off, true, false);
  reportEnemy(off, ENEMY, 1);
  expect(inventory(off)).toContain("crystal_bow");
  expect(progress(off).equippedRightHand).toBe(IRON_BOW);
});

// Swords hit half as hard again as bows but only up close, so power alone would take every archer's bow.
it("keeps the kind of weapon in hand when new weapons drop: an archer's bow, a swordsman's sword", () => {
  const archer = looter();
  reportEnemy(archer, ENEMY, 1);
  expect(inventory(archer)).toEqual(expect.arrayContaining(["crystal_bow", "crystal_sword"]));
  expect(progress(archer).equippedRightHand).toBe("crystal_bow");

  const swordsman = looter({ inventoryJson: JSON.stringify(["iron_sword"]), equippedRightHand: "iron_sword" });
  reportEnemy(swordsman, ENEMY, 1);
  expect(inventory(swordsman)).toEqual(expect.arrayContaining(["crystal_bow", "crystal_sword"]));
  expect(progress(swordsman).equippedRightHand).toBe("crystal_sword");
});

it("equips gear already in the bag when reaching a map unlocks it, only with Auto equip on", () => {
  for (const autoEquipBest of [true, false]) {
    const f = crystalFixture();
    f.patch("playerProgress", { damage: 1e15, inventoryJson: JSON.stringify([IRON_BOW, "clockwork_bow"]), equippedRightHand: IRON_BOW, ...UP_TO_CRYSTAL });
    settings(f, true, autoEquipBest);
    // Prismshell's reward opens Clockwork Ruins, the clockwork bow's tier.
    reportEnemy(f, "boss", 1);
    expect(progress(f).clockworkRuinsUnlocked).toBe(true);
    expect(progress(f).equippedRightHand).toBe(autoEquipBest ? "clockwork_bow" : IRON_BOW);
  }
});

it("ranks armor by the armor, not the cards in it: a Reflect build's carded tier-11 beats a regen-carded tier-10", () => {
  const f = crystalFixture();
  // A Reflect build: health and regen far above its damage, so four Miremaws' regen outscored a higher tier.
  f.patch("playerProgress", { maxHp: 2e9, damage: 5e5, regen: 4e8, armor: 3e4,
    inventoryJson: JSON.stringify([IRON_BOW, "crystal_armor", "clockwork_armor"]), equippedRightHand: IRON_BOW, equippedChest: "crystal_armor", ...UP_TO_CRYSTAL });
  settings(f, true, true);
  const slot = (itemId: string, cards: string[]) =>
    f.seed("playerGearSlots", { key: gearSlotsKey(f.ctx.sender, itemId), identity: f.ctx.sender, itemId, slots: 4, cards });
  slot("crystal_armor", Array(4).fill("miremaw_card"));
  slot("clockwork_armor", Array(4).fill("prismshell_card"));
  // Prismshell's reward opens Clockwork Ruins, the clockwork armor's tier.
  reportEnemy(f, "boss", 1);
  expect(progress(f).clockworkRuinsUnlocked).toBe(true);
  expect(progress(f).equippedChest).toBe("clockwork_armor");
});

const consent = (f: Fixture) =>
  f.seed("playerLegalConsent", { identity: f.ctx.sender, termsVersion: TERMS_VERSION, ageBand: 2, acceptedAt: f.ctx.timestamp });

// The blank-hand bug: a map-locked bow in hand read as "no weapon", world entry
// wrote that "" back, auto equip copied it when another slot changed, and the
// client took it in. The player could not attack.
it("never blanks a hand that held a weapon: world entry, auto equip and dev grants all leave one", () => {
  // World entry with a locked bow in hand and the stone in the bag.
  const entry = crystalFixture();
  entry.patch("playerProgress", { inventoryJson: JSON.stringify([STARTER_STONE, IRON_BOW]), equippedRightHand: IRON_BOW });
  consent(entry);
  entry.run(server.enterWorld, { tabId: "blank-hand" });
  expect(progress(entry).equippedRightHand).toBe(STARTER_STONE);
  expect(entry.db.player.identity.find(entry.ctx.sender).rightHandItem).toBe(STARTER_STONE);
  // A usable bow in the bag is the better fallback for a locked one.
  const usable = crystalFixture();
  usable.patch("playerProgress", { inventoryJson: JSON.stringify([STARTER_STONE, STARTER_BOW, IRON_BOW]), bowCount: 1, equippedRightHand: IRON_BOW });
  consent(usable);
  usable.run(server.enterWorld, { tabId: "blank-hand" });
  expect(progress(usable).equippedRightHand).toBe(STARTER_BOW);
  // Of its own kind: a locked bow is never replaced by a sword, nor a locked sword by a bow.
  for (const [held, fallback] of [[IRON_BOW, STARTER_BOW], ["iron_sword", WOODEN_SWORD]]) {
    const kind = crystalFixture();
    kind.patch("playerProgress", { inventoryJson: JSON.stringify([STARTER_STONE, STARTER_BOW, WOODEN_SWORD, held]), bowCount: 1, equippedRightHand: held });
    consent(kind);
    kind.run(server.enterWorld, { tabId: "blank-hand" });
    expect(progress(kind).equippedRightHand).toBe(fallback);
  }

  // Auto equip putting on a helmet leaves a locked bow in hand as it was, never blank.
  const helmet = looter({ inventoryJson: JSON.stringify([STARTER_STONE, "ion_bow"]), equippedRightHand: "ion_bow" });
  helmet.run(server.setIgnoredDrops, { itemIds: ["slot:HAND"], ignored: true }); // only armour drops
  reportEnemy(helmet, ENEMY, 1);
  expect(progress(helmet).equippedHead).toBe("crystal_helmet");
  expect(progress(helmet).equippedRightHand).toBe("ion_bow");
  expect(helmet.db.player.identity.find(helmet.ctx.sender).rightHandItem).not.toBe("");

  // A developer grant never puts a locked weapon in hand.
  const grant = crystalFixture();
  grant.patch("playerProgress", { inventoryJson: JSON.stringify([STARTER_STONE]), equippedRightHand: STARTER_STONE });
  const player = grant.ctx.sender;
  grant.ctx.sender = Identity.fromString("c200383520521c925f3cf6deafb20cd6a7d6168d1c31cb3c0ddb731c197a2d79"); // the database owner
  grant.run(server.devGrantEquipment, { identity: player, itemId: IRON_BOW, equip: true });
  grant.ctx.sender = player;
  expect(progress(grant).equippedRightHand).toBe(STARTER_STONE);
  expect(inventory(grant)).toContain(IRON_BOW);
});

// Players empty their hands on purpose, for unarmed Reflect runs.
it("leaves hands the player emptied empty: at world entry, when a better weapon drops, and through prestige", () => {
  const entry = crystalFixture();
  entry.patch("playerProgress", { inventoryJson: JSON.stringify([STARTER_STONE, STARTER_BOW]), bowCount: 1, equippedRightHand: "", equippedLeftHand: "" });
  consent(entry);
  entry.run(server.enterWorld, { tabId: "unarmed-run" });
  expect(progress(entry)).toMatchObject({ equippedRightHand: "", equippedLeftHand: "" });
  expect(entry.db.player.identity.find(entry.ctx.sender).rightHandItem).toBe("");   // and looks it to everyone

  const drop = looter({ equippedRightHand: "", equippedLeftHand: "" });
  reportEnemy(drop, ENEMY, 1);
  expect(inventory(drop)).toContain("crystal_bow");
  expect(progress(drop)).toMatchObject({ equippedRightHand: "", equippedLeftHand: "" });

  const run = veteran();
  run.patch("playerProgress", { equippedRightHand: "", equippedLeftHand: "" });
  run.run(server.prestigeAccount, {});
  expect(progress(run)).toMatchObject({ equippedRightHand: "", equippedLeftHand: "" });
});

/** A player who finished the campaign with top gear, ready to prestige. */
function veteran() {
  const f = crystalFixture();
  f.patch("playerProgress", {
    ...ALL_MAPS, bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime, bowCount: 1,
    inventoryJson: JSON.stringify([STARTER_BOW, IRON_BOW, "ion_bow", "ion_helmet", "forest_cap", SAMURAI_HAT]),
    equippedRightHand: "ion_bow", equippedHead: "ion_helmet",
  });
  f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 1 });
  seedFirst(f, TOP, "ion_bow");
  seedCopy(f, LOW, "ion_bow");
  f.seed("pendingEquipmentOffer", { id: 0n, identity: f.ctx.sender, itemId: "ion_bow", ...LOW, createdAt: f.ctx.timestamp, expiresAt: f.ctx.timestamp });
  f.run(server.setIgnoredDrops, { itemIds: ["slot:FEET"], ignored: true });
  return f;
}

it("keeps the bag, kept copies, bow rolls, loot filter and settings through prestige", () => {
  const f = veteran();
  settings(f, false, true);
  f.run(server.prestigeAccount, {});
  expect(inventory(f)).toEqual(expect.arrayContaining([STARTER_BOW, IRON_BOW, "ion_bow", "ion_helmet", SAMURAI_HAT]));
  expect(firstRoll(f, "ion_bow")).toEqual(TOP);
  expect(copies(f).map(rollOf)).toEqual([LOW]);
  expect(offers(f)).toEqual([]);
  expect([...f.db.playerIgnoredDrop.identity.filter(f.ctx.sender)].map(row => row.itemId)).toEqual(["slot:FEET"]);
  expect(f.db.playerLootSetting.identity.find(f.ctx.sender)).toMatchObject({ autoKeepBest: false });
  // Everything else prestige does is unchanged: the maps start over.
  expect(CAMPAIGN_UNLOCK_FIELDS.some(field => progress(f)[field])).toBe(false);
});

it("swaps gear its maps lock away for the best usable gear, never leaving an empty hand", () => {
  const f = veteran();
  f.run(server.prestigeAccount, {});
  // The ion bow and helmet are locked until Ion Citadel; the starter bow and forest cap are the best usable.
  expect(progress(f).equippedRightHand).toBe(STARTER_BOW);
  expect(progress(f).equippedHead).toBe("forest_cap");
  expect(f.db.player.identity.find(f.ctx.sender).rightHandItem).toBe(STARTER_BOW);
  expect(() => f.run(server.savePlayerProgress, { ...progress(f), equippedRightHand: "ion_bow", enemyKills: 0 })).toThrow(/Reach .* to equip/);

  // With nothing usable in the bag, the hand falls back to the starter stone every player owns.
  const bare = crystalFixture();
  bare.patch("playerProgress", { ...ALL_MAPS, bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime,
    inventoryJson: JSON.stringify(["ion_bow"]), equippedRightHand: "ion_bow" });
  bare.seed("proceduralProgress", { identity: bare.ctx.sender, completed: 1 });
  bare.run(server.prestigeAccount, {});
  expect(inventory(bare)).toContain("ion_bow");
  expect(progress(bare).equippedRightHand).toBe(STARTER_STONE);
});

it("keeps the kind of weapon through prestige: an archer gets a bow, a swordsman a sword", () => {
  const bag = (...weapons: string[]) => JSON.stringify([...weapons, "ion_helmet", "forest_cap", SAMURAI_HAT]);
  // The Wooden Sword hits harder than the starter bow, but an archer keeps a bow.
  const archer = veteran();
  archer.patch("playerProgress", { inventoryJson: bag(STARTER_BOW, WOODEN_SWORD, "ion_bow") });
  archer.run(server.prestigeAccount, {});
  expect(progress(archer).equippedRightHand).toBe(STARTER_BOW);

  const swordsman = veteran();
  swordsman.patch("playerProgress", { inventoryJson: bag(STARTER_BOW, WOODEN_SWORD, "ion_sword"), equippedRightHand: "ion_sword" });
  swordsman.run(server.prestigeAccount, {});
  expect(progress(swordsman).equippedRightHand).toBe(WOODEN_SWORD);
  expect(inventory(swordsman)).toContain("ion_sword");

  // With no sword they can use yet, the best ranged weapon instead.
  const unarmed = veteran();
  unarmed.patch("playerProgress", { inventoryJson: bag(STARTER_BOW, "ion_sword"), equippedRightHand: "ion_sword" });
  unarmed.run(server.prestigeAccount, {});
  expect(progress(unarmed).equippedRightHand).toBe(STARTER_BOW);
});

it("still clears the bag and kept copies on a reset", () => {
  const f = veteran();
  f.run(server.resetPlayerProgress, {});
  expect(inventory(f)).not.toContain("ion_bow");
  expect(copies(f)).toEqual([]);
  expect(offers(f)).toEqual([]);
  expect(progress(f).equippedRightHand).toBe(STARTER_STONE);
});

it("keeps a staff player on staffs: new drops, prestige, and no usable staff falling back to ranged", () => {
  const mage = looter({ inventoryJson: JSON.stringify(["desert_staff"]), equippedRightHand: "desert_staff" });
  reportEnemy(mage, ENEMY, 1);
  expect(inventory(mage)).toEqual(expect.arrayContaining(["crystal_bow", "crystal_sword", "crystal_staff"]));
  expect(progress(mage).equippedRightHand).toBe("crystal_staff");
  // An archer is never handed a staff, nor a swordsman.
  const archer = looter();
  reportEnemy(archer, ENEMY, 1);
  expect(progress(archer).equippedRightHand).toBe("crystal_bow");

  const bag = (...weapons: string[]) => JSON.stringify([...weapons, "ion_helmet", "forest_cap", SAMURAI_HAT]);
  const veteranMage = veteran();
  veteranMage.patch("playerProgress", { inventoryJson: bag(STARTER_BOW, WOODEN_SWORD, "forest_staff", "ion_staff"), equippedRightHand: "ion_staff" });
  veteranMage.run(server.prestigeAccount, {});
  expect(progress(veteranMage).equippedRightHand).toBe("forest_staff");
  const unarmed = veteran();
  unarmed.patch("playerProgress", { inventoryJson: bag(STARTER_BOW, "ion_staff"), equippedRightHand: "ion_staff" });
  unarmed.run(server.prestigeAccount, {});
  expect(progress(unarmed).equippedRightHand).toBe(STARTER_BOW);
});
