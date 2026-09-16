import { describe, expect, it, vi } from "vitest";
import { createDuelPresentation } from "./duel-presentation";
import { createDuelSessionController } from "./duel-session-controller";
import type { RuntimeDuelReplay, RuntimeDuelState } from "./types";

const duel: RuntimeDuelState = {
  id: 1n,
  challenger: "challenger-id",
  opponent: "opponent-id",
  challengerName: "Skittle",
  opponentName: "Uncletaco",
  challengerGender: 1,
  opponentGender: 2,
  status: "active",
  createdAtMs: 0,
  startsAtMs: 0,
  startedAtMs: 0,
  endsAtMs: 30_000,
  challengerHp: 100,
  challengerMaxHp: 100,
  challengerDamage: 10,
  challengerArmor: 0,
  challengerAttackRate: 1,
  challengerRegen: 0,
  challengerAttacks: 1,
  opponentHp: 100,
  opponentMaxHp: 100,
  opponentDamage: 10,
  opponentArmor: 0,
  opponentAttackRate: 1,
  opponentRegen: 0,
  opponentAttacks: 1,
  challengerHeadItem: "",
  challengerChestItem: "",
  challengerFeetItem: "",
  challengerRightHandItem: "",
  challengerLeftHandItem: "",
  opponentHeadItem: "",
  opponentChestItem: "",
  opponentFeetItem: "",
  opponentRightHandItem: "",
  opponentLeftHandItem: "",
};

const replay: RuntimeDuelReplay = {
  id: 2n,
  challengerIdentity: duel.challenger,
  opponentIdentity: duel.opponent,
  challengerName: duel.challengerName,
  opponentName: duel.opponentName,
  challengerGender: duel.challengerGender,
  opponentGender: duel.opponentGender,
  winnerName: "DRAW",
  durationSeconds: 1,
  challengerMaxHp: 100,
  challengerDamage: 100,
  challengerArmor: 0,
  challengerAttackRate: 1,
  challengerRegen: 0,
  challengerFinalHp: 0,
  challengerAttacks: 1,
  challengerDamageDealt: 100,
  challengerRegened: 0,
  challengerBlocked: 0,
  opponentMaxHp: 100,
  opponentDamage: 100,
  opponentArmor: 0,
  opponentAttackRate: 1,
  opponentRegen: 0,
  opponentFinalHp: 0,
  opponentAttacks: 1,
  opponentDamageDealt: 100,
  opponentRegened: 0,
  opponentBlocked: 0,
  challengerHeadItem: "",
  challengerChestItem: "",
  challengerFeetItem: "",
  challengerRightHandItem: "",
  challengerLeftHandItem: "",
  opponentHeadItem: "",
  opponentChestItem: "",
  opponentFeetItem: "",
  opponentRightHandItem: "",
  opponentLeftHandItem: "",
};

function presentationWithClocks(activeDuel: () => RuntimeDuelState | null, clocks: { frame: number; wall: number }) {
  return createDuelPresentation({
    activeDuel,
    localIdentity: () => duel.challenger,
    localDisplayName: () => duel.challengerName,
    remotePlayers: () => [],
    playerDisplayName: () => undefined,
    pulseDuel: () => {},
    spawnDamageNumber: () => {},
    setReplayTitle: () => {},
    now: () => clocks.frame,
    nowMs: () => clocks.wall,
  });
}

describe("live duel identity presentation", () => {
  it("refreshes the timeline when the clock rewinds or a server snapshot changes", () => {
    const clocks = { frame: 0, wall: 2_000 };
    const presentation = presentationWithClocks(() => duel, clocks);
    expect(presentation.liveDuelPresentationState(duel).state.opponentHp).toBe(80);
    clocks.wall = 1_000;
    expect(presentation.liveDuelPresentationState(duel).state.opponentHp).toBe(90);
    const updated = { ...duel, challengerDamage: 20 };
    expect(presentation.liveDuelPresentationState(updated).state.opponentHp).toBe(80);
  });

  it("uses names frozen into the duel instead of generated profile fallbacks", () => {
    const presentation = createDuelPresentation({
      activeDuel: () => duel,
      localIdentity: () => duel.challenger,
      localDisplayName: () => "Generated Local 123",
      remotePlayers: () => [],
      playerDisplayName: () => "Generated Remote 456",
      pulseDuel: () => {},
      spawnDamageNumber: () => {},
      setReplayTitle: () => {},
      now: () => 1_000,
      nowMs: () => 1_000,
    });

    expect(presentation.liveScene()).toMatchObject({
      challenger: { name: "Skittle", gender: 1 },
      opponent: { name: "Uncletaco", gender: 2 },
    });
  });

  it("uses the frozen opponent name in the live duel HUD", () => {
    const session = createDuelSessionController({
      activeDuel: () => duel,
      isDueling: () => true,
      isReplayActive: () => false,
      isDuelResultHeld: () => false,
      showDuelResult: () => {},
      showDuelResultUnavailable: () => {},
      fadeToWorld: () => {},
      leaveDuelResult: () => {},
      isRunning: () => true,
      isProfileOpen: () => false,
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      player: () => ({ x: 0, y: 0 }),
      renderedDuelScene: () => null,
      localIdentity: () => duel.challenger,
      localDisplayName: () => duel.challengerName,
      remotePlayers: () => [],
      playerDisplayName: () => "Generated Remote 456",
      publicPlayerName: (_identity, name) => name || "PLAYER",
      openProfile: () => {},
    });

    expect(session.duelOpponentName(duel)).toBe("Uncletaco");
  });

  it("clears live projectiles and starts a stable death animation on the finishing frame", () => {
    const clocks = { frame: 125, wall: 1_000 };
    const finishingDuel: RuntimeDuelState = {
      ...duel,
      status: "finishing",
      challengerHp: 0,
      opponentHp: 100,
    };
    const presentation = presentationWithClocks(() => finishingDuel, clocks);

    const firstScene = presentation.liveScene();
    expect(firstScene?.shots).toEqual([]);
    expect(firstScene?.challenger).toMatchObject({ hp: 0, throwClock: 0, deathStartedAtMs: 125 });
    expect(firstScene?.opponent.deathStartedAtMs).toBeUndefined();

    clocks.frame = 225;
    expect(presentation.liveScene()?.challenger.deathStartedAtMs).toBe(125);
  });

  it("clears terminal replay projectiles and keeps the defeated actor animating", () => {
    const clocks = { frame: 0, wall: 0 };
    const presentation = presentationWithClocks(() => null, clocks);
    presentation.startReplay(replay);

    clocks.frame = 4_000;
    const terminalScene = presentation.replayScene();
    expect(terminalScene?.shots).toEqual([]);
    expect(terminalScene?.challenger).toMatchObject({ hp: 0, throwClock: 0, deathStartedAtMs: 4_000 });
    expect(terminalScene?.opponent).toMatchObject({ hp: 0, throwClock: 0, deathStartedAtMs: 4_000 });

    clocks.frame = 5_000;
    const heldScene = presentation.replayScene();
    expect(heldScene?.challenger.deathStartedAtMs).toBe(4_000);
    expect(heldScene?.opponent.deathStartedAtMs).toBe(4_000);
    expect(heldScene?.shots).toEqual([]);
  });
});

