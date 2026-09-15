import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createOnboardingTutorial } from "./onboarding-tutorial";
import { createGameBootstrap } from "../game/runtime/game-bootstrap";
import { ENEMY_TYPES, REWARD_DATA, rewardLabel } from "../game/enemies";
import { createEnemyLifecycle } from "../game/runtime/enemy-lifecycle";
import { ONBOARDING_MAP_ID, ONBOARDING_WORLD, ONBOARDING_STEP as S, ONBOARDING_ENEMY_POSITION } from "../../shared/onboarding";
afterEach(() => vi.unstubAllGlobals());
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(initial = 1) {
  const { document } = parseHTML('<html><body><canvas id="game"></canvas></body></html>');
  vi.stubGlobal("document", document); vi.stubGlobal("navigator", { maxTouchPoints: 1 });
  const { player, enemies, spawnSites: sites } = createGameBootstrap();
  let identity = "guest", step = initial, connected = true, profileOpen = false, chosenName = false;
  const saved = { damage: 3, regen: .2 };
  const complete = vi.fn(async (next: number) => {
    if (next > step) { if (next === S.regen) saved.damage++; if (next === S.death) saved.regen += .2; step = next; }
    return { ok: true };
  });
  const respawn = vi.fn(() => Object.assign(player, ONBOARDING_WORLD.spawn, { hp: player.maxHp }));
  const enter = vi.fn(() => { Object.assign(player, ONBOARDING_WORLD.spawn, saved); });
  const logPickup = vi.fn(), clearInput = vi.fn(), closeWindows = vi.fn(), waitForNameSave = vi.fn(async () => {});
  const clearCombat = vi.fn(), finish = vi.fn(), setName = vi.fn(async () => ({ ok: true })), cancel = vi.fn();
  const fadeToWorld = vi.fn((action: () => void | Promise<void>) => { void action(); });
  const scene = createOnboardingTutorial({ player, enemies, sites, step: () => step, identity: () => identity,
    connected: () => connected, stats: () => saved, complete,
    spawn: createEnemyLifecycle(enemies, sites, vi.fn()).spawnFromSite, enter, respawn,
    clearCombat, clearInput, logPickup, fadeToWorld,
    profileOpen: () => profileOpen, setName, cancel, hasChosenName: () => chosenName, closeWindows, waitForNameSave,
  });
  scene.start(finish);
  const advanceTime = (seconds: number) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) scene.update(1 / 60); };
  const advanceUntil = (done: () => boolean) => {
    for (let i = 0; i < 1200 && !done(); i++) scene.update(1 / 60);
    expect(done()).toBe(true);
  };
  return { scene, closeWindows, waitForNameSave, setChosenName: (value: boolean) => { chosenName = value; }, clearInput, logPickup, advanceUntil, setName, cancel, fadeToWorld, complete, saved, player, enemies, sites, document, enter, respawn, finish, advanceTime,
    setProfileOpen: (value: boolean) => { profileOpen = value; },
    setIdentity: (value: string) => { identity = value; }, setConnected: (value: boolean) => { connected = value; } };
}
describe("private tutorial map", () => {
  it("uses the existing map and enemy lifecycle with mobile guidance and no second canvas", async () => {
    const f = fixture();
    expect(f.enter).toHaveBeenCalledWith(ONBOARDING_MAP_ID);
    expect(f.document.querySelectorAll("canvas")).toHaveLength(1);
    expect(f.document.querySelector(".onboarding-hint")?.textContent).toBe("Drag to move");
    expect(f.enemies).toHaveLength(0);
    f.player.x += 70; f.scene.update(1 / 60); await settle();
    expect(f.enemies).toHaveLength(0);
    expect(f.scene.canOpenProfile()).toBe(true);
    f.advanceTime(2);
    expect(f.complete).toHaveBeenCalledTimes(1);
    f.setProfileOpen(true); f.scene.update(1 / 60);
    expect(f.document.querySelector<HTMLElement>(".onboarding-tutorial")?.hidden).toBe(true);
    expect(f.scene.blocksInput()).toBe(true);
    f.setProfileOpen(false); f.scene.update(1 / 60); await settle();
    expect(f.enemies).toHaveLength(1);
    expect(f.enemies[0]).toMatchObject({ ...ONBOARDING_ENEMY_POSITION, speed: ENEMY_TYPES.Spitter.speed, damage: 10, type: "Spitter", displayName: "Baby Spitter", hp: 10, reward: { type: "damage", amount: 1 } });
    expect(f.scene.enemyDefeated()).toBe(true); await settle();
    expect(f.player.damage).toBe(4);
    expect(f.scene.blocksInput()).toBe(false);
    f.advanceTime(3.1);
    expect(f.enemies).toHaveLength(1);
    expect(f.enemies[0]).toMatchObject({ type: "Brood", hp: 25, reward: { type: "regen", amount: .2 } });
    f.scene.enemyDefeated(); await settle();
    expect(f.player.regen).toBeCloseTo(.4);
    expect(f.logPickup.mock.calls).toEqual([
      [rewardLabel({ type: "damage", amount: 1 }), REWARD_DATA.damage.color],
      [rewardLabel({ type: "regen", amount: .2 }), REWARD_DATA.regen.color],
    ]);
    expect(f.document.querySelector(".onboarding-instruction")!.textContent).toBe("");
    f.advanceTime(2.9); expect(f.enemies).toHaveLength(0);
    f.advanceTime(.2); // The death explanation gets its own reading time before combat.
    expect(f.document.querySelector(".onboarding-instruction")!.textContent).not.toBe("");
    f.advanceTime(3.9); expect(f.enemies).toHaveLength(0);
    expect(f.scene.blocksInput()).toBe(false);
    f.advanceUntil(() => f.enemies.length > 0);
    expect(f.enemies[0].hideStatus).toBe(true);
    expect(f.scene.blocksInput()).toBe(false);
    expect(f.enemies[0].damage).toBeGreaterThan(f.player.maxHp);
    const deathExplanation = f.document.querySelector(".onboarding-instruction")!.textContent;
    f.player.hp = 0; expect(f.scene.died()).toBe(true);
    expect(f.document.querySelector(".onboarding-instruction")!.textContent).toBe(deathExplanation);
    f.advanceTime(1.9); expect(f.respawn).not.toHaveBeenCalled();
    f.advanceUntil(() => f.respawn.mock.calls.length > 0);
    expect(f.respawn).toHaveBeenCalledOnce();
    expect(f.player).toMatchObject({ ...ONBOARDING_WORLD.spawn, damage: 4, regen: .4 });
    expect(f.document.querySelector(".onboarding-instruction")!.textContent).toBe(deathExplanation);
    f.advanceTime(1.9); expect(f.fadeToWorld).not.toHaveBeenCalled();
    expect(f.document.querySelector(".onboarding-instruction")!.textContent).toBe(deathExplanation);
    f.advanceTime(.2); expect(f.fadeToWorld).not.toHaveBeenCalled();
    f.advanceUntil(() => f.fadeToWorld.mock.calls.length > 0); await settle();
    expect(f.fadeToWorld).toHaveBeenCalledWith(expect.any(Function), 700);
    expect(f.finish).not.toHaveBeenCalled();
    f.document.querySelector<HTMLButtonElement>(".onboarding-skip")!.click(); await settle();
    expect(f.setName).not.toHaveBeenCalled();
    expect(f.complete.mock.calls.map(([step]) => step)).toEqual([2, 3, 4, 5, 6]);
    expect(f.finish).toHaveBeenCalledOnce();
    expect(f.scene.isActive()).toBe(false);
    expect(f.document.body.classList.contains("is-onboarding")).toBe(false);
  });
  it.each([S.move, S.spitter, S.death])("skips from lesson %s directly to the username prompt", async initial => {
    const f = fixture(initial);
    if (initial === S.death) { f.player.hp = 0; f.scene.died(); }
    const skip = f.document.querySelector<HTMLButtonElement>(".onboarding-skip-tutorial")!;
    skip.click(); skip.click(); await settle();
    expect(f.fadeToWorld).toHaveBeenCalledOnce();
    expect(f.enemies).toHaveLength(0);
    expect(f.document.querySelector(".onboarding-name")).not.toBeNull();
    expect(f.complete).not.toHaveBeenCalled();
    f.document.querySelector<HTMLButtonElement>(".onboarding-skip")!.click(); await settle();
    expect(f.complete).toHaveBeenCalledExactlyOnceWith(S.complete);
    expect(f.finish).toHaveBeenCalledOnce();
    expect(f.saved).toEqual({ damage: 3, regen: .2 });
  });
  it("keeps a username chosen in the profile and bypasses the second name prompt", async () => {
    const f = fixture(S.profile);
    f.setChosenName(true);
    f.document.querySelector<HTMLButtonElement>(".onboarding-skip-tutorial")!.click(); await settle();
    expect(f.closeWindows).toHaveBeenCalledOnce();
    expect(f.setName).not.toHaveBeenCalled();
    expect(f.complete).toHaveBeenCalledExactlyOnceWith(S.complete);
    expect(f.document.querySelector(".onboarding-name")).toBeNull();
    expect(f.finish).toHaveBeenCalledOnce();
  });
  it("waits for an in-flight profile rename before deciding whether a name is needed", async () => {
    const f = fixture(S.profile);
    let resolveName!: () => void;
    f.waitForNameSave.mockImplementationOnce(() => new Promise<void>(resolve => { resolveName = resolve; }));
    f.document.querySelector<HTMLButtonElement>(".onboarding-skip-tutorial")!.click(); await settle();
    expect(f.document.querySelector(".onboarding-name")).toBeNull();
    expect(f.complete).not.toHaveBeenCalled();
    f.setChosenName(true); resolveName(); await settle();
    expect(f.setName).not.toHaveBeenCalled();
    expect(f.finish).toHaveBeenCalledOnce();
  });
  it("does not finish onboarding for a different account after waiting on a rename", async () => {
    const f = fixture(S.profile);
    let resolveName!: () => void;
    f.waitForNameSave.mockImplementationOnce(() => new Promise<void>(resolve => { resolveName = resolve; }));
    f.document.querySelector<HTMLButtonElement>(".onboarding-skip-tutorial")!.click(); await settle();
    f.setIdentity("other"); resolveName(); await settle();
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.setName).not.toHaveBeenCalled();
  });
  it("does not restart a lesson when its pending acknowledgement arrives after Skip", async () => {
    const f = fixture(S.spitter);
    let acknowledge!: () => void;
    const complete = f.complete.getMockImplementation()!;
    f.complete.mockImplementationOnce(async next => {
      await new Promise<void>(resolve => { acknowledge = resolve; });
      return complete(next);
    });
    f.scene.enemyDefeated();
    f.document.querySelector<HTMLButtonElement>(".onboarding-skip-tutorial")!.click();
    acknowledge(); await settle(); f.advanceTime(10);
    expect(f.document.querySelector(".onboarding-name")).not.toBeNull();
    expect(f.enemies).toHaveLength(0);
    expect(f.logPickup).not.toHaveBeenCalled();
    f.document.querySelector<HTMLButtonElement>(".onboarding-skip")!.click(); await settle();
    expect(f.finish).toHaveBeenCalledOnce();
  });
  it("keeps movement input while a lesson acknowledgement is pending", async () => {
    const f = fixture(S.spitter);
    let acknowledge!: () => void;
    const complete = f.complete.getMockImplementation()!;
    f.complete.mockImplementationOnce(async next => {
      await new Promise<void>(resolve => { acknowledge = resolve; });
      return complete(next);
    });
    f.scene.enemyDefeated();
    f.advanceTime(2);
    expect(f.scene.blocksInput()).toBe(false);
    expect(f.clearInput).not.toHaveBeenCalled();
    expect(f.enemies).toHaveLength(0);
    expect(f.player.damage).toBe(3);
    acknowledge(); await settle();
    expect(f.player.damage).toBe(4);
    expect(f.scene.blocksInput()).toBe(false);
    expect(f.clearInput).not.toHaveBeenCalled();
  });
  it("waits on failed acknowledgements and resumes without duplicate rewards", async () => {
    const f = fixture(S.spitter);
    f.complete.mockResolvedValueOnce({ ok: false });
    f.scene.enemyDefeated(); await settle();
    expect(f.player.damage).toBe(3);
    f.advanceTime(20); expect(f.enemies).toHaveLength(0);
    f.document.querySelector<HTMLButtonElement>(".onboarding-tutorial button")!.click(); await settle();
    expect(f.player.damage).toBe(4);
    expect(f.logPickup).toHaveBeenCalledOnce();
    f.advanceTime(3.1); expect(f.enemies[0].type).toBe("Brood");
  });
  it("pauses the death lesson offline and cleans up if the account changes", () => {
    const f = fixture(S.death);
    f.scene.died(); f.setConnected(false); f.advanceTime(20);
    expect(f.respawn).not.toHaveBeenCalled();
    f.setConnected(true); f.advanceUntil(() => f.respawn.mock.calls.length > 0);
    expect(f.respawn).toHaveBeenCalledOnce();
    f.setIdentity("other"); f.scene.update(1 / 60);
    expect(f.scene.isActive()).toBe(false);
    expect(f.enemies).toHaveLength(0);
    expect(f.finish).not.toHaveBeenCalled();
  });
});
