import { describe, expect, it } from 'vitest';
import { bossReadiness } from './boss-readiness';
import { resolveMapBalance } from '../../../../shared/map-balance';
import { LIVE_BALANCE } from '../../../balance/live-balance';

const fresh = { maxHp: 100, damage: 3.15, attackRate: 1.56, armor: 0, regen: .2 };
const dragon = resolveMapBalance('tutorial_forest', LIVE_BALANCE.settings, LIVE_BALANCE.revision).boss;

describe('boss readiness', () => {
  it('plays the fight out: a fresh character loses to the dragon, a far stronger one wins, a map with no boss has no answer', () => {
    expect(bossReadiness('tutorial_forest', dragon, fresh)).toMatchObject({ ready: false });
    expect(bossReadiness('tutorial_forest', dragon, { ...fresh, damage: 500, maxHp: 50_000 })).toEqual({ ready: true, needs: null });
    expect(bossReadiness('tutorial_forest', null, fresh)).toBeNull();
  });

  it('says which would win it: a sturdy build that hits softly needs damage, a hard hitter that dies needs health', () => {
    expect(bossReadiness('tutorial_forest', dragon, { ...fresh, damage: 30, maxHp: 1_500 })?.needs).toBe('damage');
    expect(bossReadiness('tutorial_forest', dragon, { ...fresh, damage: 800, maxHp: 60 })?.needs).toBe('health');
  });

  it('asks Fight At times as much: a build that just wins loses to a boss ten times as strong', () => {
    const strong = { ...fresh, damage: 50, maxHp: 5_000 };
    expect(bossReadiness('tutorial_forest', dragon, strong)?.ready).toBe(true);
    expect(bossReadiness('tutorial_forest', dragon, strong, 10)?.ready).toBe(false);
  });
});
