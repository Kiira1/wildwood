import { expect, it, vi } from "vitest";
import { Identity } from "../../tests/helpers/spacetime-memory-db";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { DEVELOPER_IDENTITY } from "../../shared/developer-identity";
import { SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

function fixture(developer = true) {
  const f = crystalFixture(), target = f.ctx.sender;
  const connectionId = new (f.ctx.connectionId!.constructor as any)(2n);
  f.patch("playerProfile", { displayName: "Target Player" });
  const who = developer ? Identity.fromString(DEVELOPER_IDENTITY) : identity("2");
  f.seed("player", { ...f.db.player.identity.find(target), identity: who, mapId: "tutorial_forest", x: 100, y: 200 });
  f.progress(who);
  f.seed("playerSession", { ...f.db.playerSession.connectionId.find(f.ctx.connectionId), identity: who, connectionId: connectionId });
  f.seed("playerController", { identity: who, connectionId: connectionId });
  f.ctx.sender = who; f.ctx.connectionId = connectionId;
  f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
  const fetch = vi.fn();
  const ctx = { ...f.ctx, http: { fetch }, withTx: (fn: any) => f.transaction(() => fn(f.ctx)) };
  return { ...f, ctx, target, who, fetch, jump: () => server.devTeleportToPlayer(ctx as any, { identity: target, mapId: "crystal_hollows" }),
    lookup: (query = "target player") => JSON.parse(server.getDeveloperTravelTarget(ctx as any, { query })) };
}
it("denies ordinary accounts both lookup and travel, even with Endless travel access", () => {
  const f = fixture(false); f.seed("endlessTravelAccess", { identity: f.who });
  expect(() => f.lookup()).toThrow(/Developer access/); expect(() => f.jump()).toThrow(/Developer access/);
  expect(f.fetch).not.toHaveBeenCalled();
});
it("looks up case-insensitive names and IDs; moves only the developer without granting stats or unlocks", () => {
  const f = fixture();
  expect(f.lookup(" TARGET PLAYER ")).toMatchObject({ mapId: "crystal_hollows" });
  expect(f.lookup(f.target.toHexString()).identity).toBe(f.target.toHexString());
  const before = f.db.playerProgress.identity.find(f.who), target = f.db.player.identity.find(f.target);
  expect(JSON.parse(f.jump())).toMatchObject({ mapId: target.mapId, x: target.x, y: target.y });
  expect(f.db.playerProgress.identity.find(f.who)).toEqual(before);
  expect(f.db.player.identity.find(f.target)).toEqual(target);
  expect(f.db.playerLastLocation.identity.find(f.who).mapId).toBe(target.mapId);
});
it.each(["offline", "home", "changed"])("rejects unavailable target: %s", state => {
  const f = fixture();
  if (state === "offline") f.db.playerController.identity.delete(f.target);
  else f.patch("player", { mapId: state === "home" ? "home_exterior" : "moonfen" }, f.target);
  expect(() => f.jump()).toThrow(state === "offline" ? /offline/ : state === "home" ? /private map/ : /changed maps/);
  expect(f.db.player.identity.find(f.who).mapId).toBe("tutorial_forest");
});
function sharded() {
  const f = fixture();
  f.seed("shardRuntime", { id: 0, role: "root", enabled: true, mapId: "", shardId: 0n });
  f.seed("mapShard", { id: 1n, mapId: "crystal_hollows", databaseName: "target-shard", state: "ready", occupants: 1 });
  f.seed("mapShard", { id: 2n, mapId: "crystal_hollows", databaseName: "other-shard", state: "ready", occupants: 5 });
  f.seed("mapShardMember", { identity: f.target, mapId: "crystal_hollows", shardId: 1n, generation: 5n, ready: true });
  f.seed("shardCoordinatorConnection", { id: 0, host: "https://example.invalid", token: "test" });
  f.fetch.mockReturnValue({ status: 200, text: () => JSON.stringify([{ rows: [[1200, 1300, "crystal_hollows"]] }]) });
  return f;
}
it("reads regional position once and joins the target instance instead of the fuller default instance", () => {
  const f = sharded();
  expect(JSON.parse(f.jump())).toMatchObject({ x: 1200, y: 1300 });
  expect(f.db.mapShardMember.identity.find(f.who).shardId).toBe(1n);
  expect(f.db.mapShard.id.find(1n).occupants).toBe(2);
  expect(f.fetch).toHaveBeenCalledOnce();
});
it("revalidates the target after regional I/O, leaving the developer unmoved if target disconnects", () => {
  const f = sharded();
  f.fetch.mockImplementation(() => { f.db.playerController.identity.delete(f.target); return { status: 200, text: () => JSON.stringify([{ rows: [[1200, 1300, "crystal_hollows"]] }]) }; });
  expect(() => f.jump()).toThrow(/offline/);
  expect(f.db.player.identity.find(f.who).mapId).toBe("tutorial_forest");
});
it("refuses a full target instance without moving either player", () => {
  const f = sharded(); const shard = f.db.mapShard.id.find(1n);
  f.db.mapShard.id.update({ ...shard, occupants: 1000 });
  expect(() => f.jump()).toThrow(/full/);
  expect(f.db.player.identity.find(f.who).mapId).toBe("tutorial_forest");
});
it("switches instances on the same map without keeping the old membership", () => {
  const f = sharded(); f.patch("player", { mapId: "crystal_hollows" }, f.who);
  f.seed("mapShardMember", { identity: f.who, mapId: "crystal_hollows", shardId: 2n, generation: 4n, ready: true });
  f.jump();
  expect(f.db.mapShardMember.identity.find(f.who)).toMatchObject({ shardId: 1n, ready: false });
  expect(f.db.mapShard.id.find(2n).occupants).toBe(4);
  expect(f.db.shardTransferBarrier.identity.find(f.who).shardId).toBe(2n);
});
it("does not expose locations to a developer identity without authenticated credentials", () => {
  const f = fixture(); f.ctx.senderAuth.jwt = undefined;
  expect(() => f.lookup()).toThrow(/Developer access/);
});
it("rejects a moved map or corrupt position returned by a shard", () => {
  const f = sharded();
  f.fetch.mockReturnValue({ status: 200, text: () => JSON.stringify([{ rows: [[1200, 1300, "moonfen"]] }]) });
  expect(() => f.jump()).toThrow(/position is unavailable/);
  expect(f.db.player.identity.find(f.who).mapId).toBe("tutorial_forest");
});
