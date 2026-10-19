import { SenderError, table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import { canonicalItemId, STARTER_STONE } from "../../shared/items";
import { withItemEquipped } from "../../shared/equip-best";
import { isSkillWeapon } from "../../shared/weapon-skills";
import { TOWN_FEET_OFFSET } from "../../shared/town";
import {
  STARTER_CHEST_MAP_ID, STARTER_CHEST_POSITION, STARTER_CHEST_SERVER_REACH, STARTER_WEAPON_KINDS, isStarterWeaponKind, starterWeaponId,
} from "../../shared/starter-chest";
import { withinStationReach } from "./door-reach";
import { readPlayerProgress, iterPlayerProgress } from "./wide-stats";
import { inventoryForProgress, restoreItemToProgress } from "./progress-helpers";
import { writeProgressAndPresentation } from "./player-power";
import { collectItem, freeBagSlots } from "./equipment-copies";
import { ensureWeaponSkillRoll } from "./weapon-skills";
import { luckInPlay } from "./luck-research";
import { allowedLoadout } from "./loadout";
import { markLeaderboardDirty, requestLeaderboardRefresh } from "./leaderboard-refresh";

/**
 * Who has opened the Starter Chest, and what they took: bow, sword or staff, or "all" for a player from before
 * the chest, who was given every one (migration 63). Private. Prestige keeps it; Reset Save clears it, so a fresh
 * save picks again; deleting the account erases it; a guest's follows its save onto the account.
 */
export const playerStarterWeapon = table({ name: "player_starter_weapon", public: false }, {
  identity: t.identity().primaryKey(),
  kind: t.string(),
  at: t.timestamp(),
});

type Ctx = any;
const CHEST_STAND = { x: STARTER_CHEST_POSITION.x, y: STARTER_CHEST_POSITION.y - TOWN_FEET_OFFSET };

export type StarterChestDeps = {
  requireControllingPlayer: (ctx: Ctx) => any;
  activeDuelFor: (ctx: Ctx, identity: Identity) => unknown;
};

/** A weapon into the save, as the Smith hands one over: collected and its skills rolled. */
function withWeapon(ctx: Ctx, identity: Identity, progress: any, itemId: string) {
  collectItem(ctx, identity, itemId);
  ensureWeaponSkillRoll(ctx, identity, itemId, isSkillWeapon(itemId) ? luckInPlay(ctx, identity).skillLuck : 0);
  return restoreItemToProgress(progress, itemId);
}

/** The save with `itemId` in hand, by the bag's own hand rules. */
function withWeaponInHand(progress: any, itemId: string) {
  const allowed = allowedLoadout(withItemEquipped(progress, itemId), inventoryForProgress(progress));
  return { ...progress, equippedRightHand: allowed.equippedRightHand, equippedLeftHand: allowed.equippedLeftHand };
}

/** Whether the hand holds the starter stone and nothing better. An emptied hand is a choice and stays empty. */
const holdsTheStone = (progress: any) => canonicalItemId(progress.equippedRightHand) === STARTER_STONE && !progress.equippedLeftHand;

export const starterChestOpened = (ctx: Ctx, identity: Identity) => Boolean(ctx.db.playerStarterWeapon.identity.find(identity));

/** The pick: one per account, standing at the chest. The Crude piece goes into the bag and into the hand. */
export function claimStarterWeaponFor(ctx: Ctx, args: { kind: string }, deps: StarterChestDeps) {
  const player = deps.requireControllingPlayer(ctx);
  if (!isStarterWeaponKind(args.kind)) throw new SenderError("Pick a bow, a sword or a staff.");
  if (starterChestOpened(ctx, ctx.sender)) throw new SenderError("You already opened the Starter Chest.");
  if (player.mapId !== STARTER_CHEST_MAP_ID || !withinStationReach(ctx, player, CHEST_STAND, STARTER_CHEST_SERVER_REACH)) {
    throw new SenderError("Walk up to the Starter Chest first.");
  }
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress) throw new SenderError("Player unavailable.");
  const itemId = starterWeaponId(args.kind), inventory = inventoryForProgress(progress);
  let next = progress;
  if (!inventory.includes(itemId)) {
    if (freeBagSlots(ctx, ctx.sender, progress, inventory) <= 0) throw new SenderError("Your bag is full. Free a slot first.");
    next = withWeapon(ctx, ctx.sender, progress, itemId);
  }
  writeProgressAndPresentation(ctx, withWeaponInHand(next, itemId));
  markLeaderboardDirty(ctx, ctx.sender);
  ctx.db.playerStarterWeapon.insert({ identity: ctx.sender, kind: args.kind, at: ctx.timestamp });
}

/**
 * Migration 63: every player already here gets the Crude Bow, Sword and Staff they lack, and their chest counts as
 * opened. Nothing worn changes, except a hand holding only the stone takes the Crude Bow, its own kind. A player
 * with a row was already given theirs.
 */
export function giveEveryoneStarterWeapons(ctx: Ctx) {
  let equipped = false;
  for (const progress of [...iterPlayerProgress(ctx)] as any[]) {
    const identity = progress.identity;
    if (starterChestOpened(ctx, identity)) continue;
    let next = progress;
    for (const kind of STARTER_WEAPON_KINDS) {
      const itemId = starterWeaponId(kind);
      if (!inventoryForProgress(next).includes(itemId)) next = withWeapon(ctx, identity, next, itemId);
    }
    if (holdsTheStone(next)) {
      next = withWeaponInHand(next, starterWeaponId("bow"));
      markLeaderboardDirty(ctx, identity);
      equipped = true;
    }
    if (next !== progress) writeProgressAndPresentation(ctx, next);
    ctx.db.playerStarterWeapon.insert({ identity, kind: "all", at: ctx.timestamp });
  }
  if (equipped) requestLeaderboardRefresh(ctx);
}

/** Reset Save: the fresh save picks again. */
export function removeStarterWeapon(ctx: Ctx, identity: Identity) {
  if (ctx.db.playerStarterWeapon.identity.find(identity)) ctx.db.playerStarterWeapon.identity.delete(identity);
}

/** A guest's save replaces the account's on link, and its chest with it: opened or not, as the guest left it. */
export function mergeStarterWeapon(ctx: Ctx, guest: Identity, account: Identity) {
  const row = ctx.db.playerStarterWeapon.identity.find(guest);
  removeStarterWeapon(ctx, account);
  removeStarterWeapon(ctx, guest);
  if (row) ctx.db.playerStarterWeapon.insert({ ...row, identity: account });
}

/** The claim_starter_weapon reducer and the caller's own row, so the client knows whether to show the chest. */
export function registerStarterChest(spacetimedb: typeof spacetimedbType, deps: StarterChestDeps) {
  const claimStarterWeapon = spacetimedb.reducer({ kind: t.string() },
    (ctx: any, args: { kind: string }) => claimStarterWeaponFor(ctx, args, deps));
  const myStarterWeapon = spacetimedb.view({ name: "my_starter_weapon", public: true }, t.array(playerStarterWeapon.rowType),
    (ctx: any) => { const row = ctx.db.playerStarterWeapon.identity.find(ctx.sender); return row ? [row] : []; });
  return { claimStarterWeapon, myStarterWeapon };
}
