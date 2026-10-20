import type { EnemyState } from '../types';

/** Only actual attackers of this player interrupt farming, never another player's fight. */
export function isEnemyAttackingPlayer(enemy: EnemyState, localIdentity = 'local-player') {
  return !enemy.dead && enemy.hp > 0 && !enemy.remoteCombatGhost && enemy.engaged && !enemy.leashing
    && (!enemy.aggroTargetId || enemy.aggroTargetId === localIdentity);
}

/** Every enemy attacking this player now, generated bosses aside: the chasers a fight is weighed by. */
export function listChasers(enemies: readonly EnemyState[], localIdentity = 'local-player') {
  return enemies.filter(enemy => !enemy.generatedBoss && isEnemyAttackingPlayer(enemy, localIdentity));
}
