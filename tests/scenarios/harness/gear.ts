import { vi } from "vitest";
import { TOWN_CARD_SELLER_POSITION, TOWN_FEET_OFFSET, TOWN_SCHOOL_POSITIONS, TOWN_SMITH_POSITION } from "../../../shared/town";
import { masteryPointsForLevel, type WeaponSchool } from "../../../shared/weapon-mastery";
import { addGold } from "../../../spacetimedb/src/gold";
import { grantMasteryPoints, weaponMasteryPoints } from "../../../spacetimedb/src/weapon-mastery";
import { freeBagSlots } from "../../../spacetimedb/src/equipment-copies";
import { addOres, oreCount, refineLevelFor } from "../../../spacetimedb/src/item-refine";
import type { OreId } from "../../../shared/refine";
import { writeProgressAndPresentation } from "../../../spacetimedb/src/player-power";
import { inventoryForProgress, restoreItemToProgress } from "../../../spacetimedb/src/progress-helpers";
import { readPlayerProgress } from "../../../spacetimedb/src/wide-stats";
import { applyGemBalanceChange } from "../../../spacetimedb/src/gem-wallet";
import { AGE_BAND_ADULT, TERMS_VERSION } from "../../../shared/legal";
import { BOSS_REWARD_CLAIM_BITS } from "../../../shared/rules";
import { ENEMY_TYPES } from "../../../shared/enemy-definitions";
import { enemyDefeatDefinition } from "../../../shared/enemy-defeats";
import type { ScenarioPlayer, ScenarioWorld } from "./server";
import type { GameTab } from "./game";

/** Where a player stands to use a Town station: feet at its spot. */
const feetAt = (spot: { x: number; y: number }) => ({ mapId: "town", x: spot.x, y: spot.y - TOWN_FEET_OFFSET });
export const TOWN_SPOTS = {
  smith: feetAt(TOWN_SMITH_POSITION),
  cardSeller: feetAt(TOWN_CARD_SELLER_POSITION),
  school: (school: WeaponSchool) => feetAt(TOWN_SCHOOL_POSITIONS[school]),
};

/** Puts the player at a spot, as if they had walked there: their position, and no older movement to extrapolate from. */
export function standAt(world: ScenarioWorld, player: ScenarioPlayer, spot: { mapId: string; x: number; y: number }) {
  world.setup(ctx => { if (ctx.db.playerMotion.identity.find(player.identity)) ctx.db.playerMotion.identity.delete(player.identity); });
  player.patch("player", spot);
}

/** Fixture gold on the server. */
export function giveGold(world: ScenarioWorld, player: ScenarioPlayer, amount: number) {
  world.setup(ctx => addGold(ctx as never, player.identity, amount));
}

let gemGrants = 0;
/** Fixture Gems in the wallet. */
export function giveGems(world: ScenarioWorld, player: ScenarioPlayer, amount: number) {
  world.setup(ctx => applyGemBalanceChange(ctx, { identity: player.identity, delta: BigInt(amount), kind: "scenario", note: "Scenario fixture.", externalReference: `scenario:${++gemGrants}` }));
}

/** The Gems the server holds for the player. */
export const gemsOf = (world: ScenarioWorld, player: ScenarioPlayer) => world.db.playerGemWallet.identity.find(player.identity)?.balance ?? 0n;

/** The gold the server holds for the player. */
export const goldOf = (world: ScenarioWorld, player: ScenarioPlayer) => world.db.playerGold.identity.find(player.identity)?.gold ?? 0n;

/** Fixture ores and wood in the bag. */
export function giveOres(world: ScenarioWorld, player: ScenarioPlayer, ores: Partial<Record<OreId, number>>) {
  world.setup(ctx => { for (const [oreId, count] of Object.entries(ores)) addOres(ctx, player.identity, oreId as OreId, count!); });
}

/** How many of an ore the server holds for the player. */
export const oresOf = (world: ScenarioWorld, player: ScenarioPlayer, oreId: OreId) => world.setup(ctx => oreCount(ctx, player.identity, oreId));

