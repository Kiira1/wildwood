import { describe, expect, it, vi } from "vitest";
import {
  AGE_BAND_ADULT,
  AGE_BAND_TEEN,
  AGE_BAND_UNDER_13,
  AGE_BAND_UNVERIFIED,
  TERMS_VERSION,
  playerAgeBand,
} from "../../../shared/legal";
import { createLegalConsentService, legalConsentInternals } from "./legal-consent-service";

describe("legal consent", () => {
  it("classifies ages without retaining an exact birthday", () => {
    expect(() => playerAgeBand(0)).toThrow();
    expect(playerAgeBand(12)).toBe(0);
    expect(playerAgeBand(13)).toBe(AGE_BAND_TEEN);
    expect(playerAgeBand(17)).toBe(AGE_BAND_TEEN);
    expect(playerAgeBand(18)).toBe(AGE_BAND_ADULT);
  });

  it("ignores stale or malformed stored acceptance", () => {
    expect(legalConsentInternals.parseStoredConsent("not json")).toBeNull();
    expect(legalConsentInternals.parseStoredConsent(JSON.stringify({ termsVersion: "old", ageBand: 2 }))).toBeNull();
    expect(legalConsentInternals.parseStoredConsent(JSON.stringify({ termsVersion: TERMS_VERSION, ageBand: 7 }))).toBeNull();
  });

  it("agrees to the Terms on the start screen without asking the age; chat asks it later", async () => {
    const acceptTerms = vi.fn(async () => undefined);
    const values = new Map<string, string>();
    const service = createLegalConsentService({
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } },
      storageKey: "legal",
      connection: () => ({ isActive: true, reducers: { acceptTerms } } as never),
      protocolReady: () => true,
      shouldEnterWorld: () => false,
      requestWorldEntry: vi.fn(async () => true),
      notify: vi.fn(),
      handleFailure: vi.fn(),
    });
    await expect(service.acceptTerms()).resolves.toMatchObject({ ok: true });
    expect(acceptTerms).toHaveBeenLastCalledWith({ termsVersion: TERMS_VERSION, ageBand: AGE_BAND_UNVERIFIED });
    expect([service.accepted(), service.ageVerified()]).toEqual([true, false]);
    await expect(service.verifyAge(15)).resolves.toMatchObject({ ok: true });
    expect(acceptTerms).toHaveBeenLastCalledWith({ termsVersion: TERMS_VERSION, ageBand: AGE_BAND_TEEN });
    expect(service.ageVerified()).toBe(true);
    // Agreeing again keeps the age it was given.
    await service.acceptTerms();
    expect(acceptTerms).toHaveBeenLastCalledWith({ termsVersion: TERMS_VERSION, ageBand: AGE_BAND_TEEN });
  });

  it("blocks under-13 selection before any server call", async () => {
    const reducers = { acceptTerms: vi.fn() };
    const values = new Map<string, string>();
    const service = createLegalConsentService({
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
      },
      storageKey: "legal",
      connection: () => ({ isActive: true, reducers } as never),
      protocolReady: () => true,
      shouldEnterWorld: () => true,
      requestWorldEntry: vi.fn(async () => true),
      notify: vi.fn(),
      handleFailure: vi.fn(),
    });

    await expect(service.verifyAge(12)).resolves.toMatchObject({ ok: false, blocked: true });
    expect(reducers.acceptTerms).not.toHaveBeenCalled();
    // Kept on this device so the game stays blocked, as the start screen's answer used to.
    expect(JSON.parse(values.get("legal")!)).toEqual({ termsVersion: TERMS_VERSION, ageBand: AGE_BAND_UNDER_13 });
    expect([service.accepted(), service.ageBlocked()]).toEqual([false, true]);
    await expect(service.acceptTerms()).resolves.toMatchObject({ ok: false });
    expect(reducers.acceptTerms).not.toHaveBeenCalled();
  });

  it("takes the account's own answer from the server instead of asking again", async () => {
    // The same account on a second device has no local cache, but the row it
    // already agreed to is right there on the server.
    const acceptTerms = vi.fn();
    const values = new Map<string, string>();
    const row = { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT };
    const connection = {
      isActive: true,
      reducers: { acceptTerms },
      db: { myLegalConsent: { iter: () => [row], onInsert: vi.fn(), onUpdate: vi.fn() } },
    } as never;
    const service = createLegalConsentService({
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } },
      storageKey: "legal",
      connection: () => connection,
      protocolReady: () => true,
      shouldEnterWorld: () => true,
      requestWorldEntry: vi.fn(async () => true),
      notify: vi.fn(),
      handleFailure: vi.fn(),
    });

    expect(service.accepted()).toBe(false);
    await service.syncConnection(connection);

    expect(service.accepted()).toBe(true);
    // Adopting the account's answer must not echo it back as a new acceptance.
    expect(acceptTerms).not.toHaveBeenCalled();
    expect(JSON.parse(values.get("legal")!)).toEqual(row);
  });

  it("ignores a server row for terms the player has not seen", async () => {
    const values = new Map<string, string>();
    const connection = {
      isActive: true,
      reducers: { acceptTerms: vi.fn() },
      db: { myLegalConsent: { iter: () => [{ termsVersion: "old", ageBand: AGE_BAND_TEEN }], onInsert: vi.fn(), onUpdate: vi.fn() } },
    } as never;
    const service = createLegalConsentService({
      storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } },
      storageKey: "legal",
      connection: () => connection,
      protocolReady: () => true,
      shouldEnterWorld: () => true,
      requestWorldEntry: vi.fn(async () => true),
      notify: vi.fn(),
      handleFailure: vi.fn(),
    });

    await service.syncConnection(connection);
    expect(service.accepted()).toBe(false);
  });
});
