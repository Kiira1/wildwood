import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { AGE_BAND_ADULT, TERMS_VERSION } from "../../shared/legal";
import { mergeOnboarding } from "./onboarding";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

describe("new character tutorial", () => {
  it("enrolls only a completely new character and keeps them hidden until the final step", () => {
    const f = crystalFixture();
    f.db.playerProgress.identity.delete(f.ctx.sender);
    f.db.playerProfile.identity.delete(f.ctx.sender);
    f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
    f.run(server.enterWorldWithTutorial, { forceTakeover: false, tabId: "tutorial-test" });
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender)?.step).toBe(1);
    expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(false);
    f.run(server.setMultiplayerEnabled, { enabled: true });
    expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(false);
    const initial = progressOf(f, f.ctx.sender);
    expect(initial.damage).toBe(3);
    expect(() => f.run(server.completeOnboardingStep, { step: 4 })).toThrow("current tutorial step");
    // Move leads straight to the first enemy; the portrait lesson (2) is retired.
    for (const step of [3, 4, 4, 5, 5]) f.run(server.completeOnboardingStep, { step });
    expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(false);
    const rewarded = progressOf(f, f.ctx.sender);
    expect(rewarded.damage).toBe(initial.damage + 1);
    expect(rewarded.regen).toBeCloseTo(initial.regen + .2);
    f.run(server.completeOnboardingStep, { step: 6 });
    expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(true);
    expect(progressOf(f, f.ctx.sender).introComplete).toBe(true);
  });
  it.each([1, 3, 4, 5])("allows skipping from lesson %s without adding unearned rewards", step => {
    const f = crystalFixture();
    f.db.playerProgress.identity.delete(f.ctx.sender);
    f.db.playerProfile.identity.delete(f.ctx.sender);
    f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
    f.run(server.enterWorldWithTutorial, { forceTakeover: false, tabId: "skip-test" });
    for (let next = 3; next <= step; next++) f.run(server.completeOnboardingStep, { step: next });
    const earned = progressOf(f, f.ctx.sender);
    f.run(server.completeOnboardingStep, { step: 6 });
    f.run(server.completeOnboardingStep, { step: 6 });
    expect(progressOf(f, f.ctx.sender)).toMatchObject({ damage: earned.damage, regen: earned.regen, introComplete: true });
    expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(false);
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender).step).toBe(6);
  });
  it("accepts the retired portrait step from an old tab after Move, then the first enemy", () => {
    const f = crystalFixture();
    f.seed("playerOnboarding", { identity: f.ctx.sender, step: 1 });
    const before = progressOf(f, f.ctx.sender);
    f.run(server.completeOnboardingStep, { step: 2 });
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender)?.step).toBe(2);
    f.run(server.completeOnboardingStep, { step: 3 });
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender)?.step).toBe(3);
    expect(progressOf(f, f.ctx.sender)).toMatchObject({ damage: before.damage, regen: before.regen });
  });
  it("lets a character saved on the retired step finish the first enemy, and refuses skipping past it", () => {
    const f = crystalFixture();
    f.seed("playerOnboarding", { identity: f.ctx.sender, step: 2 });
    const before = progressOf(f, f.ctx.sender);
    expect(() => f.run(server.completeOnboardingStep, { step: 5 })).toThrow("current tutorial step");
    f.run(server.completeOnboardingStep, { step: 4 });
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender)?.step).toBe(4);
    expect(progressOf(f, f.ctx.sender).damage).toBe(before.damage + 1);
  });
  it("refuses the retired step once past Move", () => {
    const f = crystalFixture();
    f.seed("playerOnboarding", { identity: f.ctx.sender, step: 3 });
    f.run(server.completeOnboardingStep, { step: 2 });
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender)?.step).toBe(3);
    expect(() => f.run(server.completeOnboardingStep, { step: 5 })).toThrow("current tutorial step");
  });
  it("starts a brand-new character in the Tutorial Forest, not the Town", () => {
    const f = crystalFixture();
    f.db.player.identity.delete(f.ctx.sender);
    f.db.playerProgress.identity.delete(f.ctx.sender);
    f.db.playerProfile.identity.delete(f.ctx.sender);
    if (f.db.playerLastLocation?.identity.find(f.ctx.sender)) f.db.playerLastLocation.identity.delete(f.ctx.sender);
    f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
    f.run(server.enterWorldWithTutorial, { forceTakeover: false, tabId: "new-forest" });
    expect(f.db.player.identity.find(f.ctx.sender)?.mapId).toBe("tutorial_forest");
  });
  it("does not enroll existing players, including players missing legacy progress", () => {
    const f = crystalFixture();
    f.db.playerProgress.identity.delete(f.ctx.sender);
    f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
    f.run(server.enterWorldWithTutorial, { forceTakeover: false, tabId: "existing" });
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender)).toBeNull();
    expect(() => f.run(server.completeOnboardingStep, { step: 2 })).toThrow("does not need");
  });
  it("marks a pre-tutorial character's replay complete at its end, with no rewards", () => {
    const f = crystalFixture();
    const before = progressOf(f, f.ctx.sender);
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender)).toBeNull();
    f.run(server.completeOnboardingStep, { step: 6 });
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender)?.step).toBe(6);
    // Replaying again later changes nothing.
    for (const step of [2, 4, 5, 6]) f.run(server.completeOnboardingStep, { step });
    expect(progressOf(f, f.ctx.sender)).toMatchObject({ damage: before.damage, regen: before.regen });
  });
  it("preserves an unfinished guest lesson when linked, and skips for older guests", () => {
    const f = crystalFixture(), account = identity("2");
    f.seed("playerOnboarding", { identity: f.ctx.sender, step: 4 });
    f.seed("playerOnboarding", { identity: account, step: 1 });
    mergeOnboarding(f.ctx as any, f.ctx.sender, account);
    expect(f.db.playerOnboarding.identity.find(account)?.step).toBe(4);
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender)).toBeNull();
    mergeOnboarding(f.ctx as any, identity("3"), account);
    expect(f.db.playerOnboarding.identity.find(account)).toBeNull();
  });
});

it("keeps multiplayer off by default and skips old-client lessons without unearned rewards", () => {
  const f = crystalFixture();
  f.db.playerProgress.identity.delete(f.ctx.sender); f.db.playerProfile.identity.delete(f.ctx.sender);
  f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
  f.run(server.enterWorld, { tabId: "old-mobile-test" });
  expect(f.db.playerOnboarding.identity.find(f.ctx.sender)).toBeNull();
  expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(false);
  f.seed("playerOnboarding", { identity: f.ctx.sender, step: 3 });
  const before = progressOf(f, f.ctx.sender);
  f.run(server.enterWorld, { tabId: "old-mobile-test" });
  expect(f.db.playerOnboarding.identity.find(f.ctx.sender).step).toBe(6);
  expect(progressOf(f, f.ctx.sender)).toMatchObject({ damage: before.damage, regen: before.regen, introComplete: true });
  expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(false);
});
