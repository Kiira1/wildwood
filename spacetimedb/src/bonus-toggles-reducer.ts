import { t, SenderError } from "spacetimedb/server";
import type spacetimedbType from "./index";
import { bonusToggleRow, allBonusesOn, type BonusToggles } from "../../shared/bonus-toggles";
import { playerAttackCap } from "../../shared/prestige-perks";
import { attackIntervalUnderNewCap } from "../../shared/stat-rating";
import { bonusTogglesFor } from "./bonus-toggles";
import { prestigePerkRanks } from "./prestige";
import { challengeActive, reflectRewardsInPlay } from "./prestige-challenge";
import { updateSnapshotRow } from "./snapshot-row-writes";
import { readPlayerProgress } from "./wide-stats";

export type BonusToggleDeps = {
  requireControllingPlayer: (ctx: any) => any;
  activeDuelFor: (ctx: any, identity: any) => unknown;
  /** Saved range and movement speed, which bake in research and Long Shot (player-speed.ts). */
  refreshPerkEffects: (ctx: any, player: any) => void;
};

/** The attack speed cap the player's bonuses in play give (Reflect Only wins and Quick Draw). */
const attackCapNow = (ctx: any) => playerAttackCap(reflectRewardsInPlay(ctx, ctx.sender), prestigePerkRanks(ctx, ctx.sender));

export function setBonusToggles(ctx: any, toggles: BonusToggles, deps: BonusToggleDeps) {
  const player = deps.requireControllingPlayer(ctx);
  if (challengeActive(ctx, ctx.sender)) throw new SenderError("Bonuses can't be switched during a challenge.");
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel before switching bonuses.");
  const before = bonusTogglesFor(ctx, ctx.sender);
  if ((Object.keys(toggles) as (keyof BonusToggles)[]).every(id => toggles[id] === before[id])) return;
  const capBefore = attackCapNow(ctx);
  const existing = ctx.db.playerBonusToggle.identity.find(ctx.sender);
  if (allBonusesOn(toggles)) { if (existing) ctx.db.playerBonusToggle.identity.delete(ctx.sender); }
  else if (existing) ctx.db.playerBonusToggle.identity.update({ identity: ctx.sender, ...bonusToggleRow(toggles) });
  else ctx.db.playerBonusToggle.insert({ identity: ctx.sender, ...bonusToggleRow(toggles) });
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
  const setBonusToggleState = spacetimedb.reducer({ prestige: t.bool(), challenge: t.bool(), research: t.bool(), soul: t.bool() },
    (ctx, toggles) => { setBonusToggles(ctx, toggles, deps); });
  return { setBonusToggleState };
}
