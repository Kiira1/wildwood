import { bossAttacker, resolveFight, type Attacker } from '../../../balance/death-model';
import { BOSS_DAMAGE_PROFILES } from '../../../../shared/boss-damage';
import { bossRegenFractionFor } from '../../../../shared/boss-regeneration';
import { damageAfterArmor } from '../../../../shared/combat';
import type { MapBalanceSnapshot } from '../../../../shared/map-balance-types';
import { readinessDps, type Readiness } from '../../../../shared/map-readiness';
import type { PlayerPowerStats } from '../../../../shared/player-power';

/**
 * A boss fight takes this many times as long as damage over its health says: the player walks to it and
 * dodges. The survival check plays it out over that long. Chosen in the autofarm sim over three hours from a
 * fresh character (0.901.65): 1x, 2x and 3x all reached map 4; 2x with the most power and fewest deaths
 * (93k, 171 deaths, against the old power table's 75k and 239).
 */
export const BOSS_FIGHT_STRETCH = { factor: 2 };

/**
 * Whether the build beats this map's boss made `margin` times as strong (Fight At), as the Balance Lab plays a
 * boss fight (death-model.ts): its ability turns at its own rhythm against the build's health and regeneration,
 * nobody dodging, for as long as the build takes to kill it net of its own healing. A single heaviest hit
 * against the health bar was tried first and sent a build with a little armor into fights it died in on repeat.
 * Not ready, it says whether double the damage or double the health would win it. Null with no boss.
 */
export function bossReadiness(mapId: string, boss: MapBalanceSnapshot['boss'] | undefined, stats: PlayerPowerStats, margin = 1): Readiness | null {
  if (!boss || !(boss.hp > 0)) return null;
  const scale = Math.max(1e-6, Number.isFinite(margin) ? margin : 1);
  const strongest = Math.max(boss.damage ?? 0, ...Object.values(boss.attacks ?? {})) * scale;
  const regenFraction = Math.max(0, boss.regenFraction ?? bossRegenFractionFor(mapId));
  const wins = (damageScale: number, healthScale: number) => {
    const hp = boss.hp * scale, net = readinessDps(stats) * damageScale - hp * regenFraction;
    if (!(net > 0)) return false;
    const seconds = hp / net * BOSS_FIGHT_STRETCH.factor;
    const maxHp = stats.maxHp * healthScale;
    const attacker: Attacker = boss.kind in BOSS_DAMAGE_PROFILES
      ? bossAttacker(boss.kind as keyof typeof BOSS_DAMAGE_PROFILES, strongest, stats.armor)
      : { start: 1, interval: 2, hit: damageAfterArmor(strongest, stats.armor) };
    return resolveFight(maxHp, maxHp, stats.regen * healthScale, seconds, [attacker]).diedAt === null;
  };
  if (wins(1, 1)) return { ready: true, needs: null };
  const damage = wins(2, 1), health = wins(1, 2);
  // Either alone would do: damage, which Auto Farm favours. Neither alone: both.
  return { ready: false, needs: damage ? 'damage' : health ? 'health' : 'both' };
}
