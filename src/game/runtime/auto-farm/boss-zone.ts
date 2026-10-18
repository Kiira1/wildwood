import * as C from '../../constants';
import { bossForMap, type BossKind } from '../boss/boss-registry';
import { PROCEDURAL_BOSS_ENGAGE_RANGE } from '../boss/procedural-boss-controller';
import { isProceduralMap } from '../../../../shared/procedural-maps';

/** How close to its centre each boss starts attacking a player (boss-controller.ts). */
const AGGRO_RANGES: Record<BossKind, number> = {
  dragon: C.BOSS_AGGRO_RANGE, spider: C.SPIDER_AGGRO_RANGE, frostclaw: C.FROSTCLAW_AGGRO_RANGE, magmalisk: C.MAGMALISK_AGGRO_RANGE,
  gloomroot: C.GLOOMROOT_AGGRO_RANGE, tidewyrm: C.TIDEWYRM_AGGRO_RANGE, koiShogun: C.KOI_SHOGUN_AGGRO_RANGE, tempestKirin: C.TEMPEST_KIRIN_AGGRO_RANGE,
  miremaw: C.MIREMAW_AGGRO_RANGE, prismshell: C.PRISMSHELL_AGGRO_RANGE, ironhorn: C.IRONHORN_AGGRO_RANGE, dreadreaper: C.DREADREAPER_AGGRO_RANGE,
  voltwarden: C.VOLTWARDEN_AGGRO_RANGE, gravebloom: C.GRAVEBLOOM_AGGRO_RANGE, aegisPrime: C.AEGIS_PRIME_AGGRO_RANGE,
};

/** Kept clear of a boss's range so a step or a chase does not cross it. */
export const BOSS_ZONE_PAD = 60;

/** The distance from a map's boss within which it attacks; null on a map without one. */
export function bossAggroRange(mapId: string): number | null {
  if (isProceduralMap(mapId)) return PROCEDURAL_BOSS_ENGAGE_RANGE;
  const boss = bossForMap(mapId);
  return boss ? AGGRO_RANGES[boss.kind] : null;
}
