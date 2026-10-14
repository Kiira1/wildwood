import { SenderError, table, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import { BUILD_SLOTS, parseBuildCards, type BuildGear } from "../../shared/builds";
import { canHoldCards, cardFitsItem } from "../../shared/cards";
import { addCard, gearSlotsFor, setGearSlots, takeCard } from "./gear-cards";
import { readPlayerProgress } from "./wide-stats";

/**
 * A player's saved Builds: the gear in each slot and the cards in each of those items, as they were when saved.
 * Equipping one puts the gear on from the client (the ordinary equip path) and moves the cards here.
 */
export const playerBuild = table({ name: "player_build", public: false }, {
  key: t.string().primaryKey(),
  identity: t.identity().index("btree"),
  slot: t.u8(),
  gearJson: t.string(),
  cardsJson: t.string(),
  savedAt: t.timestamp(),
});

type Ctx = any;
export const buildKey = (identity: Identity, slot: number) => `${identity.toHexString()}:${slot}`;

export type BuildDeps = {
  requireControllingPlayer: (ctx: Ctx) => any;
  activeDuelFor: (ctx: Ctx, identity: Identity) => unknown;
  inventoryForProgress: (progress: any) => string[];
  writeProgressAndPresentation: (ctx: Ctx, progress: any) => void;
  syncAttackCap?: (ctx: Ctx, identity: Identity) => void;
};

const validSlot = (slot: number) => {
  if (!Number.isInteger(slot) || slot < 0 || slot >= BUILD_SLOTS) throw new SenderError("That build does not exist.");
};

/** Saves what the player wears now, and the cards in each worn item, into a build slot. */
export function saveBuildFor(ctx: Ctx, { slot }: { slot: number }, deps: BuildDeps) {
  deps.requireControllingPlayer(ctx);
  validSlot(slot);
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress) throw new SenderError("Character unavailable.");
  const gear: BuildGear = { HEAD: progress.equippedHead || "", CHEST: progress.equippedChest || "", FEET: progress.equippedFeet || "", HAND: progress.equippedRightHand || "" };
  const cards: Record<string, string[]> = {};
  for (const itemId of Object.values(gear)) if (itemId && canHoldCards(itemId)) cards[itemId] = [...gearSlotsFor(ctx, ctx.sender, itemId).cards];
  const row = { key: buildKey(ctx.sender, slot), identity: ctx.sender, slot, gearJson: JSON.stringify(gear), cardsJson: JSON.stringify(cards), savedAt: ctx.timestamp };
  if (ctx.db.playerBuild.key.find(row.key)) ctx.db.playerBuild.key.update(row);
  else ctx.db.playerBuild.insert(row);
}

/**
 * Moves the build's cards into its items: the cards in those items go back to the player's cards first, then each
 * item takes the build's cards that the player still has and that fit. Cards no longer held are skipped. The
 * client equips the gear before calling this, so a worn item's stats follow at once.
 */
export function applyBuildCardsFor(ctx: Ctx, { slot }: { slot: number }, deps: BuildDeps) {
  deps.requireControllingPlayer(ctx);
  validSlot(slot);
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const build = ctx.db.playerBuild.key.find(buildKey(ctx.sender, slot));
  if (!build) throw new SenderError("Save this build first.");
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress) throw new SenderError("Character unavailable.");
  const held = new Set(deps.inventoryForProgress(progress));
  const wanted = parseBuildCards(build.cardsJson);
  const items = Object.keys(wanted).filter(itemId => held.has(itemId) && canHoldCards(itemId));
  for (const itemId of items) {
    const current = gearSlotsFor(ctx, ctx.sender, itemId);
    for (const cardId of current.cards) addCard(ctx, ctx.sender, cardId);
    setGearSlots(ctx, ctx.sender, itemId, 0n, { slots: current.slots, cards: [] });
  }
  for (const itemId of items) {
    const { slots } = gearSlotsFor(ctx, ctx.sender, itemId);
    const cards: string[] = [];
    for (const cardId of wanted[itemId]) {
      if (cards.length >= slots || !cardFitsItem(cardId, itemId)) continue;
      if (takeCard(ctx, ctx.sender, cardId)) cards.push(cardId);
    }
    setGearSlots(ctx, ctx.sender, itemId, 0n, { slots, cards });
  }
  deps.syncAttackCap?.(ctx, ctx.sender);
  deps.writeProgressAndPresentation(ctx, readPlayerProgress(ctx, ctx.sender) ?? progress);
}

export function registerBuilds(spacetimedb: typeof spacetimedbType, deps: BuildDeps) {
  const saveBuild = spacetimedb.reducer({ slot: t.u8() }, (ctx: any, args: { slot: number }) => saveBuildFor(ctx, args, deps));
  const applyBuildCards = spacetimedb.reducer({ slot: t.u8() }, (ctx: any, args: { slot: number }) => applyBuildCardsFor(ctx, args, deps));
  const myBuilds = spacetimedb.view({ name: "my_builds", public: true }, t.array(playerBuild.rowType),
    (ctx: any) => [...ctx.db.playerBuild.identity.filter(ctx.sender)]);
  return { saveBuild, applyBuildCards, myBuilds };
}

