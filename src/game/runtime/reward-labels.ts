import type { EnemyDefinition } from "../enemies";
import { attackSpeedGainLabel, type AttackCap, type AttackCapArg } from "../../../shared/stat-rating";
import { critMultiplierGainLabel, type CriticalDamageParts } from "../../../shared/critical-damage";
import { soulAttackSpeedBonus, type SoulStatId } from "../../../shared/soul-dimension";

/**
 * Attack speed and crit damage pay ratings, numbers players can't read, worth less as they near the cap.
 * Wherever a reward is shown (the label under an enemy, the map's Enemy Index) these say what one kill
 * gives this player now instead: "+0.004/s", "+0.08×", or "Capped".
 */
export type RewardLabelContext = {
  attackCap: AttackCapArg;
  /** The run's own attack interval, without the soul's attacks a second. */
  runAttackInterval: number;
  /** The soul's attack speed rating in play (soulAttackSpeedBonus reads it). */
  soulAttackSpeed: number;
  critParts: CriticalDamageParts;
  /** What each soul kill pays now, the Soul Level's doubling. */
  soulRewardMultiplier?: number;
};

/** A kill's amount as shown now: attacks a second or the crit multiplier; null for the other stats. */
export function liveRewardText(reward: Pick<EnemyDefinition["reward"], "type" | "amount">, context: RewardLabelContext | null | undefined) {
  if (!context) return null;
  if (reward.type === "speed") return attackSpeedGainLabel(context.runAttackInterval, reward.amount, context.attackCap, soulAttackSpeedBonus(context.soulAttackSpeed));
  if (reward.type === "crit") return critMultiplierGainLabel(context.critParts, reward.amount);
  return null;
}

/** Whether a soul attack speed or crit kill gives nothing now: the player is at that cap. */
export function soulRewardCapped(stat: SoulStatId, context: RewardLabelContext | null | undefined) {
  if (!context) return false;
  if (stat === "attackSpeed") return attackSpeedGainLabel(context.runAttackInterval, 0, context.attackCap, soulAttackSpeedBonus(context.soulAttackSpeed)) === "Capped";
  if (stat === "critDamage") return critMultiplierGainLabel(context.critParts, 0) === "Capped";
  return false;
}

type LabelSource = {
  coop: () => { attackCapInPlay?: () => AttackCap; savedProgress?: () => { attackRate: number } | null } | null | undefined;
  player: { attackRate: number; critRating?: number };
  soul: { inPlay: () => { attackSpeed: number }; critDamage: () => number; rewardMultiplier?: () => number };
  critParts: () => CriticalDamageParts;
};

/** The context from the game's own objects, so the composition root wires it in one line. */
export function rewardLabelContextFrom(source: LabelSource): () => RewardLabelContext {
  return () => {
    const coop = source.coop();
    return {
      attackCap: coop?.attackCapInPlay?.(),
      runAttackInterval: coop?.savedProgress?.()?.attackRate ?? source.player.attackRate,
      soulAttackSpeed: source.soul.inPlay().attackSpeed,
      critParts: { ...source.critParts(), soul: source.soul.critDamage(), rating: source.player.critRating },
      soulRewardMultiplier: source.soul.rewardMultiplier?.() ?? 1,
    };
  };
}