/** A copy's refine on the server (copy 0 is the one in the bag's first place). */
export const refineOf = (world: ScenarioWorld, player: ScenarioPlayer, itemId: string, copyId = 0n) =>
  world.setup(ctx => refineLevelFor(ctx, player.identity, itemId, copyId));

/** Raises a school's Mastery to at least `level`. */
export function setMastery(world: ScenarioWorld, player: ScenarioPlayer, school: WeaponSchool, level: number) {
  world.setup(ctx => {
    const have = Number(weaponMasteryPoints(ctx as never, player.identity)[school] ?? 0n);
    grantMasteryPoints(ctx as never, player.identity, school, masteryPointsForLevel(level) - have);
  });
}

/** Fixture items into the bag, as a drop or a buy would leave them (collected nowhere, not worn). */
export function giveItems(world: ScenarioWorld, player: ScenarioPlayer, ...itemIds: string[]) {
  world.setup(ctx => {
    let progress = readPlayerProgress(ctx as never, player.identity);
    for (const itemId of itemIds) progress = restoreItemToProgress(progress, itemId);
    writeProgressAndPresentation(ctx, progress);
  });
}

/** Fixture: the item is held and worn in its slot ("equippedRightHand", "equippedHead", ...). */
export function wear(world: ScenarioWorld, player: ScenarioPlayer, itemId: string, field: "equippedRightHand" | "equippedHead" | "equippedChest" | "equippedFeet") {
  world.setup(ctx => {
    const progress = restoreItemToProgress(readPlayerProgress(ctx as never, player.identity), itemId);
    writeProgressAndPresentation(ctx, { ...progress, [field]: itemId });
  });
}

/** The bag slots left free on the server. */
export function freeSlots(world: ScenarioWorld, player: ScenarioPlayer) {
  return world.setup(ctx => {
    const progress = readPlayerProgress(ctx as never, player.identity);
    return freeBagSlots(ctx, player.identity, progress, inventoryForProgress(progress));
  });
}

/** Kept extra copies of a held item until no bag slot is left. */
export function fillBag(world: ScenarioWorld, player: ScenarioPlayer, itemId: string) {
  giveItems(world, player, itemId);
  for (let left = freeSlots(world, player); left > 0; left--) {
    world.setup(ctx => ctx.db.playerEquipmentCopy.insert({ id: 0n, identity: player.identity, itemId, arrowStorm: 0, ricochet: 0, piercingShot: 0,
      whirlwind: 0, deflect: 0, shockwave: 0, acquiredAt: ctx.timestamp }));
  }
}

/** The bag on the server: item ids held (worn or not). */
export const serverBag = (player: ScenarioPlayer) => inventoryForProgress(player.progress());

const KILL_STREAM = "scenario-kills-stream-01";
/**
 * One honest kill report for the player's map, as the client sends it: `count` of `enemy` (the map's first) after
 * `ms` of play. `player` must hold the session (a booted tab's is `tab.network.players.get(name)`).
 */
export function reportKills(world: ScenarioWorld, player: ScenarioPlayer, count: number, ms: number, enemy?: string) {
  const mapId = player.row("player").mapId;
  enemy ??= Object.keys(ENEMY_TYPES).find(kind => enemyDefeatDefinition(mapId, kind))!;
  const key = `${player.hex}:${KILL_STREAM}`;
  const sequence = (world.db.regularEnemyStream.key.find(key)?.sequence ?? world.db.regularEnemyLootCursor.key.find(key)?.sequence ?? 0n) + 1n;
  player.call("reportEnemyDefeats", { mapId, streamId: KILL_STREAM, sequence, simulatedMillis: ms, enemies: [{ enemy, count }] });
}

/** A run that may prestige: the final boss beaten and the first Endless stage done. */
export function readyToPrestige(world: ScenarioWorld, player: ScenarioPlayer) {
  player.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
  world.setup(ctx => {
    if (!ctx.db.proceduralProgress.identity.find(player.identity)) ctx.db.proceduralProgress.insert(world.storage.row("proceduralProgress", { identity: player.identity, completed: 1 }));
  });
}

