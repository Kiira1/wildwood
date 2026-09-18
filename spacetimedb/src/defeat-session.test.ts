import { expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER, PROTOCOL_VERSION } from "../../shared/rules";
import { requireAllowedDefeatSession } from "./defeat-session";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const report = { streamId: "enforcement-stream-01", sequence: 1n, mapId: "endless_1", enemies: [{ enemy: "site:0", count: 100 }] };
function fixture(registered = false) {
  const f = crystalFixture();
  f.patch("player", { mapId: report.mapId });
  if (registered) f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID],
    fullPayload: { auth_time: 1, iat: 5 } } } as any;
  return f;
}
it("commits the guest restriction, allowed rewards, receipt and private audit together", () => {
  const f = fixture(); const before = f.db.playerProgress.identity.find(f.ctx.sender);
  f.run(server.recordEnemyDefeats, report);
  expect(f.db.defeatSessionRestriction.identity.find(f.ctx.sender)).toMatchObject({ requireSignIn: false, blockedUntilMicros: 40_000_000n });
  expect(f.db.playerController.identity.find(f.ctx.sender)).toBeNull();
  expect(f.db.player.identity.find(f.ctx.sender)).toBeNull();
  expect(f.db.playerSession.connectionId.find(f.ctx.connectionId).enteredWorld).toBe(false);
  expect(f.db.playerLifetime.identity.find(f.ctx.sender).enemyKills).toBe(91n);
  expect(f.db.playerProgress.identity.find(f.ctx.sender).inventoryJson).toBe(before.inventoryJson);
  expect([...f.db.moderationAction.iter()]).toMatchObject([{ action: "guest_connection_blocked", rule: "enemy_defeat_allowance" }]);
  expect([...f.db.regularEnemyLootCursor.iter()]).toMatchObject([{ sequence: 1n }]);
  expect(() => f.run(server.registerProtocol, { protocolVersion: PROTOCOL_VERSION })).toThrow("DEFEAT_SESSION_COOLDOWN");
  f.ctx.timestamp = new Timestamp(39_999_999n);
  expect(() => requireAllowedDefeatSession(f.ctx as any)).toThrow("DEFEAT_SESSION_COOLDOWN");
  f.ctx.timestamp = new Timestamp(40_000_000n);
  expect(() => f.run(server.registerProtocol, { protocolVersion: PROTOCOL_VERSION })).not.toThrow();
  expect(f.db.playerProgress.identity.find(f.ctx.sender)).not.toBeNull();
});
it("revokes existing and refreshed account tokens, while allowing a later verified authentication", () => {
  const f = fixture(true);
  f.run(server.recordEnemyDefeats, report);
  expect(f.db.defeatSessionRestriction.identity.find(f.ctx.sender).requireSignIn).toBe(true);
  f.ctx.timestamp = new Timestamp(100_000_000n);
  expect(() => f.run(server.registerProtocol, { protocolVersion: PROTOCOL_VERSION })).toThrow("DEFEAT_SESSION_REAUTH");
  (f.ctx.senderAuth.jwt as any).fullPayload.iat = 90; // Refreshed JWT, same authentication.
  expect(() => requireAllowedDefeatSession(f.ctx as any)).toThrow("DEFEAT_SESSION_REAUTH");
  (f.ctx.senderAuth.jwt as any).fullPayload.auth_time = 11;
  expect(() => f.run(server.registerProtocol, { protocolVersion: PROTOCOL_VERSION })).not.toThrow();
  (f.ctx.senderAuth.jwt as any).fullPayload.auth_time = 1;
  expect(() => requireAllowedDefeatSession(f.ctx as any)).toThrow("DEFEAT_SESSION_REAUTH");
  delete (f.ctx.senderAuth.jwt as any).fullPayload.auth_time;
  expect(() => requireAllowedDefeatSession(f.ctx as any)).toThrow("DEFEAT_SESSION_REAUTH");
});
it("does not punish legitimate duplicate delivery or grouped kills", () => {
  const f = fixture(); const normal = { ...report, enemies: [{ enemy: "site:0", count: 20 }] };
  f.run(server.recordEnemyDefeats, normal); f.run(server.recordEnemyDefeats, normal);
  expect(f.db.defeatSessionRestriction.identity.find(f.ctx.sender)).toBeNull();
  expect(f.db.playerLifetime.identity.find(f.ctx.sender).enemyKills).toBe(20n);
});
it("does not admit a new connection during the guest cooldown", () => {
  const f = fixture();
  f.run(server.recordEnemyDefeats, report);
  f.ctx.connectionId = new (f.ctx.connectionId!.constructor as any)(2n);
  f.run(server.onConnect);
  expect(f.db.playerSession.connectionId.find(f.ctx.connectionId)).toBeNull();
  expect(() => f.run(server.registerProtocol, { protocolVersion: PROTOCOL_VERSION })).toThrow("DEFEAT_SESSION_COOLDOWN");
});
it("also restricts an oversized batch instead of throwing away the restriction transaction", () => {
  const f = fixture(); f.run(server.recordEnemyDefeats, { ...report, enemies: [{ enemy: "site:0", count: 101 }] });
  expect(f.db.defeatSessionRestriction.identity.find(f.ctx.sender)).not.toBeNull();
  expect(f.db.playerLifetime.identity.find(f.ctx.sender)?.enemyKills ?? 0n).toBe(0n);
});
it("enforces impossible boss claims and releases regional admission", () => {
  const f = fixture(); f.patch("playerProgress", { equippedRightHand: "", damage: 1 });
  f.seed("shardRuntime", { id: 0, role: "root", enabled: true, mapId: "", shardId: 0n });
  f.seed("mapShard", { id: 1n, mapId: report.mapId, databaseName: "test-shard", state: "ready", occupants: 1 });
  f.seed("mapShardMember", { identity: f.ctx.sender, mapId: report.mapId, shardId: 1n, generation: 1n, ready: true });
  f.run(server.recordEnemyDefeats, { ...report, enemies: [{ enemy: "boss", count: 1 }] });
  expect(f.db.defeatSessionRestriction.identity.find(f.ctx.sender)).not.toBeNull();
  expect(f.db.mapShardMember.identity.find(f.ctx.sender)).toBeNull();
  expect(f.db.proceduralProgress.identity.find(f.ctx.sender)).toBeNull();
});
