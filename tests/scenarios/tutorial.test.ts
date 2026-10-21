import { describe, expect, it, vi } from "vitest";
import { scenarioWorld } from "./harness/server";
import { AGE_BAND_ADULT, TERMS_VERSION } from "../../shared/legal";

// The new-character tutorial on the server: who is enrolled, what each lesson pays, and what a link keeps.
vi.setConfig({ testTimeout: 60_000 });

describe("Enrolment (TUT-01)", () => {
  it("a brand-new character starts the tutorial hidden in the Tutorial Forest; a returning one is never enrolled", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann", { tutorial: true });
    expect(ann.row("playerOnboarding")).toMatchObject({ step: 1 });
    expect(ann.row("player")).toMatchObject({ mapId: "tutorial_forest", isVisible: false });
    // Even with multiplayer switched on, nobody sees a player in their lessons.
    ann.call("setMultiplayerEnabled", { enabled: true });
    expect(ann.row("player").isVisible).toBe(false);
    expect(ann.row("playerMultiplayerPreference")).toMatchObject({ enabled: true });

    // Someone who played before the tutorial existed (no lesson row, a save) is never put in it.
    const old = world.join("Old");
    world.setup(ctx => ctx.db.playerOnboarding.identity.delete(old.identity));
    old.disconnect();
    old.connect();
    old.call("enterWorldWithTutorial", { tabId: `tab-${old.hex.slice(0, 12)}`, forceTakeover: false });
    expect(old.row("playerOnboarding")).toBeFalsy();
    expect(old.refusal("completeOnboardingStep", { step: 3 })).toMatch(/./);
  });

  it("a new character on an app too old for the lessons skips them, with nothing unearned", () => {
    const world = scenarioWorld();
    const ann = world.player("Ann").connect();
    ann.call("acceptTerms", { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
    ann.call("enterWorld", { tabId: `tab-${ann.hex.slice(0, 12)}` });
    expect(ann.row("playerOnboarding")).toBeFalsy();
    expect(ann.row("player").isVisible).toBe(false);
    const before = ann.progress()!;
    // Saved mid-lesson by a newer tab, then back on the old app: the lessons are marked done, paying nothing.
    world.setup(ctx => ctx.db.playerOnboarding.insert({ identity: ann.identity, step: 3 }));
    ann.call("enterWorld", { tabId: `tab-${ann.hex.slice(0, 12)}` });
    expect(ann.row("playerOnboarding")).toMatchObject({ step: 6 });
    expect(ann.progress()).toMatchObject({ damage: before.damage, regen: before.regen, introComplete: true });
  });
});

describe("Lessons on the server (TUT-02, TUT-03, TUT-05)", () => {
  it("pays each lesson once, in order, whatever is sent twice or out of turn; the last step shows a player with multiplayer on", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann", { tutorial: true });
    const start = ann.progress()!;
    ann.call("setMultiplayerEnabled", { enabled: true });
    expect(ann.refusal("completeOnboardingStep", { step: 4 })).toMatch(/./);
    // Move, then the first enemy twice (a retried acknowledgement), then the second twice.
    for (const step of [3, 4, 4, 5, 5]) ann.call("completeOnboardingStep", { step });
    expect(ann.progress()).toMatchObject({ damage: start.damage + 1 });
    expect(ann.progress()!.regen).toBeCloseTo(start.regen + .2);
    expect(ann.row("player").isVisible).toBe(false);
    ann.call("completeOnboardingStep", { step: 6 });
    ann.call("completeOnboardingStep", { step: 6 });
    expect(ann.progress()).toMatchObject({ damage: start.damage + 1, introComplete: true });
    expect(ann.row("player").isVisible).toBe(true);
  });

  it("a skip from any lesson ends on the same stats as finishing, paying each lesson once", () => {
    for (const lesson of [1, 3, 4, 5]) {
      const world = scenarioWorld();
      const ann = world.join("Ann", { tutorial: true });
      const start = ann.progress()!;
      for (let next = 3; next <= lesson; next++) ann.call("completeOnboardingStep", { step: next });
      ann.call("completeOnboardingStep", { step: 6 });
      ann.call("completeOnboardingStep", { step: 6 });
      expect(ann.progress()).toMatchObject({ damage: start.damage + 1, introComplete: true });
      expect(ann.progress()!.regen).toBeCloseTo(start.regen + .2);
      expect(ann.row("playerOnboarding")).toMatchObject({ step: 6 });
    }
  });

  it("a player from before the tutorial replays it for nothing, and is marked done at its end", () => {
    const world = scenarioWorld();
    const old = world.join("Old");
    world.setup(ctx => ctx.db.playerOnboarding.identity.delete(old.identity));
    const before = old.progress()!;
    old.call("completeOnboardingStep", { step: 6 });
    expect(old.row("playerOnboarding")).toMatchObject({ step: 6 });
    for (const step of [2, 4, 5, 6]) old.refusal("completeOnboardingStep", { step });
    expect(old.progress()).toMatchObject({ damage: before.damage, regen: before.regen });
  });

  it("an old tab's retired portrait lesson is taken after Move and moves on to the first enemy, never past it", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann", { tutorial: true });
    const start = ann.progress()!;
    ann.call("completeOnboardingStep", { step: 2 });
    expect(ann.row("playerOnboarding")).toMatchObject({ step: 2 });
    expect(ann.refusal("completeOnboardingStep", { step: 5 })).toMatch(/./);
    ann.call("completeOnboardingStep", { step: 4 });
    expect(ann.progress()!.damage).toBe(start.damage + 1);
    // Past Move, the retired lesson changes nothing.
    ann.call("completeOnboardingStep", { step: 2 });
    expect(ann.row("playerOnboarding")).toMatchObject({ step: 4 });
  });

  it("a guest's unfinished lesson carries into the account it links to; an older guest's link leaves no lesson", () => {
    const world = scenarioWorld();
    const guest = world.join("Guest", { tutorial: true });
    for (const step of [3, 4]) guest.call("completeOnboardingStep", { step });
    const account = world.join("Account", { kind: "account", tutorial: true });
    expect(account.row("playerOnboarding")).toMatchObject({ step: 1 });
    const code = "g".repeat(40);
    guest.call("beginAccountLink", { code });
    account.call("claimGuestAccount", { code });
    expect(account.row("playerOnboarding")).toMatchObject({ step: 4 });
    expect(guest.row("playerOnboarding")).toBeFalsy();

    // A guest from before the tutorial: the account it links into is not sent through lessons.
    const veteran = world.join("Veteran");
    world.setup(ctx => ctx.db.playerOnboarding.identity.delete(veteran.identity));
    const fresh = world.join("Fresh", { kind: "account", tutorial: true });
    const second = "h".repeat(40);
    veteran.call("beginAccountLink", { code: second });
    fresh.call("claimGuestAccount", { code: second });
    expect(fresh.row("playerOnboarding")).toBeFalsy();
  });
});
