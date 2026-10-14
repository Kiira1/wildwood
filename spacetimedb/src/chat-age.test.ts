import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { AGE_BAND_ADULT, AGE_BAND_UNDER_13, AGE_BAND_UNVERIFIED, CHAT_AGE_REQUIRED, TERMS_VERSION } from "../../shared/legal";
import { requireCurrentLegalConsent } from "./session-guards";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

// The start screen agrees to the Terms with the age unverified; chat asks the age.
const consent = (f: ReturnType<typeof crystalFixture>) => f.db.playerLegalConsent.identity.find(f.ctx.sender);

it("lets a player in on the Terms alone, but keeps chat closed until a 13+ age is given", () => {
  const f = crystalFixture();
  f.db.playerLegalConsent.identity.delete(f.ctx.sender);
  f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_UNVERIFIED });
  expect(consent(f)?.ageBand).toBe(AGE_BAND_UNVERIFIED);
  expect(() => requireCurrentLegalConsent(f.ctx)).not.toThrow();
  expect(() => f.run(server.sendChatMessage, { message: "hello" })).toThrow(CHAT_AGE_REQUIRED);
  expect(() => f.run(server.sendSocialMessage, { channel: "guild", target: "", message: "hi", replyToMessageId: 0n })).toThrow(CHAT_AGE_REQUIRED);
  f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
  expect(() => f.run(server.sendChatMessage, { message: "hello" })).not.toThrow(CHAT_AGE_REQUIRED);
});

it("never forgets a given age when the Terms are agreed again, and never takes under 13", () => {
  const f = crystalFixture();
  f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
  f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_UNVERIFIED });
  expect(consent(f)?.ageBand).toBe(AGE_BAND_ADULT);
  expect(() => f.run(server.acceptTerms, { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_UNDER_13 })).toThrow("13 and older");
  expect(consent(f)?.ageBand).toBe(AGE_BAND_ADULT);
});
