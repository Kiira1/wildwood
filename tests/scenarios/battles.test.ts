import { describe, expect, it, vi } from "vitest";
// The server harness first: it swaps the host SDK in before any server module loads.
import { scenarioWorld, type ScenarioPlayer, type ScenarioWorld } from "./harness/server";
import { gameWorld, playAs } from "./harness/game";
import { advanceDuelCombat, initialDuelCombatState } from "../../shared/duel-combat";
import { duelPositionsAt } from "../../shared/duel-approach";
import { HIDDEN_COSMETIC_ITEM_ID } from "../../shared/equipment-appearance";
import { setActiveCards } from "../helpers/active-cards";
import { parseHTML } from "linkedom";
import { simulateGuildBattle } from "../../shared/guild-combat";
import { buildGuildEntrance } from "../../shared/guild-entrance";
import { buildGuildReplayTimeline } from "../../src/ui/guild-replay-timeline";
import { buildGuildReplayEntrance, guildEntrancePosition } from "../../src/ui/guild-replay-entrance";
import { createGuildBattleReplay } from "../../src/ui/guild-battle-replay";
import { duelAnnouncementText } from "../../shared/duel-announcement";
import { ARROW_STORM_ARROWS } from "../../shared/bow-skills";
import type { DuelCombat } from "../../shared/duel-combat";
import { duelAttackAnimationClock, duelShotsAt, duelTimelineState, replayState } from "../../src/game/duel";
import { createDuelPresentation } from "../../src/game/runtime/duel/duel-presentation";
import { duelSwordSpinClock, showDuelSkillEffects } from "../../src/game/runtime/duel/duel-skill-effects";
import type { RuntimeDuelReplay, RuntimeDuelState } from "../../src/game/runtime/types";

// One scenario boots the game: seconds, more on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

const fighter = (identity: string, stats: Partial<{ maxHp: number; damage: number; armor: number; regen: number; attackRate: number }> = {}, extra: Record<string, unknown> = {}) =>
  ({ identity, name: identity, fighter: { maxHp: 100, damage: 1000, armor: 0, regen: 0, attackRate: 1, ...stats }, range: 160, ...extra });
const team = (prefix: string, count: number, stats: Parameters<typeof fighter>[1] = {}) => Array.from({ length: count }, (_, i) => fighter(`${prefix}${i}`, stats));

/** A page with a canvas whose drawing goes nowhere, and frames that run when the test says. */
function replayPage() {
  const { document, window } = parseHTML("<html><body><div id='host'></div></body></html>");
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  Object.assign(window, {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
  });
  const context = new Proxy({}, { get: (_target, name) => name === "canvas" ? {} : name === "measureText" ? () => ({ width: 10 }) : () => undefined, set: () => true });
  const create = document.createElement.bind(document);
  document.createElement = ((tag: string) => { const node = create(tag); if (tag === "canvas") Object.defineProperty(node, "getContext", { value: () => context }); return node; }) as typeof document.createElement;
  const host = document.getElementById("host") as unknown as HTMLElement;
  const runFrame = (time: number) => { const due = [...frames.values()]; frames.clear(); due.forEach(callback => callback(time)); };
  const button = (label: string) => [...host.querySelectorAll("button")].find(node => node.textContent === label) as HTMLButtonElement;
  const seek = () => host.querySelector("input") as HTMLInputElement;
  const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { document, host, frames, runFrame, button, seek, settle };
}

