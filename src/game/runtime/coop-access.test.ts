import { describe, expect, it } from "vitest";
import { DEFAULT_SKIN_TONE } from "../player-appearance";
import { createCoopAccess, type CoopClient } from "./coop-access";

describe("coop access", () => {
  it("shows the offline defaults when there is no coop client", () => {
    const coop = createCoopAccess(null);

    expect(coop.localIdentity()).toBeUndefined();
    expect(coop.identity()).toBe("");
    expect(coop.isLocal(undefined)).toBe(true);
    expect(coop.connected()).toBe(false);
    expect(coop.gemBalance()).toBe(0n);
    expect(coop.prestigeLevel()).toBe(0);
    expect(coop.prestigePerk("riposte")).toBe(0);
    expect(coop.itemLevel("bow")).toBe(0);
    expect(coop.remotePlayers()).toEqual([]);
    expect(coop.profileIcon()).toBe(0);
    expect(coop.skinTone()).toBe(DEFAULT_SKIN_TONE);
    expect(coop.isGuest()).toBe(false);
    expect(coop.serverNowMs()).toBeGreaterThan(0);
  });

  it("reads the client when it has one", () => {
    const client = {
      localIdentity: () => "me",
      isConnected: () => true,
      gemBalance: () => 12n,
      prestige: () => ({ level: 3 }),
      serverNowMs: () => 42,
      skinTone: (identity?: string) => identity === "other" ? 4 : 2,
    } as unknown as CoopClient;
    const coop = createCoopAccess(client);

    expect(coop.identity()).toBe("me");
    expect(coop.isLocal("me")).toBe(true);
    expect(coop.isLocal("other")).toBe(false);
    expect(coop.connected()).toBe(true);
    expect(coop.gemBalance()).toBe(12n);
    expect(coop.prestigeLevel()).toBe(3);
    expect(coop.serverNowMs()).toBe(42);
    expect(coop.skinTone("other")).toBe(4);
    expect(coop.skinTone()).toBe(2);
  });
});
