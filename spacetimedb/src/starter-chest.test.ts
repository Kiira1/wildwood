import { expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { progressOf } from "../../tests/helpers/progress";
import { MODULE_MIGRATION_VERSION } from "./module-migrations";
import { giveEveryoneStarterWeapons } from "./starter-chest";
import { STARTER_STONE } from "../../shared/items";
import { gradeItemId } from "../../shared/grade-equipment";
import { STARTER_CHEST_POSITION, starterWeaponId } from "../../shared/starter-chest";
import { ATTACK_BALANCE_VERSION, BOSS_REWARD_CLAIM_BITS, SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
const BOW = starterWeaponId("bow"), SWORD = starterWeaponId("sword"), STAFF = starterWeaponId("staff");
const RARE_SWORD = gradeItemId("sword", "rare");
const bag = (f: Fixture, who = f.ctx.sender): string[] => JSON.parse(progressOf(f, who).inventoryJson);
const chest = (f: Fixture, who = f.ctx.sender) => f.db.playerStarterWeapon.identity.find(who);
/** Feet at the chest's foot, in the forest; `dx` steps east of it. */
const atChest = (f: Fixture, dx = 0) => f.patch("player", { mapId: "tutorial_forest", x: STARTER_CHEST_POSITION.x + dx, y: STARTER_CHEST_POSITION.y - 29 });
const newPlayer = () => {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([STARTER_STONE]), equippedRightHand: STARTER_STONE });
  return f;
};
const migrate = (f: Fixture) => {
  f.seed("moduleMigrationState", { id: 0, version: 62 });
  const connectionId = f.ctx.connectionId;
  f.ctx.connectionId = null;
  f.run(server.onConnect);
  f.ctx.connectionId = connectionId;
};

it("hands a new player the one weapon they pick at the chest, into the bag and the hand, once", () => {
  const f = newPlayer();
  atChest(f, 400);
  expect(() => f.run(server.claimStarterWeapon, { kind: "sword" })).toThrow("Walk up to the Starter Chest first.");
  f.patch("player", { mapId: "crystal_hollows", x: STARTER_CHEST_POSITION.x, y: STARTER_CHEST_POSITION.y - 29 });
  expect(() => f.run(server.claimStarterWeapon, { kind: "sword" })).toThrow("Walk up to the Starter Chest first.");
  atChest(f);
  expect(() => f.run(server.claimStarterWeapon, { kind: "axe" })).toThrow("Pick a bow, a sword or a staff.");
  expect(chest(f)).toBeNull();

  f.run(server.claimStarterWeapon, { kind: "sword" });
  expect(bag(f)).toContain(SWORD);
  expect(bag(f)).not.toContain(BOW);
  expect(progressOf(f)).toMatchObject({ equippedRightHand: SWORD, equippedLeftHand: "" });
  expect(f.db.playerItemCollection.key.find(`${f.ctx.sender.toHexString()}:${SWORD}`)).toBeTruthy();
  expect(chest(f)).toMatchObject({ kind: "sword" });
  expect(() => f.run(server.claimStarterWeapon, { kind: "bow" })).toThrow("You already opened the Starter Chest.");
  expect(bag(f)).not.toContain(BOW);
});

it("keeps the chest opened through prestige; Reset Save lets the fresh save pick again", () => {
  const f = newPlayer();
  atChest(f);
  f.run(server.claimStarterWeapon, { kind: "staff" });
  f.seed("playerPrestige", { identity: f.ctx.sender, level: 1, perkPoints: 0, peakPower: 0, prestigedAt: f.ctx.timestamp });
  f.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
  f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 12 });
  f.run(server.prestigeAccount);
  expect(f.db.playerPrestige.identity.find(f.ctx.sender).level).toBe(2);
  expect(chest(f)).toMatchObject({ kind: "staff" });
  expect(bag(f)).toContain(STAFF);
  f.run(server.resetPlayerProgress, {});
  expect(chest(f)).toBeNull();
  expect(bag(f)).not.toContain(STAFF);
  atChest(f);
  f.run(server.claimStarterWeapon, { kind: "bow" });
  expect(progressOf(f).equippedRightHand).toBe(BOW);
});

