import { SenderError, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import { isGradeItemId } from "../../shared/grade-equipment";
import { gradeShopNeed, gradeShopOpen, gradeShopPrice, masteryLevels } from "../../shared/grade-shop";
import { isSkillWeapon } from "../../shared/weapon-skills";
import { standsAtTheSmith } from "./item-refine";
import { readPlayerProgress } from "./wide-stats";
import { collectItem, freeBagSlots } from "./equipment-copies";
import { activeItemUpgradeEntriesFor } from "./upgrade-bench-slots";
import { weaponMasteryPoints } from "./weapon-mastery";
import { takeGold } from "./gold";
import { ensureWeaponSkillRoll } from "./weapon-skills";
import { luckInPlay } from "./luck-research";

type Ctx = any;

export type GradeShopDeps = {
  requireControllingPlayer: (ctx: Ctx) => any;
  activeDuelFor: (ctx: Ctx, identity: Identity) => unknown;
  inventoryForProgress: (progress: any) => string[];
  restoreItemToProgress: (progress: any, itemId: string) => any;
  writeProgressAndPresentation: (ctx: Ctx, progress: any) => void;
};

/**
 * One graded piece from the Smith for gold, into a free bag slot, as a new drop arrives: collected, its weapon
 * skills rolled, not worn. `expectedPrice` is the price the player saw, so a stale window cannot pay another.
 */
export function buyGradeGearFor(ctx: Ctx, args: { itemId: string; expectedPrice: bigint }, deps: GradeShopDeps) {
  const player = deps.requireControllingPlayer(ctx);
  if (!standsAtTheSmith(ctx, player)) throw new SenderError("Talk to the Smith first.");
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const { itemId } = args, price = gradeShopPrice(itemId);
  if (!isGradeItemId(itemId) || price === undefined) throw new SenderError("The Smith does not sell that.");
  if (BigInt(price) !== args.expectedPrice) throw new SenderError("The Smith's price changed. Take another look.");
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress) throw new SenderError("Player unavailable.");
  const inventory = deps.inventoryForProgress(progress);
  // A piece on the Upgrade Bench is still the player's.
  if (inventory.includes(itemId) || activeItemUpgradeEntriesFor(ctx, ctx.sender).some(({ active }) => active.itemId === itemId)) {
    throw new SenderError("You already have that.");
  }
  if (!gradeShopOpen(itemId, masteryLevels(weaponMasteryPoints(ctx, ctx.sender)))) throw new SenderError(`You need ${gradeShopNeed(itemId)}.`);
  if (freeBagSlots(ctx, ctx.sender, progress, inventory) <= 0) throw new SenderError("Your bag is full. Free a slot first.");
  if (!takeGold(ctx, ctx.sender, price)) throw new SenderError(`You need ${price.toLocaleString("en-US")} Gold.`);
  collectItem(ctx, ctx.sender, itemId);
  ensureWeaponSkillRoll(ctx, ctx.sender, itemId, isSkillWeapon(itemId) ? luckInPlay(ctx, ctx.sender).skillLuck : 0);
  deps.writeProgressAndPresentation(ctx, deps.restoreItemToProgress(progress, itemId));
}

/** The buy_grade_gear reducer. */
export function registerGradeShop(spacetimedb: typeof spacetimedbType, deps: GradeShopDeps) {
  const buyGradeGear = spacetimedb.reducer({ itemId: t.string(), expectedPrice: t.u64() },
    (ctx: any, args: { itemId: string; expectedPrice: bigint }) => buyGradeGearFor(ctx, args, deps));
  return { buyGradeGear };
}
