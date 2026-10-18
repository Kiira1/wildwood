import { describe, expect, it } from 'vitest';
import { createAutoFarmProgress, createFarmEvaluator } from './auto-farm-build';
import { MAP_IDS } from '../../../../shared/rules';
import { unroundedPlayerPower } from '../../../../shared/player-power';

const deps = {
  base: () => ({ maxHp: 1_000, damage: 100, armor: 0, regen: 0, attackRate: 1 }),
  equipment: () => ({ equippedHead: '', equippedChest: '', equippedRightHand: '', equippedLeftHand: '' }) as never,
  research: () => null, upgradeLevel: () => 0, rewardMultiplier: () => 1, minAttackInterval: () => .2,
  criticalChance: () => 0, criticalMultiplier: () => 1,
};

describe('autofarm build', () => {
  it("prices a kill's reward as the power the profile shows, and attack speed only up to its cap", () => {
    const farm = createFarmEvaluator(deps);
    expect(farm.evaluate().power).toBeCloseTo(unroundedPlayerPower(deps.base()));
    expect(farm.evaluate({ type: 'health', amount: 50 }).power).toBeCloseTo(farm.evaluate().power + 50);
    const capped = createFarmEvaluator({ ...deps, base: () => ({ ...deps.base(), attackRate: .2 }) });
    expect(capped.evaluate({ type: 'speed', amount: 1 }).power).toBeCloseTo(capped.evaluate().power);
    expect(createFarmEvaluator({ ...deps, criticalChance: () => .5, criticalMultiplier: () => 3 }).dps()).toBeCloseTo(200);
  });

  function progress(mapId: string, extra: Partial<Parameters<typeof createAutoFarmProgress>[0]> = {}) {
    return createAutoFarmProgress({ ...deps, mapId: () => mapId, mapBoss: () => null, reflectOnly: () => false,
      portals: () => [{ x: 900, y: 900, height: 200, destination: MAP_IDS[MAP_IDS.indexOf(mapId) + 1] ?? 'endless_2' }] as never, portalUnlocked: () => true, ...extra });
  }

  it('offers any unlocked portal forward, however strong the build: trying it is the measurement', () => {
    expect(progress(MAP_IDS[0]).nextPortal()).toMatchObject({ destination: MAP_IDS[1] });
    expect(progress(MAP_IDS[0], { portalUnlocked: () => false }).nextPortal()).toBeNull();
    expect(progress(MAP_IDS[0], { portalUnlocked: () => false }).bossUnlocksNext()).toBe(true);
  });

  it("gives the boss's real health, and nothing once it is down", () => {
    const boss = { x: 0, y: 0, r: 80, hp: 40, maxHp: 100 };
    expect(progress(MAP_IDS[0], { mapBoss: () => boss }).mapBoss()).toMatchObject({ hp: 40, maxHp: 100 });
    expect(progress(MAP_IDS[0], { mapBoss: () => ({ ...boss, dead: true }) }).mapBoss()).toBeNull();
  });

  it("prices a staff's slower casts for readiness: a bow's boss win is not the staff's, and Meteor adds back", () => {
    const boss = { kind: 'dragon', hp: 1_000, respawnSeconds: 60, damage: 1, attacks: {}, rewards: {} };
    const balance = { schema: 1, revision: 1, mapId: MAP_IDS[0], enemies: {}, lanes: {}, rules: {}, boss } as never;
    // 100 damage a second kills 1,000 health in 10 s, 20 s stretched: the dragon's regeneration is what a slower weapon loses to.
    const wielding = (weapon: string, extra = {}) => progress(MAP_IDS[0], { fetchBalance: () => balance, ...extra,
      equipment: () => ({ equippedHead: '', equippedChest: '', equippedRightHand: weapon, equippedLeftHand: '' }) as never,
      base: () => ({ maxHp: 1_000, damage: 1.5, armor: 0, regen: 0, attackRate: 1 }) });
    const ready = (weapon: string, extra = {}) => {
      for (let margin = .05; margin < 20; margin *= 1.05) if (!wielding(weapon, extra).bossReady!(margin)?.ready) return margin;
      return Infinity;
    };
    const bow = ready('starter_bow'), staff = ready('forest_staff');
    expect(staff).toBeLessThan(bow * .9);
    expect(ready('forest_staff', { weaponSkills: () => ({ meteor: 10 }) })).toBeGreaterThan(staff);
  });
});
