import { describe, expect, it } from 'vitest';
import { createVirtualPlayer } from './virtual-player';
import { BASIC_PAPER_HAT, STARTER_STONE } from '../../../../../shared/items';
import { DEFAULT_ATTACK_INTERVAL, PLAYER_BASE_DAMAGE, PLAYER_BASE_HP, PLAYER_BASE_REGEN } from '../../../../../shared/rules';

describe('autofarm virtual player', () => {
  it('farms the Forest headlessly: kills, grows and keeps its clocks to itself', async () => {
    const before = Date.now();
    const player = createVirtualPlayer({ name: 'smoke', seed: 1, startMap: 'tutorial_forest', highestUnlocked: 0, weapon: 'starter_bow',
      push: 'normal', advance: false, base: { damage: PLAYER_BASE_DAMAGE, maxHp: PLAYER_BASE_HP, armor: 0, regen: PLAYER_BASE_REGEN, attackRate: DEFAULT_ATTACK_INTERVAL } });
    try {
      const report = await player.run(90);
      expect(report.kills).toBeGreaterThan(0);
      expect(report.endPower).toBeGreaterThan(report.startPower);
      expect(report.activity.fight).toBeGreaterThan(0);
    } finally { player.dispose(); }
    expect(Math.abs(Date.now() - before)).toBeLessThan(60_000);
  }, 30_000);

  it('earns Mastery and gold from its kills and buys the Smith\'s next grades with them', async () => {
    const player = createVirtualPlayer({ name: 'smith', seed: 2, startMap: 'tutorial_forest', highestUnlocked: 0, weapon: STARTER_STONE, head: BASIC_PAPER_HAT,
      gold: 340, masteryPoints: { archery: 10 },
      push: 'normal', advance: false, base: { damage: PLAYER_BASE_DAMAGE, maxHp: PLAYER_BASE_HP, armor: 0, regen: PLAYER_BASE_REGEN, attackRate: DEFAULT_ATTACK_INTERVAL } });
    try {
      const report = await player.run(90);
      expect(report.purchases.map(entry => entry.itemId)).toEqual(['common_bow', 'common_light_armor', 'common_light_helmet']);
      expect(report.masteryPoints.archery).toBe(10 + report.kills);
      expect(report.gold).toBeGreaterThanOrEqual(40);
    } finally { player.dispose(); }
  }, 30_000);
});
