import { describe, expect, it } from 'vitest';
import { bossReadiness } from './boss-readiness';
import { resolveMapBalance } from '../../../../shared/map-balance';
import { GAME_BALANCE } from '../../../balance/game-balance';
import { damageAfterArmor } from '../../../../shared/combat';

const fresh = { maxHp: 100, damage: 3.15, attackRate: 1.56, armor: 0, regen: .2 };
const dragon = resolveMapBalance('tutorial_forest', GAME_BALANCE.settings, GAME_BALANCE.revision).boss;

describe('boss readiness', () => {
  it('plays the fight out: a fresh character loses to the dragon, a far stronger one wins, a map with no boss has no answer', () => {
    expect(bossReadiness('tutorial_forest', dragon, fresh)).toMatchObject({ ready: false });
    expect(bossReadiness('tutorial_forest', dragon, { ...fresh, damage: 500, maxHp: 50_000 })).toEqual({ ready: true, needs: null });
    expect(bossReadiness('tutorial_forest', null, fresh)).toBeNull();
  });

  it('says which would win it: a sturdy build that hits softly needs damage, a hard hitter that dies needs health', () => {
    expect(bossReadiness('tutorial_forest', dragon, { ...fresh, damage: 30, maxHp: 37_500 })?.needs).toBe('damage');
    expect(bossReadiness('tutorial_forest', dragon, { ...fresh, damage: 4_000, maxHp: 300 })?.needs).toBe('health');
  });

  it('asks Fight At times as much: a build that just wins loses to a boss ten times as strong', () => {
    const strong = { ...fresh, damage: 250, maxHp: 25_000 };
    expect(bossReadiness('tutorial_forest', dragon, strong)?.ready).toBe(true);
    expect(bossReadiness('tutorial_forest', dragon, strong, 10)?.ready).toBe(false);
  });

  it('plays an Endless boss as it attacks, its pulse every six seconds and a shot of 0.3, not its heaviest hit every two', () => {
    const boss = resolveMapBalance('endless_3', GAME_BALANCE.settings, GAME_BALANCE.revision).boss!;
    expect(boss.kind).toBe('procedural');
    const hit = damageAfterArmor(boss.damage, 0);
    // A minute's fight: it out-heals the real pattern (0.35 of a heavy hit a second), not a heavy hit every two seconds.
    const build = { maxHp: hit * 3, damage: boss.hp / 30, attackRate: 1, armor: 0, regen: hit * .4 };
    expect(bossReadiness('endless_3', boss, build)).toEqual({ ready: true, needs: null });
    expect(bossReadiness('endless_3', boss, { ...build, regen: hit * .25 })?.ready).toBe(false);
  });
});