describe("Guild battle replays", () => {
  it("a replay's timeline reaches the recorded result: deaths when the lethal hit lands, every hit before regen and clipping, saved older versions too", () => {
    for (const version of [undefined, 3, 2] as const) {
      const battle = simulateGuildBattle([fighter("a")], [fighter("b")], undefined, version);
      const timeline = buildGuildReplayTimeline(battle);
      expect(timeline.frames.at(-1)?.time).toBe(battle.duration);
      expect(timeline.sample(battle.duration).every(actor => actor.hp === 0)).toBe(true);
    }
    // Both lethal shots are in flight before the simultaneous knockouts.
    const mutual = buildGuildReplayTimeline(simulateGuildBattle([fighter("a")], [fighter("b")]));
    expect(mutual.shots).toHaveLength(2);
    for (const shot of mutual.shots) {
      expect(shot.launch).toBeLessThan(shot.impact);
      expect(shot.impact).toBe(mutual.deaths[shot.target]);
      expect(mutual.sample(shot.launch)[shot.actor].hp).toBeGreaterThan(0);
      expect(mutual.sample(shot.impact)[shot.target].hp).toBe(0);
    }
    expect(mutual.damage.map(hit => hit.amount)).toEqual([1000, 1000]);
    // A sword's hit lands as it swings; a bow's travels.
    const sword = fighter("s", { maxHp: 10_000, damage: 10 }, { range: 75, appearance: { rightHandItem: "wooden_sword" } });
    const swings = buildGuildReplayTimeline(simulateGuildBattle([sword], [fighter("b", { maxHp: 10_000, damage: 10 })]));
    expect(swings.attacks[0].length).toBeGreaterThan(0);
    for (const attack of swings.attacks[0]) expect(attack.launch).toBe(attack.impact);
    for (const attack of swings.attacks[1]) expect(attack.launch).toBeLessThan(attack.impact);
    // Health frame by frame: regen, then at most one hit, never below zero.
    const tough = { maxHp: 10_000, damage: 50, armor: 100, regen: 3, attackRate: .05 };
    const brawl = buildGuildReplayTimeline(simulateGuildBattle([fighter("a", tough), fighter("b", tough)], [fighter("c", tough)]));
    for (let step = 1; step < brawl.frames.length; step++) {
      const frame = brawl.frames[step], previous = brawl.frames[step - 1];
      frame.actors.forEach((actor, i) => {
        if (previous.actors[i].hp <= 0) return;
        const hits = brawl.damage.filter(hit => hit.time === frame.time && hit.target === i);
        expect(hits.length).toBeLessThanOrEqual(1);
        expect(actor.hp).toBeCloseTo(Math.max(0, Math.min(10_000, previous.actors[i].hp + .3) - (hits[0]?.amount ?? 0)), 8);
      });
    }
    // Seeking back and forth reads the same frames, which stay as saved.
    const saved = JSON.stringify(mutual.frames), middle = mutual.sample(.25);
    expect(middle[0].x).toBeCloseTo((mutual.sample(.2)[0].x + mutual.sample(.3)[0].x) / 2);
    mutual.sample(90);
    expect(mutual.sample(.25)).toEqual(middle);
    expect(JSON.stringify(mutual.frames)).toBe(saved);
  });

  it("whole guilds walk on two at a time in a fair, bounded entrance that fighting does not wait for", () => {
    const tough = { maxHp: 10_000, damage: 10 };
    const battle = simulateGuildBattle(team("A", 20, tough), team("B", 20, tough));
    const plan = buildGuildReplayEntrance(battle);
    const waves = new Map<number, number>();
    for (const arrival of plan.arrivals) waves.set(arrival.start, (waves.get(arrival.start) ?? 0) + 1);
    expect(Math.max(...waves.values())).toBe(2);
    expect(plan.duration).toBeLessThanOrEqual(30);
    for (let i = 0; i < 20; i++) expect([plan.arrivals[i].start, plan.arrivals[i].travel]).toEqual([plan.arrivals[i + 20].start, plan.arrivals[i + 20].travel]);
    // A saved player renamed or deleted keeps the same entrance.
    battle.attackers[0].identity = ""; battle.attackers[0].name = "Deleted player";
    expect(buildGuildReplayEntrance(battle)).toEqual(plan);
    // Uneven teams: everyone once.
    expect(buildGuildReplayEntrance(simulateGuildBattle(team("A", 1), team("B", 20))).arrivals).toHaveLength(21);
    // Shots start only once both fighters are on, and the end matches the recorded survivors.
    const timeline = buildGuildReplayTimeline(battle), entrance = buildGuildEntrance(battle);
    expect(timeline.shots[0].impact).toBeLessThan(entrance.duration);
    for (const shot of timeline.shots) for (const index of [shot.actor, shot.target]) {
      expect(shot.launch).toBeGreaterThanOrEqual(entrance.arrivals[index].start + entrance.arrivals[index].travel);
    }
    const last = timeline.sample(battle.duration);
    expect(last.slice(0, 20).filter(actor => actor.hp > 0)).toHaveLength(battle.attackerSurvivors);
    expect(last.slice(20).filter(actor => actor.hp > 0)).toHaveLength(battle.defenderSurvivors);
    // They walk on at combat speed, from off screen, into place without a snap; old v3 replays keep their short schedule.
    const arrival = { start: 1, travel: 5, lane: 20 }, spot = { x: 250, y: 300 };
    for (const side of [0, 1]) {
      const at = (time: number) => guildEntrancePosition(arrival, time, spot, side, 900, 90);
      expect(at(.5).visible).toBe(false);
      expect(Math.abs(at(3).x - at(2).x)).toBeCloseTo(90);
      expect(at(6)).toEqual({ ...spot, visible: true, entering: false });
    }
    expect(guildEntrancePosition({ start: 1, travel: 1, lane: 20 }, 1, spot, 0, 390).x).toBeLessThan(0);
    expect(guildEntrancePosition({ start: 1, travel: 1, lane: 20 }, 1, spot, 1, 390).x).toBeGreaterThan(390);
    expect(buildGuildReplayEntrance(simulateGuildBattle(team("A", 20), team("B", 20), undefined, 3)).duration).toBeLessThanOrEqual(6.1);
  });

  it("the replay window plays in real time at any frame rate, pauses, seeks to the end, restarts, goes Back, and lets go of its frames on close", async () => {
    const page = replayPage();
    const battle = simulateGuildBattle([fighter("A", { damage: 0 })], [fighter("B", { damage: 0 })]);
    let backs = 0;
    const replay = createGuildBattleReplay(page.host, battle, ["Fire", "Moon"], undefined, () => { backs++; });
    await page.settle();
    // A 120 Hz screen for a second: a second of battle.
    for (let index = 0; index <= 120; index++) page.runFrame(100 + index * 1000 / 120);
    expect(Number(page.seek().value)).toBeCloseTo(1);
    page.button("Pause").dispatchEvent(new (page.document.defaultView as any).Event("click"));
    page.runFrame(5_000);
    expect(page.frames.size).toBe(0);
    expect(Number(page.seek().value)).toBeCloseTo(1);
    // Dragged to the end, Back still works.
    page.seek().value = page.seek().max;
    (page.seek() as any).oninput(new (page.document.defaultView as any).Event("input"));
    page.button("Back").click();
    expect(backs).toBe(1);
    page.button("Restart").click();
    expect(page.seek().value).toBe("0");
    expect(page.frames.size).toBe(1);
    replay.dispose();
    expect(page.frames.size).toBe(0);
    expect(page.host.childElementCount).toBe(0);
    // Closed before its art loaded: nothing starts afterwards.
    let finish!: () => void;
    const late = createGuildBattleReplay(page.host, battle, ["Fire", "Moon"], { prepare: () => new Promise<void>(resolve => { finish = resolve; }) } as never);
    late.dispose(); finish(); await page.settle();
    expect(page.frames.size).toBe(0);
    expect(page.host.childElementCount).toBe(0);
  });

  it("Low Performance Mode draws fewer frames without slowing the replay", async () => {
    const page = replayPage();
    const battle = simulateGuildBattle([fighter("A", { damage: 0 })], [fighter("B", { damage: 0 })]);
    const replay = createGuildBattleReplay(page.host, battle, ["Fire", "Moon"], undefined, undefined, () => true);
    await page.settle();
    for (let index = 0; index <= 360; index++) page.runFrame(100 + index * 1000 / 120);
    expect(Number(page.seek().value)).toBeCloseTo(3);
    replay.dispose();
  });
});

