import { afterEach, expect, it, vi } from "vitest";
import { Identity } from "../../tests/helpers/spacetime-memory-db";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { DEVELOPER_IDENTITY } from "../../shared/developer-identity";
import { SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));
afterEach(() => vi.restoreAllMocks());

function capture() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  return { warn, entries: () => warn.mock.calls.map(call => JSON.parse(String(call[1]))) };
}

it("records the actual caller and action while the rejected reducer leaves state unchanged", () => {
  const f = crystalFixture(), log = capture();
  const before = f.db.playerProfile.identity.find(f.ctx.sender);
  expect(() => f.run(server.setDeveloperNameTag, { visible: true })).toThrow("Developer access required.");
  expect(log.entries()).toEqual([{
    event: "privileged_access_denied", action: "set_developer_name_tag",
    identity: f.ctx.sender.toHexString(), displayName: "Test Player",
    connectionId: f.ctx.connectionId!.toHexString(), atMicros: "10000000",
    reason: "Developer access required.",
  }]);
  expect(f.db.playerNameTag.identity.find(f.ctx.sender)).toBeNull();
  expect(f.db.playerProfile.identity.find(f.ctx.sender)).toEqual(before);
  expect(f.db.moderationAction.count()).toBe(0n); // No transaction-dependent audit writes.
});

it("still identifies callers without a character or valid game session", () => {
  const f = crystalFixture(), log = capture();
  f.db.playerProfile.identity.delete(f.ctx.sender);
  f.db.playerSession.connectionId.delete(f.ctx.connectionId);
  f.ctx.connectionId = null;
  expect(() => f.run(server.setDeveloperNameTag, { visible: true })).toThrow();
  expect(log.entries()).toMatchObject([{ identity: f.ctx.sender.toHexString(), displayName: "", connectionId: null,
    action: "set_developer_name_tag" }]);
});

it("records rejected procedures, without leaking caller-supplied requests", () => {
  const f = crystalFixture(), log = capture();
  const ctx = { ...f.ctx, withTx: (fn: any) => f.transaction(() => fn(f.ctx)) };
  expect(() => server.getDeveloperTravelTarget(ctx as any, { query: "private target query" })).toThrow("Developer access");
  expect(log.entries()).toMatchObject([{ action: "get_developer_travel_target", identity: f.ctx.sender.toHexString() }]);
  expect(JSON.stringify(log.entries())).not.toContain("private target query");
});

it("records owner-only denials without recording credentials or configuration", () => {
  const f = crystalFixture(), log = capture();
  expect(() => f.run(server.configurePatreon, { clientId: "private-client", clientSecret: "do-not-log-this-secret",
    campaignId: "123", silverTierId: "1", goldTierId: "2", redirectUri: "private-url" })).toThrow("Database owner required.");
  expect(log.entries()).toMatchObject([{ action: "configure_patreon", identity: f.ctx.sender.toHexString() }]);
  expect(JSON.stringify(log.entries())).not.toMatch(/private-client|do-not-log-this-secret|private-url/);
  expect(f.db.patreonConfig.id.find(0)).toBeNull();
});

it("keeps authorized developer behavior unchanged and creates no denial records", () => {
  const f = crystalFixture(), log = capture(), old = f.ctx.sender, dev = new Identity(DEVELOPER_IDENTITY);
  f.seed("player", { ...f.db.player.identity.find(old), identity: dev });
  f.seed("playerProfile", { ...f.db.playerProfile.identity.find(old), identity: dev });
  f.db.playerSession.connectionId.update({ ...f.db.playerSession.connectionId.find(f.ctx.connectionId), identity: dev });
  f.seed("playerController", { identity: dev, connectionId: f.ctx.connectionId });
  f.ctx.sender = dev;
  f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
  f.run(server.setDeveloperNameTag, { visible: true });
  expect(f.db.playerNameTag.identity.find(dev)?.showDevTag).toBe(true);
  expect(log.warn).not.toHaveBeenCalled();
});
