import { table, t } from "spacetimedb/server";
import { bonusTogglesFromRow, type BonusToggles } from "../../shared/bonus-toggles";

/**
 * The bonus groups a player switched off (shared/bonus-toggles.ts). No row is everything on; a row
 * that comes back all on is deleted. Public: a profile shows whose numbers leave bonuses out.
 */
export const playerBonusToggle = table({ name: "player_bonus_toggle", public: true }, {
  identity: t.identity().primaryKey(),
  prestigeOff: t.bool(), challengeOff: t.bool(), researchOff: t.bool(), soulOff: t.bool(),
});

export function bonusTogglesFor(ctx: any, identity: any): BonusToggles {
  return bonusTogglesFromRow(identity ? ctx.db.playerBonusToggle?.identity.find(identity) : null);
}

/**
 * The research row combat and farming read: none while Research is switched off. Spending, timers
 * (offline window, upgrade speed) and account moves read the stored row.
 */
export function researchInPlay(ctx: any, identity: any) {
  return bonusTogglesFor(ctx, identity).research ? ctx.db.playerResearch.identity.find(identity) : undefined;
}
