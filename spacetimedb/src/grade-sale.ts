import { SenderError, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import { canonicalItemId } from "../../shared/items";
import { gradeShopSalePrice } from "../../shared/grade-shop";
import { equipmentLocked } from "./equipment-locks";
import { readPlayerProgress } from "./wide-stats";
import { addGold } from "./gold";

type Ctx = any;

export type GradeSaleDeps = {
  requireControllingPlayer: (ctx: Ctx) => unknown;
  activeDuelFor: (ctx: Ctx, identity: Identity) => unknown;
  inventoryForProgress: (progress: any) => string[];
  /** One copy out of the bag, as destroy_equipment_copy takes it (equipment-copies.ts). */
  removeCopy: (ctx: Ctx, itemId: string, copyId: bigint) => void;
};

const worn = (progress: any, itemId: string) =>
  [progress.equippedHead, progress.equippedChest, progress.equippedFeet, progress.equippedRightHand, progress.equippedLeftHand].includes(itemId);

/**
 * Sells one copy of a graded piece to the Smith for gold (gradeShopSalePrice). Refines and crafting add nothing.
 * Copy 0 is the first copy, the one a slot holds, so it cannot be sold while worn.
 */
export function sellGradedItemFor(ctx: Ctx, args: { itemId: string; copyId: bigint }, deps: GradeSaleDeps) {
  deps.requireControllingPlayer(ctx);
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const itemId = canonicalItemId(args.itemId), price = gradeShopSalePrice(itemId);
  if (!itemId || price === undefined) throw new SenderError("The Smith does not buy that.");
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress || !deps.inventoryForProgress(progress).includes(itemId)) throw new SenderError("That item is not in your inventory.");
  if (args.copyId === 0n && worn(progress, itemId)) throw new SenderError("Take it off before selling it.");
  if (equipmentLocked(ctx, ctx.sender, itemId, args.copyId)) throw new SenderError("Unlock this equipment before selling it.");
  deps.removeCopy(ctx, itemId, args.copyId);
  addGold(ctx, ctx.sender, price);
}

/** The sell_graded_item reducer. */
export function registerGradeSale(spacetimedb: typeof spacetimedbType, deps: GradeSaleDeps) {
  const sellGradedItem = spacetimedb.reducer({ itemId: t.string(), copyId: t.u64() },
    (ctx: any, args: { itemId: string; copyId: bigint }) => sellGradedItemFor(ctx, args, deps));
  return { sellGradedItem };
}
