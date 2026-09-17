import { expect, it, vi } from "vitest";
import { drawStartingPlayer } from "../game/player-appearance";
import { paintArrowProjectile, paintRockProjectile } from "../game/runtime/weapon-projectile-renderer";
import { simulateGuildBattle } from "../../shared/guild-combat";
import { STARTER_BOW, STARTER_STONE } from "../../shared/items";
import { buildGuildReplayTimeline } from "./guild-replay-timeline";
import { createGuildBattlefieldRenderer } from "./guild-battlefield-renderer";
vi.mock("../game/player-appearance", () => ({ drawStartingPlayer: vi.fn() }));
vi.mock("../game/runtime/weapon-projectile-renderer", () => ({ paintArrowProjectile: vi.fn(), paintRockProjectile: vi.fn() }));
it("uses bounded high-DPI continuous equipment poses and the actual weapon projectile painters", () => {
  const context = new Proxy({}, { get: () => vi.fn(), set: () => true }) as CanvasRenderingContext2D;
  const doc = { defaultView: { devicePixelRatio: 3 }, createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  const canvas = { ownerDocument: doc, clientWidth: 400, width: 300, height: 150 } as unknown as HTMLCanvasElement;
  const member = (identity: string, weapon: string) => ({ identity, name: identity, fighter: { maxHp: 100, damage: 10, armor: 0, regen: 0, attackRate: 1 }, range: 160, appearance: { rightHandItem: weapon } });
  const timeline = buildGuildReplayTimeline(simulateGuildBattle([member("a", STARTER_BOW)], [member("b", STARTER_STONE), member("c", STARTER_STONE)]));
  const stone = { complete: true, naturalWidth: 26, naturalHeight: 26 } as HTMLImageElement;
  const renderer = createGuildBattlefieldRenderer(canvas, context, timeline, 1, { player: { basicFrontLeg: stone, basicBackLeg: stone, equipment: { [STARTER_STONE]: { sprite: stone } } }, prepare: async () => {}, trees: stone, treeBounds: () => [] });
  for (const shot of timeline.shots.slice(0, 3)) renderer.draw((shot.launch + shot.impact) / 2, true);
  expect(canvas.width).toBe(800); expect(canvas.height).toBe(512);
  expect(vi.mocked(drawStartingPlayer).mock.calls[0][0]).toBe(context);
  expect(vi.mocked(drawStartingPlayer).mock.calls.some(([, , pose]) => pose.smooth && pose.rightHandItem === STARTER_BOW)).toBe(true);
  expect(vi.mocked(drawStartingPlayer).mock.calls.some(([, , pose]) => pose.combatFacing !== 0 && pose.combatFacing !== Math.PI && pose.throwClock! > 0)).toBe(true);
  expect(paintArrowProjectile).toHaveBeenCalled(); expect(paintRockProjectile).toHaveBeenCalled();
  renderer.dispose();
});

it("fits full teams in portrait and landscape while retaining names and numeric HP bars", () => {
  const paintText = vi.fn();
  const context = new Proxy({}, { get: (_target, key) => key === "fillText" ? paintText : vi.fn(), set: () => true }) as CanvasRenderingContext2D;
  const doc = { defaultView: { devicePixelRatio: 2 }, createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  const canvas = { ownerDocument: doc, clientWidth: 390, clientHeight: 844, width: 0, height: 0 };
  const team = (prefix: string) => Array.from({ length: 20 }, (_, i) => ({ identity: `${prefix}${i}`, name: `${prefix}${i}`, fighter: { maxHp: 100, damage: 0, armor: 0, regen: 0, attackRate: 1 } }));
  const timeline = buildGuildReplayTimeline(simulateGuildBattle(team("A"), team("B")));
  const stone = { naturalWidth: 0 } as HTMLImageElement;
  const renderer = createGuildBattlefieldRenderer(canvas as unknown as HTMLCanvasElement, context, timeline, 20,
    { player: { basicFrontLeg: stone, basicBackLeg: stone, equipment: {} }, prepare: async () => {}, trees: stone, treeBounds: () => [] });
  const portrait = renderer.draw(0, true);
  expect(canvas.width).toBe(780); expect(canvas.height).toBe(1688);
  expect(Math.max(...portrait.slice(0, 20).map(actor => actor.x))).toBeLessThan(Math.min(...portrait.slice(20).map(actor => actor.x)));
  expect(new Set(portrait.slice(0, 20).map(actor => actor.y)).size).toBe(20);
  expect(new Set(portrait.slice(20).map(actor => actor.y)).size).toBe(20);
  expect(portrait.every(actor => actor.x >= 50 && actor.x <= 340 && actor.y >= 150 && actor.y <= 665)).toBe(true);
  expect(paintText.mock.calls.filter(([text]) => text === "100 / 100")).toHaveLength(40);
  for (const fighter of timeline.fighters) expect(paintText.mock.calls.some(([text]) => text === fighter.name)).toBe(true);
  renderer.draw(10, true);
  expect(renderer.draw(0, true)).toEqual(portrait);
  canvas.clientWidth = 844; canvas.clientHeight = 390;
  const landscape = renderer.draw(0, true);
  expect(canvas.width).toBe(1688); expect(canvas.height).toBe(780);
  expect(Math.max(...landscape.slice(0, 20).map(actor => actor.x))).toBeLessThan(Math.min(...landscape.slice(20).map(actor => actor.x)));
  renderer.dispose();
});

it("draws white damage popups on impact and handles expiry and rewind", () => {
  const text: { label: string; color: unknown }[] = [];
  const state: Record<string, unknown> = {};
  const context = new Proxy(state, {
    get: (target, key: string) => key === "fillText" ? (label: string) => text.push({ label, color: target.fillStyle }) : target[key] ?? vi.fn(),
    set: (target, key: string, value) => { target[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  const doc = { defaultView: { devicePixelRatio: 1 }, createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  const canvas = { ownerDocument: doc, clientWidth: 390, clientHeight: 844, width: 0, height: 0 };
  const member = (identity: string) => ({ identity, name: identity, fighter: { maxHp: 100, damage: 73, armor: 0, regen: 0, attackRate: 3 }, range: 160 });
  const timeline = buildGuildReplayTimeline(simulateGuildBattle([member("a")], [member("b")]));
  const image = { naturalWidth: 0 } as HTMLImageElement;
  const renderer = createGuildBattlefieldRenderer(canvas as unknown as HTMLCanvasElement, context, timeline, 1,
    { player: { basicFrontLeg: image, basicBackLeg: image, equipment: {} }, prepare: async () => {}, trees: image, treeBounds: () => [] });
  const popups = (time: number) => { text.length = 0; renderer.draw(time, false); return text.filter(row => row.label === "73"); };
  const time = timeline.damage[0].time;
  expect(popups(time - .01)).toHaveLength(0);
  expect(popups(time)).toEqual([{ label: "73", color: "#fff" }, { label: "73", color: "#fff" }]);
  expect(popups(time + .9)).toHaveLength(0);
  expect(popups(time)).toHaveLength(2);
  renderer.dispose();
});

it("does not render offscreen entrants, and keeps fighting while reinforcements enter", async () => {
  const { buildGuildReplayEntrance } = await import("./guild-replay-entrance");
  const paintText = vi.fn();
  const context = new Proxy({}, { get: (_target, key) => key === "fillText" ? paintText : vi.fn(), set: () => true }) as CanvasRenderingContext2D;
  const doc = { defaultView: { devicePixelRatio: 1 }, createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  const canvas = { ownerDocument: doc, clientWidth: 390, clientHeight: 844, width: 0, height: 0 } as unknown as HTMLCanvasElement;
  const team = (prefix: string) => Array.from({ length: 20 }, (_, i) => ({ identity: `${prefix}${i}`, name: `${prefix}${i}`,
    fighter: { maxHp: 100, damage: 10, armor: 0, regen: 0, attackRate: 1 } }));
  const battle = simulateGuildBattle(team("A"), team("B")), entrance = buildGuildReplayEntrance(battle);
  const timeline = buildGuildReplayTimeline(battle), image = { naturalWidth: 0 } as HTMLImageElement;
  const renderer = createGuildBattlefieldRenderer(canvas, context, timeline, 20,
    { player: { basicFrontLeg: image, basicBackLeg: image, equipment: {} }, prepare: async () => {}, trees: image, treeBounds: () => [] }, entrance);
  vi.mocked(drawStartingPlayer).mockClear();
  renderer.draw(0, true, 0);
  expect(drawStartingPlayer).not.toHaveBeenCalled(); expect(paintText).not.toHaveBeenCalled();
  const early = renderer.draw(.5, true, .5);
  const visible = early.filter(actor => actor.visible);
  expect(visible.length).toBeGreaterThan(0); expect(visible.length).toBeLessThan(10);
  expect(drawStartingPlayer).toHaveBeenCalledTimes(visible.length);
  const pose = vi.mocked(drawStartingPlayer).mock.calls[0][2];
  expect(pose.scale).toBeGreaterThan(0); expect(pose.scale).toBeLessThan(.6); expect(pose.moving).toBe(true);
  vi.mocked(drawStartingPlayer).mockClear(); paintText.mockClear();
  const firstHit = timeline.shots[0].impact;
  expect(firstHit).toBeLessThan(entrance.duration);
  const fighting = renderer.draw(firstHit, true, firstHit);
  expect(fighting.some(actor => actor.entering || !actor.visible)).toBe(true);
  expect(vi.mocked(drawStartingPlayer).mock.calls.some(([, , pose]) => (pose.throwClock ?? 0) > 0)).toBe(true);
  expect(paintText.mock.calls.some(([label]) => label === "10")).toBe(true);
  vi.mocked(drawStartingPlayer).mockClear(); paintText.mockClear();
  const arrived = renderer.draw(entrance.duration, true, entrance.duration);
  expect(arrived.every(actor => actor.visible)).toBe(true);
  expect(drawStartingPlayer).toHaveBeenCalledTimes(arrived.filter((_, i) => entrance.duration - timeline.deaths[i] <= 1.1).length);
  expect(vi.mocked(drawStartingPlayer).mock.calls.length).toBeLessThan(40);
  expect(arrived.some(actor => actor.attacks > 0)).toBe(true);
  vi.mocked(drawStartingPlayer).mockClear(); renderer.draw(0, true, 0);
  expect(drawStartingPlayer).not.toHaveBeenCalled();
  renderer.dispose();
});


it.each([[390, 844], [844, 390]])("keeps mobile movement and reach proportional to the character in %sx%s", (width, height) => {
  const context = new Proxy({}, { get: () => vi.fn(), set: () => true }) as CanvasRenderingContext2D;
  const doc = { defaultView: { devicePixelRatio: 1 }, createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  const canvas = { ownerDocument: doc, clientWidth: width, clientHeight: height, width: 0, height: 0 } as unknown as HTMLCanvasElement;
  const member = (identity: string) => ({ identity, name: identity, fighter: { maxHp: 100, damage: 0, armor: 0, regen: 0, attackRate: 1 }, range: 200, moveSpeed: 180 });
  const timeline = buildGuildReplayTimeline(simulateGuildBattle([member("a")], [member("b")]));
  const original = timeline.sample(0);
  timeline.sample = time => original.map((actor, i) => ({ ...actor, x: i ? 200 : time * 180, y: i ? 200 : 0 }));
  const image = { naturalWidth: 0 } as HTMLImageElement;
  const renderer = createGuildBattlefieldRenderer(canvas, context, timeline, 1,
    { player: { basicFrontLeg: image, basicBackLeg: image, equipment: {} }, prepare: async () => {}, trees: image, treeBounds: () => [] });
  vi.mocked(drawStartingPlayer).mockClear();
  const start = renderer.draw(0, false), later = renderer.draw(.5, false);
  const worldScale = vi.mocked(drawStartingPlayer).mock.calls[0][2].scale! / .6;
  expect(later[0].x - start[0].x).toBeCloseTo(90 * worldScale);
  expect(start[1].x - start[0].x).toBeCloseTo(200 * worldScale);
  expect(start[1].y - start[0].y).toBeCloseTo(200 * worldScale);
  renderer.dispose();
});
