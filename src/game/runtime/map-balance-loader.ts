import type { MapBalanceSnapshot } from '../../../shared/map-balance-types';
import { installMapBalance } from '../../../shared/map-balance-runtime';
import { installBossRuleValues } from '../../../shared/rules';
import { ENEMY_TYPES, type EnemyKind } from '../../../shared/enemy-definitions';
import { ENEMY_HIT_RADIUS } from '../../../shared/enemy-hitbox';
import { BOSS_DAMAGE_PROFILES } from '../../../shared/boss-damage';
import { useCurveArmor } from '../combat';
import { recordConnectionDiagnostic } from '../../coop/services/connection-diagnostic-runtime';
export function applyMapBalance(snapshot: MapBalanceSnapshot) {
  if (snapshot.schema !== 1) throw new Error('Unsupported map balance. Update WildStat.');
  installMapBalance(snapshot);
  // A snapshot pinned before 0.901.66 still carries each enemy's old hitbox: every one is ENEMY_HIT_RADIUS now.
  for (const [kind, row] of Object.entries(snapshot.enemies)) if (Object.prototype.hasOwnProperty.call(ENEMY_TYPES, kind)) Object.assign(ENEMY_TYPES[kind as EnemyKind], { regen: 0, armor: 0 }, row, { r: ENEMY_HIT_RADIUS });
  installBossRuleValues(snapshot.rules);
  useCurveArmor(snapshot.rules.ARMOR_CURVE === 1);
  if (snapshot.boss && Object.prototype.hasOwnProperty.call(BOSS_DAMAGE_PROFILES, snapshot.boss.kind)) {
    Object.assign(BOSS_DAMAGE_PROFILES[snapshot.boss.kind as keyof typeof BOSS_DAMAGE_PROFILES], snapshot.boss.attacks);
  }
}
/** Coalesces frame-by-frame loading checks; never installs a stale response. */
export function createMapBalanceLoader(options: { identity: () => string; mapId: () => string; fetch: (mapId: string) => Promise<MapBalanceSnapshot>; changed: (snapshot: MapBalanceSnapshot) => void }) {
  let readyKey = '', pendingKey = '', generation = 0, retryAt = 0;
  let pending: Promise<void> | null = null;
  const keyFor = (mapId: string) => `${options.identity()}:${mapId}`;
  return {
    ready(mapId: string) { return readyKey === keyFor(mapId); },
    reset() { generation++; readyKey = ''; pendingKey = ''; pending = null; retryAt = 0; installMapBalance(null); },
    async ensure(mapId: string) {
      if (!options.identity() || options.mapId() !== mapId) return;
      const key = keyFor(mapId);
      if (readyKey === key) return;
      if (pendingKey === key && pending) return pending;
      if (Date.now() < retryAt) throw new Error('Retrying map balance.');
      const attempt = ++generation;
      pendingKey = key;
      let timeout: ReturnType<typeof setTimeout> | undefined, timedOut = false;
      // Installs a reply while the player is still on this map with it unloaded; true when it did.
      const install = (snapshot: MapBalanceSnapshot) => {
        if (readyKey === key || options.mapId() !== mapId || keyFor(mapId) !== key) return false;
        if (snapshot.mapId !== mapId) throw new Error('Wrong map balance response.');
        applyMapBalance(snapshot); readyKey = key; retryAt = 0; options.changed(snapshot);
        return true;
      };
      const request = options.fetch(mapId);
      // A reply that lands after the timeout is still this map's: the world waits frozen on it, so take it
      // rather than start over. Thrown away, a server slower than 12 s never let the player move.
      void request.then(snapshot => { if (timedOut) install(snapshot); }).catch(() => {});
      pending = Promise.race([request, new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => { timedOut = true; reject(new Error('Map balance timed out. Retrying…')); }, 12_000);
      })]).then(snapshot => {
        if (attempt !== generation) return;
        install(snapshot);
      }).catch(error => {
        if (attempt === generation) {
          retryAt = Date.now() + 1500;
          recordConnectionDiagnostic('map-retry', { mapId, detail: `map balance: ${error instanceof Error ? error.message : 'failed'}` });
        }
        throw error;
      })
        .finally(() => { clearTimeout(timeout); if (attempt === generation) { pendingKey = ''; pending = null; } });
      return pending;
    },
  };
}
