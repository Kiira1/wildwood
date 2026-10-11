import { table, t } from "spacetimedb/server";
import { parseBonusOff, researchInPlayFor, type BonusOff } from "../../shared/bonus-toggles";

/**
 * The bonuses a player switched off (shared/bonus-toggles.ts), as item ids. No row is everything on;
 * a row that comes back all on is deleted. Public: a profile can show whose numbers leave bonuses out.
 */
export const playerBonusToggle = table({ name: "player_bonus_toggle", public: true }, {
  identity: t.identity().primaryKey(),
  off: t.string(),
});

const NONE: BonusOff = new Set();
export function bonusOffFor(ctx: any, identity: any): BonusOff {
  const row = identity ? ctx.db.playerBonusToggle?.identity.find(identity) : null;
  return row ? parseBonusOff(row.off) : NONE;
}

/**
 * The research row combat and farming read: each switched-off research at rank zero. Spending, timers
 * (offline window, upgrade speed) and account moves read the stored row.
 */
export function researchInPlay(ctx: any, identity: any) {
  return researchInPlayFor(ctx.db.playerResearch.identity.find(identity), bonusOffFor(ctx, identity)) ?? undefined;
}
