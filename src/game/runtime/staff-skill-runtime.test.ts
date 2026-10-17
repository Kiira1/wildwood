import { expect, it, vi } from "vitest";
import { createStaffSkillRuntime } from "./staff-skill-runtime";
import { createGameBootstrap } from "./game-bootstrap";
import type { EnemyState } from "./types";
import {
  CHAIN_DAMAGE_SHARE, FROST_NOVA_SECONDS, FROST_NOVA_SLOW, METEOR_DAMAGE_SHARE, METEOR_DELAY_SECONDS, METEOR_MAX_TARGETS,
  STAFF_SPLASH_MAX_TARGETS, type StaffSkillRoll,
} from "../../../shared/staff-skills";

function harness(roll: Partial<StaffSkillRoll> = {}) {
  const state = createGameBootstrap();
  Object.assign(state.player, { x: 0, y: 0, hp: 100, maxHp: 100 });
  state.bosses.dragon.dead = true;
  const hit = vi.fn(), effects = { spawnStaffBurst: vi.fn(), spawnMeteor: vi.fn(), spawnFrostNova: vi.fn(), spawnSkillStreak: vi.fn() };
  let now = 0, weapon = "ion_staff";
  const runtime = createStaffSkillRuntime({ player: state.player, enemies: state.enemies, hit, effects,
    currentMapId: () => "map", equippedWeapon: () => weapon, activeBoss: () => state.bosses.dragon,
    roll: () => roll, nowSeconds: () => now, random: () => 0, isDueling: () => false, boltColor: () => "#fff" });
  const enemy = (x: number, y = 0, extra: Partial<EnemyState> = {}) => {
    const target = { x, y, r: 10, hp: 1e6, dead: false, ...extra } as EnemyState;
    state.enemies.push(target); return target;
  };
  return { ...state, runtime, hit, effects, enemy, at: (time: number) => { now = time; runtime.update(); }, bow: () => { weapon = "ion_bow"; } };
}
const struck = (hit: ReturnType<typeof vi.fn>) => hit.mock.calls.map(call => call[0]);

it("bursts on everything around the impact at full damage, nearest first, up to the cap; ghosts and far enemies untouched", () => {
  const f = harness();
  const primary = f.enemy(300), near = f.enemy(340), edge = f.enemy(375), far = f.enemy(400);
  const ghost = f.enemy(310, 0, { remoteCombatGhost: true });
  f.runtime.burst(primary, 300, 0, 50, false, 0, null);
  expect(struck(f.hit)).toEqual([primary, near, edge]);
  expect(f.hit.mock.calls.every(call => call[1] === 50)).toBe(true);
  expect(struck(f.hit)).not.toContain(far);
  expect(struck(f.hit)).not.toContain(ghost);
  expect(f.effects.spawnStaffBurst).toHaveBeenCalledOnce();
  const crowd = harness();
  const first = crowd.enemy(0, 300);
  for (let index = 0; index < 12; index++) crowd.enemy(index * 3, 310);
  crowd.runtime.burst(first, 0, 300, 50, false, 0, null);
  expect(crowd.hit).toHaveBeenCalledTimes(STAFF_SPLASH_MAX_TARGETS);
});

it("chains on to enemies the burst missed, and slows regular enemies near a Frost Nova but never a boss", () => {
  const f = harness();
  const primary = f.enemy(300), splashed = f.enemy(340), next = f.enemy(460), after = f.enemy(590), tooFar = f.enemy(900);
  f.runtime.burst(primary, 300, 0, 100, true, 0, { chain: true, frostNova: false });
  expect(struck(f.hit)).toEqual([primary, splashed, next, after]);
  expect(f.hit.mock.calls.slice(2).every(call => call[1] === 100 * CHAIN_DAMAGE_SHARE && call[2] === true)).toBe(true);
  expect(struck(f.hit)).not.toContain(tooFar);
  const frost = harness();
  const a = frost.enemy(300), b = frost.enemy(380), boss = frost.enemy(320, 0, { generatedBoss: true }), out = frost.enemy(600);
  frost.runtime.burst(a, 300, 0, 10, false, 0, { chain: false, frostNova: true });
  expect(a.cardStatus?.slow).toEqual({ share: FROST_NOVA_SLOW, left: FROST_NOVA_SECONDS });
  expect(b.cardStatus?.slow).toBeDefined();
  expect(boss.cardStatus).toBeUndefined();
  expect(out.cardStatus).toBeUndefined();
  expect(frost.effects.spawnFrostNova).toHaveBeenCalledOnce();
});

it("calls a meteor down after its warning, hitting every enemy in the blast up to its cap, and forgets it off the staff", () => {
  const f = harness({ meteor: 100 });
  for (let index = 0; index < 14; index++) f.enemy(300 + index * 4, 0);
  f.runtime.cast({ x: 300, y: 0 }, 40, false);
  expect(f.effects.spawnMeteor).toHaveBeenCalledOnce();
  f.at(METEOR_DELAY_SECONDS - .01); expect(f.hit).not.toHaveBeenCalled();
  f.at(METEOR_DELAY_SECONDS);
  expect(f.hit).toHaveBeenCalledTimes(METEOR_MAX_TARGETS);
  expect(f.hit.mock.calls.every(call => call[1] === 40 * METEOR_DAMAGE_SHARE)).toBe(true);
  const swapped = harness({ meteor: 100 });
  swapped.enemy(300);
  swapped.runtime.cast({ x: 300, y: 0 }, 40, false);
  swapped.bow();
  swapped.at(1);
  expect(swapped.hit).not.toHaveBeenCalled();
  const none = harness();
  none.runtime.cast({ x: 300, y: 0 }, 40, false);
  expect(none.effects.spawnMeteor).not.toHaveBeenCalled();
});
