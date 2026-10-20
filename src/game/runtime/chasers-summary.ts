import { damageAfterArmor } from '../../../shared/combat';
import { PLAYER_RADIUS } from '../../../shared/rules';
import { ENEMY_TYPES } from '../enemies';
import { chaseDamage, type ChaserThreat } from './auto-farm/auto-farm-kite-model';
import type { EnemyState } from './types';

/** One chaser as the kite model reads it: its blow after the player's armor, how often it can land one, its health and size. */
export function chaserThreat(enemy: EnemyState, armor: number, hitAfterArmor = damageAfterArmor): ChaserThreat {
  const definition = enemy.definition ?? ENEMY_TYPES[enemy.type];
  return { damage: hitAfterArmor(enemy.damage, armor), raw: enemy.damage, attackSpeed: definition?.attackSpeed ?? 0, hp: enemy.hp, r: enemy.r };
}

/**
 * What the chasers on the player cost while it stands: melee ones by the kite model (chaseDamage, as many as
 * fit round the player), ranged ones each at its own rate. Net health is regen less the damage taken.
 */
export function chasersSummary(chasers: readonly EnemyState[], stats: { armor: number; regenPerSecond: number },
  options: { playerR?: number; hitAfterArmor?: (damage: number, armor: number) => number } = {}) {
  const ranged = (enemy: EnemyState) => Boolean((enemy.definition ?? ENEMY_TYPES[enemy.type])?.ranged);
  const threat = (enemy: EnemyState) => chaserThreat(enemy, stats.armor, options.hitAfterArmor);
  const melee = chaseDamage({ chasers: chasers.filter(enemy => !ranged(enemy)).map(threat), speed: 1, chaseSpeed: 1,
    playerR: options.playerR ?? PLAYER_RADIUS, holds: true });
  const shooters = chasers.filter(ranged).map(threat);
  const damagePerSecond = melee.standing + shooters.reduce((sum, shooter) => sum + shooter.damage * shooter.attackSpeed, 0);
  const hitsPerSecond = melee.standingHits + shooters.reduce((sum, shooter) => sum + shooter.attackSpeed, 0);
  return { count: chasers.length, damagePerSecond, hitsPerSecond, netHealthPerSecond: stats.regenPerSecond - damagePerSecond };
}
