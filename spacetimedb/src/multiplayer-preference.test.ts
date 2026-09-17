import { expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("publishes other players only while both participants are visible", () => {
  const f = crystalFixture(), first = f.ctx.sender;
  f.patch("player", { isVisible: false });
  f.run(server.setMultiplayerEnabled, { enabled: true });
  const firstPlayer = f.db.player.identity.find(first);
  const second = identity("2");
  f.seed("player", { ...firstPlayer, identity: second, isVisible: false });
  f.progress(second); f.seed("playerProfile", { identity: second, displayName: "Second Player" });
  f.seed("playerController", { identity: second, connectionId: f.ctx.connectionId });
  const actor = (who: typeof first) => {
    f.ctx.sender = who;
    const session = f.db.playerSession.connectionId.find(f.ctx.connectionId);
    f.db.playerSession.connectionId.update({ ...session, identity: who });
  };
  actor(second); f.run(server.setMultiplayerEnabled, { enabled: true });
  const firstMotion = f.db.playerMotion.identity.find(first), secondMotion = f.db.playerMotion.identity.find(second);
  actor(first); f.run(server.setPlayerMotionInterest, { networkIds: [secondMotion.networkId] });
  f.run(server.publishMotionDetailFrames, { schedule: {} });
  expect(f.db.playerMotionDetailFrame.count()).toBe(1n);
  actor(second); f.run(server.setMultiplayerEnabled, { enabled: false });
  expect(f.db.playerMotion.identity.find(second).isVisible).toBe(false);
  actor(first); f.run(server.publishMotionDetailFrames, { schedule: {} });
  expect(f.db.playerMotionDetailFrame.count()).toBe(1n);
  f.run(server.setMultiplayerEnabled, { enabled: false });
  expect(f.db.playerMotionInterest.identity.find(first)).toBeNull();
  f.run(server.setPlayerMotionInterest, { networkIds: [secondMotion.networkId] });
  expect(f.db.playerMotionInterest.identity.find(first)).toBeNull();
  expect(firstMotion.isVisible).toBe(true);
});

it("rate limits re-enabling but allows immediate hiding and waking after five-minute idle", () => {
  const f = crystalFixture(), start = f.ctx.timestamp.microsSinceUnixEpoch;
  f.run(server.setMultiplayerEnabled, { enabled: true });
  f.run(server.setMultiplayerEnabled, { enabled: true }); // No-op retry.
  f.run(server.setMultiplayerEnabled, { enabled: false });
  expect(() => f.run(server.setMultiplayerEnabled, { enabled: true })).toThrow("cooling down");
  f.ctx.timestamp = new Timestamp(start + 4_999_999n);
  expect(() => f.run(server.setMultiplayerEnabled, { enabled: true })).toThrow("cooling down");
  f.ctx.timestamp = new Timestamp(start + 5_000_000n);
  f.run(server.setMultiplayerEnabled, { enabled: true });
  f.ctx.timestamp = new Timestamp(start + 305_000_000n);
  f.run(server.setMultiplayerEnabled, { enabled: false });
  f.run(server.setMultiplayerEnabled, { enabled: true });
  expect(f.db.player.identity.find(f.ctx.sender).isVisible).toBe(true);
  expect(f.db.playerMultiplayerPreference.count()).toBe(1n);
});
