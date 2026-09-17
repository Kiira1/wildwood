import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { AGE_BAND_ADULT, TERMS_VERSION } from "../../shared/legal";
import { mergeOnboarding } from "./onboarding";
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
    const initial = f.db.playerProgress.identity.find(f.ctx.sender);
    expect(initial.damage).toBe(3);
    expect(() => f.run(server.completeOnboardingStep, { step: 4 })).toThrow("current tutorial step");
    for (const step of [2, 3, 4, 4, 5, 5]) f.run(server.completeOnboardingStep, { step });
    expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(false);
    const rewarded = f.db.playerProgress.identity.find(f.ctx.sender);
    expect(rewarded.damage).toBe(initial.damage + 1);
    expect(rewarded.regen).toBeCloseTo(initial.regen + .2);
    f.run(server.completeOnboardingStep, { step: 6 });
    expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(true);
    expect(f.db.playerProgress.identity.find(f.ctx.sender).introComplete).toBe(true);
  });
  it.each([1, 3, 4, 5])("allows skipping from lesson %s without adding unearned rewards", step => {
    const f = crystalFixture();
    f.db.playerProgress.identity.delete(f.ctx.sender);
    f.db.playerProfile.identity.delete(f.ctx.sender);
    f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
    f.run(server.enterWorldWithTutorial, { forceTakeover: false, tabId: "skip-test" });
    for (let next = 2; next <= step; next++) f.run(server.completeOnboardingStep, { step: next });
    const earned = f.db.playerProgress.identity.find(f.ctx.sender);
    f.run(server.completeOnboardingStep, { step: 6 });
    f.run(server.completeOnboardingStep, { step: 6 });
    expect(f.db.playerProgress.identity.find(f.ctx.sender)).toMatchObject({ damage: earned.damage, regen: earned.regen, introComplete: true });
    expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(false);
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender).step).toBe(6);
  });
  it("does not enroll existing players, including players missing legacy progress", () => {
    const f = crystalFixture();
    f.db.playerProgress.identity.delete(f.ctx.sender);
    f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
    f.run(server.enterWorldWithTutorial, { forceTakeover: false, tabId: "existing" });
    expect(f.db.playerOnboarding.identity.find(f.ctx.sender)).toBeNull();
    expect(() => f.run(server.completeOnboardingStep, { step: 2 })).toThrow("does not need");
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
  const before = f.db.playerProgress.identity.find(f.ctx.sender);
  f.run(server.enterWorld, { tabId: "old-mobile-test" });
  expect(f.db.playerOnboarding.identity.find(f.ctx.sender).step).toBe(6);
  expect(f.db.playerProgress.identity.find(f.ctx.sender)).toMatchObject({ damage: before.damage, regen: before.regen, introComplete: true });
  expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(false);
});