it("moves a guest's chest onto the account it links to, opened or not", () => {
  const f = crystalFixture();
  const guest = identity("2");
  f.seed("moduleMigrationState", { id: 0, version: MODULE_MIGRATION_VERSION });
  f.db.playerProgress.identity.delete(f.ctx.sender);
  f.progress(guest, { inventoryJson: JSON.stringify([STARTER_STONE, BOW]), equippedRightHand: BOW });
  f.seed("playerBalanceVersion", { identity: guest, version: ATTACK_BALANCE_VERSION });
  f.seed("playerStarterWeapon", { identity: guest, kind: "bow", at: f.ctx.timestamp });
  f.seed("accountLink", { code: "chest-link", guest, createdAt: f.ctx.timestamp });
  f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
  f.run(server.claimGuestAccount, { code: "chest-link" });
  expect(chest(f)).toMatchObject({ kind: "bow" });
  expect(chest(f, guest)).toBeNull();
});

it("migration 63 gives everyone already here the Crude Bow, Sword and Staff they lack and opens their chest", () => {
  const f = crystalFixture();
  const archer = f.ctx.sender, swordsman = identity("3"), unarmed = identity("4"), picked = identity("5");
  // Holds the stone and already owns the bow: gets the other two, and the bow goes into the stone's hand.
  f.patch("playerProgress", { inventoryJson: JSON.stringify([STARTER_STONE, BOW]), equippedRightHand: STARTER_STONE });
  f.progress(swordsman, { inventoryJson: JSON.stringify([STARTER_STONE, RARE_SWORD]), equippedRightHand: RARE_SWORD });
  f.progress(unarmed, { inventoryJson: JSON.stringify([STARTER_STONE]) });
  f.progress(picked, { inventoryJson: JSON.stringify([STARTER_STONE, SWORD]), equippedRightHand: SWORD });
  f.seed("playerStarterWeapon", { identity: picked, kind: "sword", at: f.ctx.timestamp });
  migrate(f);
  expect(f.db.moduleMigrationState.id.find(0).version).toBe(MODULE_MIGRATION_VERSION);
  expect(MODULE_MIGRATION_VERSION).toBeGreaterThanOrEqual(63);

  for (const who of [archer, swordsman, unarmed]) {
    expect(bag(f, who), who.toHexString()).toEqual(expect.arrayContaining([BOW, SWORD, STAFF]));
    expect(chest(f, who)).toMatchObject({ kind: "all" });
  }
  expect(progressOf(f, archer)).toMatchObject({ equippedRightHand: BOW, equippedLeftHand: "" });
  expect(bag(f, archer).filter(itemId => itemId === BOW)).toHaveLength(1);
  // Worn gear stays, and so does a hand emptied on purpose.
  expect(progressOf(f, swordsman).equippedRightHand).toBe(RARE_SWORD);
  expect(progressOf(f, unarmed)).toMatchObject({ equippedRightHand: "", equippedLeftHand: "" });
  // A player whose chest is already open is left as they are.
  expect(bag(f, picked)).toEqual([STARTER_STONE, SWORD]);
  expect(chest(f, picked)).toMatchObject({ kind: "sword" });
  expect(f.db.playerItemCollection.key.find(`${swordsman.toHexString()}:${STAFF}`)).toBeTruthy();

  // Again changes nothing.
  const before = [archer, swordsman, unarmed, picked].map(who => [bag(f, who), progressOf(f, who).equippedRightHand]);
  f.transaction(() => giveEveryoneStarterWeapons(f.ctx));
  expect([archer, swordsman, unarmed, picked].map(who => [bag(f, who), progressOf(f, who).equippedRightHand])).toEqual(before);
});
