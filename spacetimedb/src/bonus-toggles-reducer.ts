import { t, SenderError } from "spacetimedb/server";
import type spacetimedbType from "./index";
import { parseBonusOff, serializeBonusOff } from "../../shared/bonus-toggles";
import { attackIntervalUnderNewCap } from "../../shared/stat-rating";
import { bonusOffFor } from "./bonus-toggles";
import { attackCapInPlay } from "./prestige";
import { challengeActive } from "./prestige-challenge";
import { updateSnapshotRow } from "./snapshot-row-writes";
import { readPlayerProgress } from "./wide-stats";

export type BonusToggleDeps = {
  requireControllingPlayer: (ctx: any) => any;
  activeDuelFor: (ctx: any, identity: any) => unknown;
  /** Saved range and movement speed, which bake in research and Long Shot (player-speed.ts). */
  refreshPerkEffects: (ctx: any, player: any) => void;
};

/** The attack speed cap the player's bonuses in play give (Reflect Only wins and Quick Draw). */
const attackCapNow = (ctx: any) => attackCapInPlay(ctx, ctx.sender);

/** `offText`: the item ids to have off, comma separated (shared/bonus-toggles.ts); unknown ids are ignored. */
export function setBonusToggles(ctx: any, offText: string, deps: BonusToggleDeps) {
  const player = deps.requireControllingPlayer(ctx);
  if (challengeActive(ctx, ctx.sender)) throw new SenderError("Bonuses can't be switched during a challenge.");
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel before switching bonuses.");
  const off = serializeBonusOff(parseBonusOff(offText));
  if (off === serializeBonusOff(bonusOffFor(ctx, ctx.sender))) return;
  const capBefore = attackCapNow(ctx);
  const existing = ctx.db.playerBonusToggle.identity.find(ctx.sender);
  if (!off) { if (existing) ctx.db.playerBonusToggle.identity.delete(ctx.sender); }
  else if (existing) ctx.db.playerBonusToggle.identity.update({ identity: ctx.sender, off });
  else ctx.db.playerBonusToggle.insert({ identity: ctx.sender, off });
  // The attack speed cap may have moved (Quick Draw, Reflect Only wins): the run keeps its rating, as a respec does.
  const capAfter = attackCapNow(ctx);
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (progress) {
    const attackRate = attackIntervalUnderNewCap(progress.attackRate, capBefore, capAfter);
    if (attackRate !== progress.attackRate) updateSnapshotRow(ctx, "playerProgress", { ...progress, attackRate });
  }
  deps.refreshPerkEffects(ctx, player);
}

export function registerBonusToggleReducers(spacetimedb: typeof spacetimedbType, deps: BonusToggleDeps) {
  const setBonusToggleState = spacetimedb.reducer({ off: t.string() }, (ctx, { off }) => { setBonusToggles(ctx, off, deps); });
  return { setBonusToggleState };
}