it("uses identical moving sword positions in live duels and replays, after countdown", () => {
  const sword = { ...duel, combatVersion: 2, challengerRightHandItem: "wooden_sword", opponentRightHandItem: "starter_bow" };
  const clocks = { frame: 0, wall: 0 };
  const view = presentationWithClocks(() => sword, clocks);
  view.startReplay({ ...replay, ...sword, durationSeconds: 30, challengerFinalHp: 50, opponentFinalHp: 50, challengerAttacks: 30, opponentAttacks: 30 });
  clocks.frame = 2000;
  expect(view.replayScene()?.challenger).toMatchObject({ x: 5880, moving: false, throwClock: 0 });
  clocks.frame = 4000; clocks.wall = 1000;
  const live = view.liveScene()!, recorded = view.replayScene()!;
  expect(live.challenger).toMatchObject({ x: 5970, moving: true, throwClock: 0 });
  expect(recorded.challenger.x).toBe(live.challenger.x);
  expect(recorded.opponent.x).toBe(live.opponent.x);
  expect(live.opponent).toMatchObject({ x: 6120, moving: false });
  clocks.wall = 2000; clocks.frame = 5000;
  expect(view.liveScene()?.challenger).toMatchObject({ x: 6045, moving: false });
  expect(view.replayScene()?.challenger).toMatchObject({ x: 6045, moving: false });
});

it("freezes a sword at the point of an approach knockout", () => {
  const sword = { ...duel, combatVersion: 2, challengerRightHandItem: "wooden_sword", opponentDamage: 10000 };
  const clocks = { frame: 0, wall: 3000 };
  const view = presentationWithClocks(() => sword, clocks);
  expect(view.liveScene()?.challenger).toMatchObject({ hp: 0, x: 5970, moving: false, throwClock: 0 });
  clocks.wall = 8000;
  expect(view.liveScene()?.challenger.x).toBe(5970);
});


it.each([false, true])("shows hidden-weapon arrows and actual hit damage despite regeneration (replay=%s)", (watchReplay) => {
  const hit = vi.fn();
  let now = 0;
  const hidden = { ...duel, combatVersion: 2, challengerWeaponItem: "starter_bow", opponentWeaponItem: "starter_bow",
    challengerRegen: 100, opponentRegen: 100 };
  const runtime = createDuelPresentation({ activeDuel: () => hidden,
    localIdentity: () => hidden.challenger, localDisplayName: () => "Me", remotePlayers: () => [], playerDisplayName: () => undefined,
    pulseDuel: () => {}, spawnDamageNumber: hit, setReplayTitle: () => {}, now: () => now, nowMs: () => now });
  const saved = { ...replay, ...hidden, durationSeconds: 10, challengerAttacks: 10, opponentAttacks: 10,
    challengerFinalHp: 90, opponentFinalHp: 90 };
  if (watchReplay) runtime.startReplay(saved);
  const scene = () => { if (watchReplay) return runtime.replayScene()!; runtime.syncLiveDamageNumbers(hidden); return runtime.liveScene()!; };
  now = (watchReplay ? 3000 : 0) + 1050;
  const first = scene();
  expect(first.challenger.rightHandItem).toBe(""); expect(first.opponent.rightHandItem).toBe("");
  expect(first.shots).toHaveLength(2); expect(first.shots.every(shot => shot.weaponItem === "starter_bow")).toBe(true);
  expect(hit.mock.calls.map(call => call[2])).toEqual([10, 10]);
  hit.mockClear();
  now += 1000;
  const second = scene();
  // HP has recovered to the same value between hits, but each hit still gets a popup.
  expect(second.challenger.hp).toBe(first.challenger.hp);
  expect(hit.mock.calls.map(call => call[2])).toEqual([10, 10]);
  hit.mockClear(); scene(); expect(hit).not.toHaveBeenCalled();
});
