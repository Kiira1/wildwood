import { describe, expect, it, vi } from "vitest";
import { bootGame, gameWorld, type GameTab } from "./harness/game";
import { tapSelector } from "./harness/farm";
import type { ScenarioWorld } from "./harness/server";

// The tutorial as a new guest plays it: the booted game against the real server.
vi.setConfig({ testTimeout: 90_000 });

/** The one guest a fresh world has, as the server keeps them. */
function guest(world: ScenarioWorld) {
  const row = (table: string) => [...world.db[table].iter()][0] as Record<string, any> | undefined;
  return {
    step: () => row("playerOnboarding")?.step as number | undefined,
    progress: () => row("playerProgress")!,
    player: () => row("player")!,
  };
}

/** The lesson card on screen: its Retry shown, or not. */
const lessonRetry = (tab: GameTab) => tab.document.querySelector<HTMLElement>(".onboarding-tutorial header button");
const nameForm = (tab: GameTab) => tab.shown("onboardingUsername");

/** A new visitor: the page boots, Play under the Terms, and the first lesson. */
async function newGuest(world: ScenarioWorld) {
  const tab = await bootGame(world);
  await tab.acceptTerms();
  if (!await tab.until(() => tab.document.querySelector(".onboarding-tutorial") !== null && !tab.shown("start"), 10_000)) throw new Error("The tutorial never started");
  return tab;
}

/** Types a name into the tutorial's name form and continues. */
function chooseName(tab: GameTab, name: string) {
  const input = tab.element("onboardingUsername") as HTMLInputElement;
  input.value = name;
  input.closest("form")!.dispatchEvent(new (tab.window as any).Event("submit", { bubbles: true, cancelable: true }));
}

describe("A new guest's tutorial (TUT-01, TUT-02)", () => {
  it("starts hidden in the forest with the new-player settings, and pays each lesson once through a failed save and a reload", async () => {
    const world = gameWorld();
    const ann = guest(world);
    let tab = await newGuest(world);
    // Enrolled and hidden in the Tutorial Forest; the attack range ring starts off for a new player.
    expect(ann.step()).toBe(1);
    expect(ann.player()).toMatchObject({ mapId: "tutorial_forest", isVisible: false });
    expect(tab.element("attackRangeToggle").getAttribute("aria-pressed")).toBe("false");
    const start = { ...ann.progress() };

    // Move: a few steps finish the first lesson.
    await tab.hold("KeyW", 600);
    expect(await tab.until(() => ann.step() === 3, 3_000)).toBe(true);

    // The first enemy falls while the network has stalled; the socket then drops, and the save fails.
    const stalled = tab.connection()!;
    stalled.fake.setHold(true);
    await tab.play(10_000);
    expect(ann.step()).toBe(3);
    stalled.fake.drop(new Error("network"));
    stalled.fake.release();
    await tab.play(1_000);
    expect(lessonRetry(tab)?.hidden).toBe(false);
    expect(ann.progress().damage).toBe(start.damage);
    // Back online, the lesson's Retry saves it: the reward is paid once.
    await tab.until(() => !tab.shown("reconnectOverlay"), 20_000);
    await tab.play(2_000);
    tapSelector(tab, ".onboarding-tutorial header button");
    expect(await tab.until(() => ann.step() === 4, 5_000)).toBe(true);
    expect(ann.progress().damage).toBe(start.damage + 1);

    // A reload in the middle of the second lesson picks it up where it was.
    await tab.play(2_000);
    tab = await tab.reload();
    // The lesson is back, its enemy with it: the player walks up to it.
    await tab.play(1_000);
    expect(tab.shown("start")).toBe(false);
    await tab.hold("KeyW", 800);
    expect(await tab.until(() => ann.step() === 5, 30_000)).toBe(true);
    expect(ann.progress().damage).toBe(start.damage + 1);
    expect(ann.progress().regen).toBeCloseTo(start.regen + .2);

    // The death lesson, then the name: the tutorial is done and the player shows.
    expect(await tab.until(() => nameForm(tab), 30_000)).toBe(true);
    chooseName(tab, "Annabel");
    expect(await tab.until(() => ann.step() === 6, 5_000)).toBe(true);
    await tab.play(2_000);
    expect(ann.progress()).toMatchObject({ damage: start.damage + 1, introComplete: true });
    expect(ann.progress().regen).toBeCloseTo(start.regen + .2);
    expect(ann.player().isVisible).toBe(true);
    expect(world.db.playerProfile.iter().next().value.displayName).toBe("Annabel");
  });
});
