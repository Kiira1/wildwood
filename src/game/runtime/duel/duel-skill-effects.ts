import { duelAttackDelays, duelPositionsAt } from "../../../../shared/duel-approach";
import { duelDeflected, duelSwordSkillProc, duelBowSkillProc, type DuelCombat } from "../../../../shared/duel-combat";
import { DEFLECT_RETURN_SPEED, WHIRLWIND_SECONDS, WHIRLWIND_RADIUS, SHOCKWAVE_RADIUS, SHOCKWAVE_SPEED } from "../../../../shared/sword-skills";
import type { SwordSkillEffects } from "../sword-skill-runtime";
import { ARROW_STORM_ARROWS } from "../../../../shared/bow-skills";
import { DUEL_ARENA, DUEL_COMBAT_Y } from "../../duel";
import type { createCombatEffects } from "../combat-effects";

export type DuelSkillEffects = SwordSkillEffects & Pick<ReturnType<typeof createCombatEffects>, "spawnArcingArrow" | "spawnSkillStreak" | "spawnSkillRing">;

/** Emit each proc once, using the same seed and attack number as combat. */
export function showDuelSkillEffects(duel: DuelCombat, from: number, to: number,
  counts: { challengerAttacks: number; opponentAttacks: number }, effects?: DuelSkillEffects) {
  if (!effects || to <= from) return;
  const delays = duelAttackDelays(duel);
  for (const side of ["challenger", "opponent"] as const) {
    const interval = Math.max(.000001, Math.round(duel[`${side}AttackRate`] * 1e6) / 1e6);
    const delay = Math.round(delays[side] * 1e6) / 1e6;
    // Resume without replaying a backlog of old effects after a background tab.
    const start = Math.max(1, Math.floor((Math.max(from, to - .3) - delay) / interval) + 1);
    for (let attack = start; attack <= counts[`${side}Attacks`]; attack++) {
      const at = delay + attack * interval;
      if (at > to + .000001) break;
      const positions = duelPositionsAt(duel, at);
      const sourceX = DUEL_ARENA.x + (side === "challenger" ? positions.challengerX : positions.opponentX);
      const targetX = DUEL_ARENA.x + (side === "challenger" ? positions.opponentX : positions.challengerX);
      const y = DUEL_COMBAT_Y;
      const defender = side === "challenger" ? "opponent" : "challenger";
      if (duelDeflected(duel, defender, attack)) {
        effects.spawnDeflectedShot?.(targetX, y, sourceX, y, Math.max(.04, Math.abs(targetX - sourceX) / DEFLECT_RETURN_SPEED));
        continue;
      }
      if (duelSwordSkillProc(duel, side, attack, "whirlwind")) {
        effects.spawnSwordSpin?.(sourceX, y, WHIRLWIND_RADIUS, WHIRLWIND_SECONDS);
      }
      if (duelSwordSkillProc(duel, side, attack, "shockwave")) {
        effects.spawnSwordWave?.(sourceX, y, targetX, y, SHOCKWAVE_RADIUS, Math.max(.04, Math.abs(targetX - sourceX) / SHOCKWAVE_SPEED));
      }
      if (duelBowSkillProc(duel, side, attack, "arrowStorm")) {
        for (let index = 0; index < ARROW_STORM_ARROWS; index++) effects.spawnArcingArrow(sourceX, y, targetX, y, index, "#ffd957");
      }
      if (duelBowSkillProc(duel, side, attack, "ricochet")) {
        const bounceX = targetX + Math.sign(targetX - sourceX) * 55;
        effects.spawnSkillStreak(targetX, y, bounceX, y - 45, "#8fe3ff", 4, .32, true);
        effects.spawnSkillStreak(bounceX, y - 45, targetX, y, "#8fe3ff", 4, .32, true);
        effects.spawnSkillRing(targetX, y, "#8fe3ff", 20, .26);
      }
      if (duelBowSkillProc(duel, side, attack, "piercingShot")) {
        effects.spawnSkillStreak(sourceX, y, targetX + Math.sign(targetX - sourceX) * 100, y, "#ffc94d", 5, .3);
        effects.spawnSkillRing(targetX, y, "#ffe08a", 22, .24);
      }
    }
  }
}

/** Match the held-sword animation to the most recent active spin, including when seeking a replay. */
export function duelSwordSpinClock(duel: DuelCombat, side: "challenger" | "opponent", elapsed: number, attacks: number) {
  const delay = duelAttackDelays(duel)[side];
  const interval = Math.max(.000001, Math.round(duel[`${side}AttackRate`] * 1e6) / 1e6);
  for (let attack = attacks; attack > 0; attack--) {
    const age = elapsed - (delay + attack * interval);
    if (age >= WHIRLWIND_SECONDS) break;
    if (age >= 0 && duelSwordSkillProc(duel, side, attack, "whirlwind")) return WHIRLWIND_SECONDS - age;
  }
  return 0;
}
