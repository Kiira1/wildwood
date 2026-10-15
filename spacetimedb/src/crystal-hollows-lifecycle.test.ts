import { describe, expect, it, vi } from "vitest";
import { Identity } from "spacetimedb";
import { ATTACK_BALANCE_VERSION, SPACETIME_AUTH_ISSUER, SPACETIME_AUTH_CLIENT_ID } from "../../shared/rules";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";

vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

describe("Crystal Hollows unlock and identity lifecycle", () => {
  it("transfers a guest unlock without leaving a second save", () => {
    const f = crystalFixture();
    const guest = identity("2");
    f.db.playerProgress.identity.delete(f.ctx.sender); // Fresh authenticated account.
    f.progress(guest, { crystalHollowsUnlocked: true });
    f.seed("playerBalanceVersion", { identity: guest, version: ATTACK_BALANCE_VERSION });
    f.seed("accountLink", { code: "test-link", guest, createdAt: f.ctx.timestamp });
    f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
    f.run(server.claimGuestAccount, { code: "test-link" });
    expect(f.db.playerProgress.identity.find(f.ctx.sender).crystalHollowsUnlocked).toBe(true);
    expect(f.db.playerProgress.identity.find(guest)).toBeNull();
    expect(f.db.accountLink.code.find("test-link")).toBeNull();
  });

  it.each([false, true])("keeps a generated-name guest's skin when registering (account profile exists: %s)", (hasProfile) => {
    const f = crystalFixture(), guest = identity("2");
    f.db.playerProgress.identity.delete(f.ctx.sender);
    if (hasProfile) f.patch("playerProfile", { displayName: "Lucky Moth 378", skinTone: 3 });
    else f.db.playerProfile.identity.delete(f.ctx.sender);
    f.progress(guest);
    f.seed("playerProfile", { identity: guest, displayName: "Lucky Moth 379", skinTone: 17 });
    f.seed("accountLink", { code: "skin-link", guest, createdAt: f.ctx.timestamp });
    f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
    f.run(server.claimGuestAccount, { code: "skin-link" });
    expect(f.db.playerProfile.identity.find(f.ctx.sender).skinTone).toBe(17);
  });

  it("removes a virtual player's save on last disconnect", () => {
    const f = crystalFixture();
    const peer = identity("2");
    f.seed("virtualPlayer", { identity: f.ctx.sender, owner: peer, mapId: "crystal_hollows", createdAt: f.ctx.timestamp });
    f.run(server.onDisconnect);
    expect(f.db.playerProgress.identity.find(f.ctx.sender)).toBeNull();
  });

  it("guards complete legacy-player removal", () => {
    const f = crystalFixture();
    const target = identity("2");
    f.progress(target, { maxHp: 10, damage: 1 });
    f.seed("playerProfile", { identity: target, displayName: "Legacy" });
    f.seed("leaderboardEntry", { identity: target, displayName: "Legacy", powerLevel: 11, isGuest: false });
    const remove = () => f.run(server.devDeleteLegacyPlayer, { identity: target, expectedDisplayName: "Legacy" });
    expect(remove).toThrow("Developer access required");
    // Public owner identifier in the module, used only with an in-memory DB.
    f.ctx.sender = new Identity("c200383520521c925f3cf6deafb20cd6a7d6168d1c31cb3c0ddb731c197a2d79");
    remove();
    expect(f.db.playerProgress.identity.find(target)).toBeNull();
    expect(f.db.playerProgress.identity.find(identity("1"))).not.toBeNull();
  });
});
