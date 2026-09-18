import { it, expect } from 'vitest';
import { resolveMapBalance, defaultBalanceSettings } from '../../../shared/map-balance';
import { generateMap } from '../../../shared/procedural-maps';
import { generatedEnemyArt } from '../../../shared/procedural-enemy-art';
import { refreshMapBalanceEnemies } from './map-balance-enemies';
it('refreshes a preloaded Endless spawn and preserves live damage and dead corpses', () => {
  const settings = defaultBalanceSettings(); settings.maps.endless.enemyHealth = 2;
  const snapshot = resolveMapBalance('endless_3', settings, 2), map = generateMap('endless_3');
  const site = { id: 0, type: generatedEnemyArt('endless_3') } as any;
  const alive = { siteId: 0, hp: 50, maxHp: 100 } as any, dead = { siteId: 0, dead: true, hp: 0, maxHp: 100 } as any;
  refreshMapBalanceEnemies(snapshot, [site], [alive, dead]);
  expect(alive.maxHp).toBe(snapshot.lanes[map.camps[0].lane].hp);
  expect(alive.hp).toBe(alive.maxHp / 2);
  expect(alive.reward).toEqual(site.definition.reward);
  expect(dead.maxHp).toBe(100);
});