/**
 * A guest signs in to a new account (SpacetimeAuth) and keeps their save: the guest asks for a link, the account
 * claims it. Returns the account player, connected.
 */
export function signInAs(world: ScenarioWorld, guest: ScenarioPlayer, accountName: string) {
  const code = `scenario-link-${guest.hex.slice(0, 40)}`;
  guest.call("beginAccountLink", { code });
  const account = world.player(accountName, "account").connect();
  account.call("acceptTerms", { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
  account.call("claimGuestAccount", { code });
  return account;
}

/** A tap on an element found without an id, as the player's finger would land it. */
export function press(tab: GameTab, target: Element | null | undefined) {
  if (!target) throw new Error("Nothing to tap");
  if ((target as HTMLButtonElement).disabled) throw new Error("That button is disabled");
  for (const type of ["pointerdown", "pointerup", "click"]) target.dispatchEvent(new (tab.window as any).Event(type, { bubbles: true }));
}

/** The game's own confirm prompt, answered: true taps its accept button (the last), false its cancel. */
export async function answerConfirm(tab: GameTab, accept: boolean) {
  await playUntil(tab, () => tab.shown("gameConfirm"), "the game asks to confirm");
  const buttons = [...tab.element("gameConfirm").querySelectorAll("button")];
  press(tab, accept ? buttons.at(-1) : buttons[0]);
}

/** On screen: neither it nor any parent hidden. */
export function visible(tab: GameTab, node: Element | null | undefined) {
  for (let at = node as HTMLElement | null; at; at = at.parentElement) {
    if (at.hasAttribute?.("hidden") || at.style?.display === "none" || (at.tagName === "DIALOG" && !at.hasAttribute("open"))) return false;
  }
  return Boolean(node);
}

/** The open window (a <dialog>) whose title has this id. */
export function windowTitled(tab: GameTab, titleId: string) {
  const title = tab.document.getElementById(titleId);
  const dialog = title?.closest("dialog") as HTMLElement | null;
  return dialog && visible(tab, dialog) ? dialog : null;
}

/** A number as the game prints it ("1,250"). */
export const shownNumber = (text: string | null | undefined) => Number((text ?? "").replace(/[^\d.]/g, ""));

/** The items in the bag panel (opening it when closed): one entry per stack, by item id. */
export function bagItems(tab: GameTab) {
  if (!tab.shown("inventoryPanel")) tab.tap("inventoryBtn");
  return [...tab.element("inventoryItems").querySelectorAll<HTMLElement>("[data-inventory-location=BAG][data-item-id]")]
    .map(node => ({ itemId: node.dataset.itemId!, copyId: BigInt(node.dataset.copyId ?? "0"), node }));
}

/** What each equipment slot on the profile shows, by slot. */
export function wornItems(tab: GameTab) {
  if (!tab.shown("inventoryPanel")) tab.tap("inventoryBtn");
  const slot = (id: string) => tab.element(id).dataset.itemId ?? "";
  return { head: slot("equippedHeadSlot"), chest: slot("equippedChestSlot"), feet: slot("equippedFeetSlot"), hand: slot("equippedRightHandSlot") };
}

/** Fixture rows changed outside any call reach the open tab's subscriptions, as the next server update would bring them. */
export function deliverRows(tab: GameTab) {
  for (const connection of tab.network.connections) connection.fake.deliver();
}

/** Plays frames until the server and the client agree on `done`, failing with `what` when they never do. */
export async function playUntil(tab: GameTab, done: () => boolean, what: string, ms = 5_000) {
  if (!await tab.until(done, ms)) throw new Error(`Never happened: ${what}`);
}

/** Plays on until a call the game made has answered, as the player keeps playing while it is on its way. */
export async function answered<T>(tab: GameTab, pending: Promise<T>, ms = 10_000): Promise<T> {
  let done = false;
  const result = pending.finally(() => { done = true; });
  await playUntil(tab, () => done, "the call answered", ms);
  return result;
}

/** Lets promise chains from a tap settle without moving the game clock much. */
export const settle = () => vi.advanceTimersByTimeAsync(0);
