import { describe, expect, it } from 'vitest';
import { createGrowthPlanner, PLAN_SECONDS, type GrowthContext } from './auto-farm-growth';
import { armorRule } from './forecast-inputs';
import type { ForecastBuild, ForecastMap, ForecastSite } from './growth-forecast';
import type { EnemyDefinition } from '../../enemies';
import type { RewardType } from '../../../../shared/enemy-definitions';
import { preparePlayerPowerStats, type PlayerPowerStats } from '../../../../shared/player-power';

const enemy = (overrides: Partial<EnemyDefinition> & { reward: { type: RewardType; amount: number } }): EnemyDefinition =>
  ({ hp: 100, speed: 200, damage: 2, attackSpeed: 1, r: 20, color: '#000', outline: '#000', ...overrides });
const camp = (group: RewardType, x: number, y: number, count: number, definition: EnemyDefinition, firstId = 0): ForecastSite[] =>
  Array.from({ length: count }, (_, index) => ({ id: firstId + index, x: x + index * 150, y, campName: `${group}`, leashRange: 420,
    definition, group: `stat:${group}`, reward: definition.reward, respawnIn: 0 }));
const map = (mapId: string, sites: ForecastSite[]): ForecastMap => ({ mapId, sites, arrival: { x: 300, y: 300 }, respawnSeconds: 10, hitAfterArmor: armorRule(false) });
function build(stats: Partial<PlayerPowerStats> = {}): ForecastBuild {
  const base: PlayerPowerStats = { damage: 50, maxHp: 800, attackRate: .5, armor: 0, regen: 10, ...stats };
  return { base, effective: preparePlayerPowerStats({ ...base }, null), rewardMultiplier: 1, minAttackInterval: .1, criticalChance: 0, criticalMultiplier: 1.05,
    projectileCount: 1, melee: false, reach: 200, projectileSpeed: 1_000, doubleStrike: 0, splitShot: 0, reflect: 0, secondWind: 0, moveSpeed: 200 };
}
const here = map('here', [
  ...camp('damage', 800, 800, 6, enemy({ hp: 200, reward: { type: 'damage', amount: 1 } })),
  ...camp('health', 800, 1_400, 6, enemy({ hp: 200, reward: { type: 'health', amount: 4 } }), 10),
]);
// Tough enough that its kills are all shooting: a quarter more damage there is a quarter more kills, the rise the stat choice looks for.
const richer = map('ahead', camp('damage', 800, 800, 6, enemy({ hp: 1_000, reward: { type: 'damage', amount: 20 } })));
const context = (next: ForecastMap | null = null): GrowthContext => ({ build: build(), current: here, next, previous: null, nextPortal: next ? { x: 300, y: 250 } : null, previousPortal: null });
const doing = () => ({ pull: false, groups: null, position: { x: 300, y: 300 }, health: 1 });

function planned(planner: ReturnType<typeof createGrowthPlanner>, at: number, live: GrowthContext) {
  for (let frame = 0; frame < 400 && !planner.plan('here'); frame++) planner.tick(at, 'here', () => live, doing);
  return planner.plan('here');
}

describe('growth planner', () => {
  it('prices this map and the next, and picks the stat that grows the build', () => {
    const plan = planned(createGrowthPlanner(), 0, context(richer));
    expect(plan).not.toBeNull();
    expect(plan!.current.powerPerMinute).toBeGreaterThan(0);
    expect(plan!.next!.powerPerMinute).toBeGreaterThan(plan!.current.powerPerMinute);
    // Health shows more power a kill here, but damage is what grows the rate.
    expect(plan!.group).toBe('stat:damage');
  });

  it('spreads its work over frames', () => {
    const planner = createGrowthPlanner();
    planner.tick(0, 'here', () => context(richer), doing);
    expect(planner.plan('here')).toBeNull();
  });

  it('corrects its kill forecast by what it measures', () => {
    const planner = createGrowthPlanner();
    planned(planner, 0, context());
    // Two minutes on the map with no kills at all, then the next plan.
    for (let second = 0; second < 120; second++) planner.observe(second * 1_000, 'here', 1, 0, 0);
    for (let frame = 0; frame < 400; frame++) planner.tick(PLAN_SECONDS * 1_000 + 1, 'here', () => context(), doing);
    expect(planner.calibration().damage).toBeLessThan(1);
  });
});

describe('growth planner calibration', () => {
  it('leaves the damage-taken correction alone where the forecast sees no hit, and moves it toward the measured where it does', () => {
    const harmless = map('here', camp('damage', 800, 800, 6, enemy({ hp: 200, reward: { type: 'damage', amount: 1 } })).map(site => ({ ...site, respawnIn: 10_000 })));
    const quiet: GrowthContext = { build: build(), current: harmless, next: null, previous: null, nextPortal: null, previousPortal: null };
    const planner = createGrowthPlanner();
    for (let frame = 0; frame < 400 && !planner.plan('here'); frame++) planner.tick(0, 'here', () => quiet, doing);
    // Every enemy dead for longer than a plan looks ahead, so the forecast sees no hit: hurt by something it does not know of, no factor on its zero would forecast that.
    for (let second = 1; second <= 120; second++) planner.observe(second * 1_000, 'here', 1, 1, 50);
    for (let frame = 0; frame < 400; frame++) planner.tick(PLAN_SECONDS * 1_000 * 7, 'here', () => quiet, doing);
    expect(planner.calibration().incoming).toBe(1);

    // Where it forecasts hits, twice its damage measured raises the correction, by no more than a step a plan.
    const biting = createGrowthPlanner();
    for (let frame = 0; frame < 400 && !biting.plan('here'); frame++) biting.tick(0, 'here', () => context(), doing);
    const forecast = biting.plan('here')?.doing?.damagePerMinute ?? 0;
    expect(forecast).toBeGreaterThan(0);
    for (let second = 1; second <= 120; second++) biting.observe(second * 1_000, 'here', 1, 0, forecast * 2 / 60);
    for (let frame = 0; frame < 400; frame++) biting.tick(PLAN_SECONDS * 1_000 * 7, 'here', () => context(), doing);
    expect(biting.calibration().incoming).toBeCloseTo(1.3, 9);
  });
});

describe('growth planner kill correction', () => {
  it('leaves the damage correction alone where kills are held back by something else', () => {
    // Two weak enemies that respawn slowly: kills wait on the respawns, whatever the damage.
    const sparse: ForecastMap = { ...map('here', camp('damage', 500, 300, 2, enemy({ hp: 20, reward: { type: 'damage', amount: 1 } }))), respawnSeconds: 600 };
    const live: GrowthContext = { build: build(), current: sparse, next: null, previous: null, nextPortal: null, previousPortal: null };
    const planner = createGrowthPlanner();
    for (let frame = 0; frame < 400 && !planner.plan('here'); frame++) planner.tick(0, 'here', () => live, doing);
    expect(planner.plan('here')!.doing!.killResponse).toBeLessThan(.25);
    for (let second = 1; second <= 120; second++) planner.observe(second * 1_000, 'here', 1, 1, 0);
    for (let frame = 0; frame < 400; frame++) planner.tick(PLAN_SECONDS * 1_000 * 7, 'here', () => live, doing);
    expect(planner.calibration().damage).toBe(1);
  });
});
