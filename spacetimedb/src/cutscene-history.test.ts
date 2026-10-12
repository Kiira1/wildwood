import { existsSync } from "node:fs";
import { ConnectionId } from "spacetimedb";
import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { PORTAL_CUTSCENES, portalCutsceneBit } from "../../shared/portal-cutscenes";
import { TERMS_VERSION } from "../../shared/legal";
import { ATTACK_BALANCE_VERSION, BOSS_REWARD_CLAIM_BITS, SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
const DRAGON = PORTAL_CUTSCENES[0].id;     // unlocked by desertUnlocked
const SNOW = PORTAL_CUTSCENES[1].id;       // unlocked by snowlandsUnlocked
const history = (f: Fixture, who = f.ctx.sender) => f.db.playerCutsceneHistory.identity.find(who) ?? null;
const see = (f: Fixture, cutscene: string, generation = 0) => f.run(server.markPortalCutsceneSeen, { cutscene, generation });
const enter = (f: Fixture) => {
  f.seed("playerLegalConsent", { identity: f.ctx.sender, termsVersion: TERMS_VERSION, ageBand: 2, acceptedAt: f.ctx.timestamp });
  f.run(server.enterWorld, { tabId: "cutscenes" });
};

describe("server-owned cutscene history", () => {
  it("is private, and the view shows a player only their own row", () => {
    expect(existsSync(new URL("../../src/module_bindings/player_cutscene_history_table.ts", import.meta.url))).toBe(false);
    const f = crystalFixture();
    f.seed("playerCutsceneHistory", { identity: f.ctx.sender, seenMask: 1, generation: 0 });
    f.seed("playerCutsceneHistory", { identity: identity("2"), seenMask: 3, generation: 0 });
    expect((server.myCutsceneHistory as any)({ db: f.db, sender: f.ctx.sender })).toEqual([{ identity: f.ctx.sender, seenMask: 1, generation: 0 }]);
  });

  it("marks only an unlocked portal's cutscene, from the controlling tab, for the current character", () => {
    const f = crystalFixture();
    f.patch("playerProgress", { desertUnlocked: true });
    f.seed("playerCutsceneHistory", { identity: f.ctx.sender, seenMask: 0, generation: 2 });
    expect(() => see(f, "no-such-cutscene", 2)).toThrow("Unknown portal cutscene");
    expect(() => see(f, SNOW, 2)).toThrow("Portal not unlocked");
    expect(() => see(f, DRAGON, 1)).toThrow("Character history was reset");
    f.patch("playerController", { connectionId: new ConnectionId(9n) });
    expect(() => see(f, DRAGON, 2)).toThrow("active in another tab");
    f.patch("playerController", { connectionId: f.ctx.connectionId });
    see(f, DRAGON, 2);
    see(f, DRAGON, 2);
    expect(history(f)).toMatchObject({ seenMask: portalCutsceneBit(DRAGON), generation: 2 });
  });

  it("counts portals already unlocked as seen when the row is first made, and never again", () => {
    const f = crystalFixture();
    f.patch("playerProgress", { desertUnlocked: true, snowlandsUnlocked: true });
    enter(f);
    expect(history(f)?.seenMask).toBe(portalCutsceneBit(DRAGON) | portalCutsceneBit(SNOW));
    // A row that already exists is never re-derived from progress.
    const kept = crystalFixture();
    kept.patch("playerProgress", { desertUnlocked: true });
    kept.seed("playerCutsceneHistory", { identity: kept.ctx.sender, seenMask: 0, generation: 0 });
    enter(kept);
    expect(history(kept)?.seenMask).toBe(0);
  });

  it("merges a guest's history into the account it links into and drops the guest row", () => {
    const f = crystalFixture();
    const guest = identity("2");
    f.db.playerProgress.identity.delete(f.ctx.sender);
    f.progress(guest);
    f.seed("playerBalanceVersion", { identity: guest, version: ATTACK_BALANCE_VERSION });
    f.seed("playerCutsceneHistory", { identity: guest, seenMask: portalCutsceneBit(SNOW), generation: 0 });
    f.seed("playerCutsceneHistory", { identity: f.ctx.sender, seenMask: portalCutsceneBit(DRAGON), generation: 0 });
    f.seed("accountLink", { code: "cutscene-link", guest, createdAt: f.ctx.timestamp });
    f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
    f.run(server.claimGuestAccount, { code: "cutscene-link" });
    expect(history(f)?.seenMask).toBe(portalCutsceneBit(DRAGON) | portalCutsceneBit(SNOW));
    expect(history(f, guest)).toBeNull();
  });

  it("clears with a progress reset and with a prestige, and starts a new generation each time", () => {
    const f = crystalFixture();
    f.seed("playerCutsceneHistory", { identity: f.ctx.sender, seenMask: 3, generation: 0 });
    f.run(server.resetPlayerProgress, {});
    expect(history(f)).toMatchObject({ seenMask: 0, generation: 1 });
    f.db.playerCutsceneHistory.identity.update({ ...history(f), seenMask: 3 });
    f.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
    f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 1 });
    f.run(server.prestigeAccount, {});
    expect(history(f)).toMatchObject({ seenMask: 0, generation: 2 });
  });
});
