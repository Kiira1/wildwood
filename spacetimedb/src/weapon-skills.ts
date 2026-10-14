import type { Identity } from "spacetimedb";
import type { InferSchema, ReducerCtx } from "spacetimedb/server";
import type spacetimedb from "./index";
import { isSkillSword } from "../../shared/sword-skills";
import { bowSkillRollFor, ensureBowSkillRoll } from "./bow-skills";
import { ensureSwordSkillRoll, swordSkillRollFor } from "./sword-skills";

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
export const weaponSkillRollFor = (ctx: Ctx, identity: Identity, itemId: string) =>
  isSkillSword(itemId) ? swordSkillRollFor(ctx, identity, itemId) : bowSkillRollFor(ctx, identity, itemId);
export function ensureWeaponSkillRoll(ctx: Ctx, identity: Identity, itemId: string) {
  if (isSkillSword(itemId)) ensureSwordSkillRoll(ctx, identity, itemId);
  else ensureBowSkillRoll(ctx, identity, itemId);
}
export function ensureWeaponSkillRolls(ctx: Ctx, identity: Identity, itemIds: Iterable<string>) {
  for (const itemId of new Set(itemIds)) ensureWeaponSkillRoll(ctx, identity, itemId);
}