describe("Duels", () => {
  /** Two players able to fight: a bow each, ten damage, plenty of health. */
  function duellists(world: ScenarioWorld, challenger: Record<string, unknown> = {}) {
    const [ann, bob] = ["Ann", "Bob"].map(name => world.join(name));
    ann.patch("playerProgress", { inventoryJson: '["starter_bow"]', equippedRightHand: "starter_bow", damage: 10, maxHp: 10_000, ...challenger });
    bob.patch("playerProgress", { inventoryJson: '["starter_bow"]', equippedRightHand: "starter_bow", damage: 10, maxHp: 10_000 });
    return { ann, bob };
  }
  const micros = (value: bigint) => Number(value / 1000n);
  /** Plays the duel to its end on the server clock, as the duellists' pulses do. */
  function fightToTheEnd(world: ScenarioWorld, ann: ScenarioPlayer) {
    const duel = [...world.db.duel.iter()][0];
    world.advance(micros(duel.endsAtMicros) - world.now() + 1_000);
    ann.call("pulseDuel");
    const finishing = world.db.duel.id.find(duel.id);
    world.advance(Math.max(0, micros(finishing.endsAtMicros) - world.now()));
    ann.call("pulseDuel");
    return { duel, finishing };
  }

  it("a duel freezes each side's weapon, rolls and cards at the challenge, plays out as the replay predicts, and keeps them for the replay", () => {
    for (const weapon of ["starter_bow", "wooden_sword"]) {
      const world = scenarioWorld();
      const { ann, bob } = duellists(world, { inventoryJson: JSON.stringify([weapon]), equippedRightHand: weapon, cosmeticRightHand: HIDDEN_COSMETIC_ITEM_ID });
      const key = `${ann.hex}:starter_bow`;
      if (weapon === "starter_bow") world.setup(ctx => ctx.db.playerBowSkill.insert({ key, identity: ann.identity, itemId: "starter_bow", arrowStorm: 100, ricochet: 100, piercingShot: 100 }));
      world.setup(ctx => setActiveCards(ctx, ann.identity, ["magmalisk_card", "koi_shogun_card", "bramble_card"]));
      ann.call("requestDuel", { opponent: bob.identity });
      const duel = [...world.db.duel.iter()][0];
      const frozen = world.db.duelCombatSnapshot.duelId.find(duel.id);
      // The weapon fights though its look is hidden; a sword walks in, a bow stands.
      expect(duel).toMatchObject({ challengerWeaponItem: weapon, challengerRightHandItem: "" });
      expect(duelPositionsAt(duel, 1).challengerMoving).toBe(weapon === "wooden_sword");
      expect(frozen).toMatchObject({ challengerCards: ["magmalisk_card", "koi_shogun_card", "bramble_card"], opponentCards: [] });
      if (weapon === "starter_bow") expect(frozen).toMatchObject({ challengerArrowStorm: 100, challengerRicochet: 100, challengerPiercingShot: 100 });
      // Changing gear or rolls mid-fight changes nothing.
      if (weapon === "starter_bow") world.setup(ctx => ctx.db.playerBowSkill.key.update({ ...ctx.db.playerBowSkill.key.find(key), arrowStorm: 0 }));
      const { finishing } = fightToTheEnd(world, ann);
      const fight = { ...duel, ...frozen };
      const predicted = advanceDuelCombat(fight, initialDuelCombatState(fight), 0, Number(finishing.lastResolvedAt.microsSinceUnixEpoch - duel.startsAtMicros));
      expect(finishing.opponentHp).toBeCloseTo(predicted.opponentHp, 4);
      expect(finishing.challengerDamageDealt).toBeCloseTo(predicted.challengerDamageDealt, 4);
      expect(finishing.challengerDamageDealt).toBeGreaterThan(0);
      expect(world.db.duelReplay.id.find(duel.id)).toMatchObject({ challengerWeaponItem: weapon, challengerRightHandItem: "" });
      expect(world.db.duelCombatSnapshot.duelId.find(duel.id)).toEqual(frozen);
    }
  });

  it("an outdated challenger cannot start a duel, though an opponent saved on an older client can be challenged", () => {
    const world = scenarioWorld();
    const { ann, bob } = duellists(world);
    ann.patch("player", { protocolVersion: 104 });
    expect(ann.refusal("requestDuel", { opponent: bob.identity })).not.toBeNull();
    expect([...world.db.duel.iter()]).toHaveLength(0);
    ann.patch("player", { protocolVersion: world.db.player.identity.find(bob.identity).protocolVersion });
    bob.patch("player", { protocolVersion: 104 });
    const before = world.db.player.identity.find(bob.identity);
    ann.call("requestDuel", { opponent: bob.identity });
    expect([...world.db.duel.iter()]).toHaveLength(1);
    expect(world.db.player.identity.find(bob.identity)).toEqual(before);
  });

  it("the result goes to the opponent as a private message with the replay, gone after a day; never between players who block each other", () => {
    const world = scenarioWorld();
    const { ann, bob } = duellists(world);
    ann.call("requestDuel", { opponent: bob.identity });
    const { duel } = fightToTheEnd(world, ann);
    const letters = () => [...world.db.socialMessage.recipient.filter(bob.identity)];
    expect(letters()).toHaveLength(1);
    expect(letters()[0]).toMatchObject({ channel: "dm" });
    expect(letters()[0].sender.toHexString()).toBe(ann.hex);
    expect(world.db.socialDuelMessage.messageId.find(letters()[0].id)).toMatchObject({ replayId: duel.id });
    world.advance(23 * 3_600_000);
    world.runDue(["maintenanceSweepSchedule"]);
    expect(letters()).toHaveLength(1);
    world.advance(2 * 3_600_000);
    world.runDue(["maintenanceSweepSchedule"]);
    expect(letters()).toHaveLength(0);
    expect([...world.db.socialDuelMessage.recipient.filter(bob.identity)]).toHaveLength(0);

    const blocked = scenarioWorld();
    const pair = duellists(blocked);
    pair.ann.call("requestDuel", { opponent: pair.bob.identity });
    pair.bob.call("setPlayerBlocked", { target: pair.ann.identity, blocked: true });
    fightToTheEnd(blocked, pair.ann);
    expect([...blocked.db.socialMessage.recipient.filter(pair.bob.identity)]).toHaveLength(0);
  });

  it("a duel reaches world chat only when its challenger shares it, once, naming the challenger first", () => {
    const world = scenarioWorld();
    const { ann, bob } = duellists(world);
    ann.call("requestDuel", { opponent: bob.identity });
    const { duel } = fightToTheEnd(world, ann);
    expect([...world.db.chatMessage.iter()]).toHaveLength(0);
    ann.call("shareDuelReplay", { id: duel.id });
    ann.call("shareDuelReplay", { id: duel.id });
    const posts = [...world.db.chatMessage.iter()];
    expect(posts).toHaveLength(1);
    expect(posts[0].replayId).toBe(duel.id);
    const names = [ann, bob].map(player => world.db.playerProfile.identity.find(player.identity).displayName as string);
    expect(posts[0].message.indexOf(names[0])).toBeLessThan(posts[0].message.indexOf(names[1]));
    // However it ended, the challenger leads.
    for (const outcome of ["CHALLENGER_WIN", "OPPONENT_WIN", "DRAW"] as const) {
      const text = duelAnnouncementText("Alpha", "Beta", outcome);
      expect(text.indexOf("Alpha")).toBeLessThan(text.indexOf("Beta"));
      expect(new Set(["CHALLENGER_WIN", "OPPONENT_WIN", "DRAW"].map(each => duelAnnouncementText("Alpha", "Beta", each as never))).size).toBe(3);
    }
  });

  it("a hidden autofarmer's disconnect still counts the time played", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann");
    ann.patch("player", { isVisible: false, lastInputAt: world.timestamp() });
    const before = world.db.playerLifetime.identity.find(ann.identity).playedMicros;
    world.advance(600_000);
    ann.disconnect();
    const lifetime = world.db.playerLifetime.identity.find(ann.identity);
    expect(lifetime.playedMicros - before).toBe(600_000_000n);
    expect(lifetime.sessionStartedAt.microsSinceUnixEpoch).toBe(world.timestamp().microsSinceUnixEpoch);
  });

  it("the challenger's game fights with the frozen seed and rolls, and loads the same into its replay", async () => {
    const world = gameWorld();
    const { ann, bob } = duellists(world);
    world.setup(ctx => ctx.db.playerBowSkill.insert({ key: `${ann.hex}:starter_bow`, identity: ann.identity, itemId: "starter_bow", arrowStorm: 13, ricochet: 7, piercingShot: 4 }));
    ann.disconnect();
    const tab = await playAs(world, "Ann");
    expect(await tab.coop.requestDuel(bob.hex)).toMatchObject({ ok: true });
    await tab.play(500);
    const duel = [...world.db.duel.iter()][0];
    const frozen = world.db.duelCombatSnapshot.duelId.find(duel.id);
    const fields = { riposteSeed: frozen.riposteSeed, challengerArrowStorm: 13, challengerRicochet: 7, challengerPiercingShot: 4 };
    expect(tab.coop.localDuel()).toMatchObject(fields);
    await tab.until(() => Boolean(world.db.duelReplay.id.find(duel.id)), 60_000);
    expect(await tab.coop.loadDuelReplay(duel.id)).toMatchObject(fields);
  });
});

describe("A duel on screen", () => {
  const live: RuntimeDuelState = {
    id: 1n, challenger: "challenger-id", opponent: "opponent-id", challengerName: "Skittle", opponentName: "Uncletaco",
    challengerGender: 1, opponentGender: 2, status: "active", createdAtMs: 0, startsAtMs: 0, startedAtMs: 0, endsAtMs: 30_000,
    challengerHp: 100, challengerMaxHp: 100, challengerDamage: 10, challengerArmor: 0, challengerAttackRate: 1, challengerRegen: 0, challengerAttacks: 1,
    opponentHp: 100, opponentMaxHp: 100, opponentDamage: 10, opponentArmor: 0, opponentAttackRate: 1, opponentRegen: 0, opponentAttacks: 1,
    challengerHeadItem: "", challengerChestItem: "", challengerFeetItem: "", challengerRightHandItem: "", challengerLeftHandItem: "",
    opponentHeadItem: "", opponentChestItem: "", opponentFeetItem: "", opponentRightHandItem: "", opponentLeftHandItem: "",
  };
  const saved: RuntimeDuelReplay = {
    id: 2n, challengerIdentity: live.challenger, opponentIdentity: live.opponent, challengerName: live.challengerName, opponentName: live.opponentName,
    challengerGender: 1, opponentGender: 2, winnerName: "DRAW", durationSeconds: 1,
    challengerMaxHp: 100, challengerDamage: 100, challengerArmor: 0, challengerAttackRate: 1, challengerRegen: 0, challengerFinalHp: 0, challengerAttacks: 1,
    challengerDamageDealt: 100, challengerRegened: 0, challengerBlocked: 0,
    opponentMaxHp: 100, opponentDamage: 100, opponentArmor: 0, opponentAttackRate: 1, opponentRegen: 0, opponentFinalHp: 0, opponentAttacks: 1,
    opponentDamageDealt: 100, opponentRegened: 0, opponentBlocked: 0,
    challengerHeadItem: "", challengerChestItem: "", challengerFeetItem: "", challengerRightHandItem: "", challengerLeftHandItem: "",
    opponentHeadItem: "", opponentChestItem: "", opponentFeetItem: "", opponentRightHandItem: "", opponentLeftHandItem: "",
  };
  /** The duel's presentation with clocks the test moves, and the damage numbers it would pop. */
  function screen(activeDuel: () => RuntimeDuelState | null, clocks: { frame: number; wall: number }, names: { local?: string; remote?: string } = {}) {
    const hits: number[] = [];
    const view = createDuelPresentation({
      activeDuel, localIdentity: () => live.challenger, localDisplayName: () => names.local ?? live.challengerName, remotePlayers: () => [],
      playerDisplayName: () => names.remote, pulseDuel: () => {}, spawnDamageNumber: (_x: number, _y: number, amount: number) => { hits.push(amount); },
      setReplayTitle: () => {}, now: () => clocks.frame, nowMs: () => clocks.wall,
    } as never);
    return { view, hits };
  }

  it("live and replay run one timeline: the same health, the same sword walk, and the final health the server recorded", () => {
    const stats = { challengerMaxHp: 100, opponentMaxHp: 100, challengerAttackRate: 1, opponentAttackRate: 1, challengerAttacks: 3, opponentAttacks: 3,
      challengerRegen: 0, opponentRegen: 0, challengerDamage: 20, opponentDamage: 30, challengerArmor: 0, opponentArmor: 0 };
    expect(duelTimelineState(stats, 1)).toEqual({ resolvedSeconds: 1, challengerDamageDealt: 20, opponentDamageDealt: 30, challengerHp: 70, opponentHp: 80, challengerAttacks: 1, opponentAttacks: 1 });
    expect(replayState({ ...stats, durationSeconds: 3, challengerFinalHp: 4, opponentFinalHp: 0 }, 3)).toMatchObject({ challengerHp: 4, opponentHp: 0 });
    // A rewound clock or a new server snapshot redraws the live state.
    const clocks = { frame: 0, wall: 2_000 };
    const { view } = screen(() => live, clocks, { local: "Generated Local 123", remote: "Generated Remote 456" });
    expect(view.liveDuelPresentationState(live).state.opponentHp).toBe(80);
    clocks.wall = 1_000;
    expect(view.liveDuelPresentationState(live).state.opponentHp).toBe(90);
    expect(view.liveDuelPresentationState({ ...live, challengerDamage: 20 }).state.opponentHp).toBe(80);
    // The names frozen into the duel, not whatever the profiles say now.
    expect(view.liveScene()).toMatchObject({ challenger: { name: "Skittle", gender: 1 }, opponent: { name: "Uncletaco", gender: 2 } });
    // A sword walks in after the countdown, to the same spot live and in the replay.
    const sword = { ...live, combatVersion: 2, challengerRightHandItem: "wooden_sword", opponentRightHandItem: "starter_bow" };
    const swordClocks = { frame: 0, wall: 0 };
    const both = screen(() => sword, swordClocks).view;
    both.startReplay({ ...saved, ...sword, durationSeconds: 30, challengerFinalHp: 50, opponentFinalHp: 50, challengerAttacks: 30, opponentAttacks: 30 } as RuntimeDuelReplay);
    swordClocks.frame = 2_000;
    expect(both.replayScene()?.challenger.moving).toBe(false);
    swordClocks.frame = 4_000; swordClocks.wall = 1_000;
    const liveScene = both.liveScene()!, replayScene = both.replayScene()!;
    expect(liveScene.challenger.moving).toBe(true);
    expect([replayScene.challenger.x, replayScene.opponent.x]).toEqual([liveScene.challenger.x, liveScene.opponent.x]);
    swordClocks.wall = 2_000; swordClocks.frame = 5_000;
    expect(both.liveScene()!.challenger.x).toBe(both.replayScene()!.challenger.x);
    // Knocked out on the way in: the sword stops where it fell.
    const fallen = { ...sword, opponentDamage: 10_000 };
    const fallClocks = { frame: 0, wall: 3_000 };
    const fall = screen(() => fallen, fallClocks).view;
    const x = fall.liveScene()!.challenger.x;
    expect(fall.liveScene()!.challenger).toMatchObject({ hp: 0, moving: false });
    fallClocks.wall = 8_000;
    expect(fall.liveScene()!.challenger.x).toBe(x);
  });

  it("projectiles show only in flight, swords throw none, and every hit pops its damage live and in replay even as health regrows", () => {
    const stats = { challengerMaxHp: 100, opponentMaxHp: 100, challengerAttackRate: 1, opponentAttackRate: 1, challengerAttacks: 3, opponentAttacks: 3,
      challengerRegen: 0, opponentRegen: 0, challengerDamage: 20, opponentDamage: 30, challengerArmor: 0, opponentArmor: 0 };
    const shots = duelShotsAt(stats, 1.2, { shotLifetime: .38, shotSpeed: 100, challengerFromX: 0, opponentFromX: 100, y: 20, challengerWeaponItem: "starter_bow", opponentWeaponItem: "starter_stone" });
    expect(shots.map(shot => [Math.round(shot.x), shot.weaponItem])).toEqual([[20, "starter_bow"], [80, "starter_stone"]]);
    expect(duelShotsAt(stats, 1.5, { shotLifetime: .38, shotSpeed: 100, challengerFromX: 0, opponentFromX: 100, y: 20, challengerWeaponItem: "starter_bow", opponentWeaponItem: "starter_stone" })).toHaveLength(0);
    expect(duelShotsAt(stats, 1.2, { shotLifetime: .38, shotSpeed: 100, challengerFromX: 0, opponentFromX: 100, y: 20, challengerWeaponItem: "wooden_sword", opponentWeaponItem: "starter_bow" })
      .map(shot => shot.weaponItem)).toEqual(["starter_bow"]);
    // Weapon motion keeps up with very fast attacks; a sword meets its target on the hit.
    const fast = 1 / 10.5;
    expect(duelAttackAnimationClock(fast, 1, fast)).toBeCloseTo(.42);
    expect(duelAttackAnimationClock(fast, 1, fast * 2)).toBe(0);
    for (const interval of [1, .1]) expect(duelAttackAnimationClock(interval, 1, interval, "wooden_sword")).toBeCloseTo(.30);
    for (const watchReplay of [false, true]) {
      const hidden = { ...live, combatVersion: 2, challengerWeaponItem: "starter_bow", opponentWeaponItem: "starter_bow", challengerRegen: 100, opponentRegen: 100 };
      const clocks = { frame: 0, wall: 0 };
      const { view, hits } = screen(() => hidden, clocks);
      if (watchReplay) view.startReplay({ ...saved, ...hidden, durationSeconds: 10, challengerAttacks: 10, opponentAttacks: 10, challengerFinalHp: 90, opponentFinalHp: 90 } as RuntimeDuelReplay);
      const scene = () => { if (watchReplay) return view.replayScene()!; view.syncLiveDamageNumbers(hidden); return view.liveScene()!; };
      clocks.frame = clocks.wall = (watchReplay ? 3_000 : 0) + 1_050;
      const first = scene();
      expect([first.challenger.rightHandItem, first.opponent.rightHandItem]).toEqual(["", ""]);
      expect(first.shots.map(shot => shot.weaponItem)).toEqual(["starter_bow", "starter_bow"]);
      expect(hits).toEqual([10, 10]);
      clocks.frame += 1_000; clocks.wall += 1_000;
      expect(scene().challenger.hp).toBe(first.challenger.hp);
      expect(hits).toEqual([10, 10, 10, 10]);
      scene();
      expect(hits).toHaveLength(4);
    }
  });

  it("the finishing frame drops the shots and holds each fall from when it began, live and in replay", () => {
    const clocks = { frame: 125, wall: 1_000 };
    const finishing = { ...live, status: "finishing" as const, challengerHp: 0, opponentHp: 100 };
    const { view } = screen(() => finishing, clocks);
    expect(view.liveScene()?.shots).toEqual([]);
    expect(view.liveScene()?.challenger).toMatchObject({ hp: 0, throwClock: 0, deathStartedAtMs: 125 });
    expect(view.liveScene()?.opponent.deathStartedAtMs).toBeUndefined();
    clocks.frame = 225;
    expect(view.liveScene()?.challenger.deathStartedAtMs).toBe(125);
    const replayClocks = { frame: 0, wall: 0 };
    const replayView = screen(() => null, replayClocks).view;
    replayView.startReplay(saved);
    replayClocks.frame = 4_000;
    expect(replayView.replayScene()).toMatchObject({ shots: [], challenger: { hp: 0, deathStartedAtMs: 4_000 }, opponent: { hp: 0, deathStartedAtMs: 4_000 } });
    replayClocks.frame = 5_000;
    expect(replayView.replayScene()).toMatchObject({ shots: [], challenger: { deathStartedAtMs: 4_000 }, opponent: { deathStartedAtMs: 4_000 } });
  });

  it("bow and sword skills show once, on the hit that carries them, and only in duels new enough to have them", () => {
    const counts = () => ({ arrows: 0, streaks: 0, rings: 0, spins: 0, waves: 0, deflects: 0 });
    const effects = (seen: ReturnType<typeof counts>) => ({
      spawnArcingArrow: () => { seen.arrows++; }, spawnSkillStreak: () => { seen.streaks++; }, spawnSkillRing: () => { seen.rings++; },
      spawnSwordSpin: () => { seen.spins++; }, spawnSwordWave: () => { seen.waves++; }, spawnDeflectedShot: () => { seen.deflects++; },
    });
    const base = { riposteSeed: 42n, challengerMaxHp: 1e9, challengerDamage: 100, challengerArmor: 0, challengerRegen: 0, challengerAttackRate: 1,
      opponentMaxHp: 1e9, opponentDamage: 100, opponentArmor: 0, opponentRegen: 0, opponentAttackRate: 1 };
    const attacks = { challengerAttacks: 1, opponentAttacks: 1 };
    const bow = counts(), bowDuel = { ...base, combatVersion: 4, challengerArrowStorm: 100, challengerRicochet: 100, challengerPiercingShot: 100 } as DuelCombat;
    showDuelSkillEffects(bowDuel, .9, 1, attacks, effects(bow));
    expect(bow).toMatchObject({ arrows: ARROW_STORM_ARROWS, streaks: 3, rings: 2 });
    showDuelSkillEffects(bowDuel, 1, 1.1, attacks, effects(bow));
    showDuelSkillEffects({ ...bowDuel, combatVersion: 3 }, .9, 1, attacks, effects(bow));
    expect(bow.arrows).toBe(ARROW_STORM_ARROWS);
    const sword = counts(), swordDuel = { ...base, combatVersion: 8, challengerWhirlwind: 100, challengerShockwave: 100 } as DuelCombat;
    showDuelSkillEffects(swordDuel, .9, 1, attacks, effects(sword));
    showDuelSkillEffects(swordDuel, 1, 1.1, attacks, effects(sword));
    showDuelSkillEffects({ ...swordDuel, combatVersion: 7 }, .9, 1, attacks, effects(sword));
    expect(sword).toMatchObject({ spins: 1, waves: 1 });
    expect(duelSwordSpinClock(swordDuel, "challenger", 1.2, 1)).toBeCloseTo(.4);
    expect(duelSwordSpinClock(swordDuel, "challenger", 2, 1)).toBe(0);
    // A sword's Deflect turns back the bow's shot instead of its storm.
    const deflect = counts();
    showDuelSkillEffects({ ...swordDuel, challengerWeaponItem: "ion_bow", challengerArrowStorm: 100, opponentWeaponItem: "ion_sword", opponentDeflect: 100 } as DuelCombat, .9, 1, attacks, effects(deflect));
    expect(deflect).toMatchObject({ deflects: 1, arrows: 0 });
  });
});

