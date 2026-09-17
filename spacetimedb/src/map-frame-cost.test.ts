import { expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("stops a stale publisher without scanning or broadcasting private homes", () => {
  const f = crystalFixture();
  f.seed("playerMotionMapState", { mapId: "home_exterior", playerCount: 9, visibleCount: 0 });
  const scan = vi.spyOn(f.db.playerMotion, "iter");
  f.run(server.publishMapFrames);
  expect([...f.db.playerMapFrame.iter()]).toHaveLength(0);
  expect([...f.db.mapFrameSchedule.iter()]).toHaveLength(0);
  expect(scan).not.toHaveBeenCalled();
});

it("keeps sampling only when at least two players have multiplayer enabled", () => {
  const f = crystalFixture();
  f.seed("playerMotionMapState", { mapId: "home_exterior", playerCount: 20, visibleCount: 0 });
  f.seed("playerMotionMapState", { mapId: "water_reach", playerCount: 3, visibleCount: 2 });
  f.seed("playerMotion", { networkId: 1, identity: f.ctx.sender, mapId: "water_reach", isVisible: true, x: 100, y: 100 });
  f.seed("playerMotion", { networkId: 2, identity: identity("2"), mapId: "water_reach", isVisible: true, x: 200, y: 100 });
  const scan = vi.spyOn(f.db.playerMotion, "iter");
  f.run(server.publishMapFrames);
  expect([...f.db.playerMapFrame.iter()].map((row: any) => [row.mapId, row.playerCount])).toEqual([["water_reach", 2]]);
  expect([...f.db.mapFrameSchedule.iter()]).toHaveLength(1);
  expect(scan).toHaveBeenCalledTimes(1);
});

it.each([0, 1])("publishes a final clearing frame before stopping at visible count %i, even with hidden players present", visibleCount => {
  const f = crystalFixture();
  f.seed("playerMotionMapState", { mapId: "water_reach", playerCount: 20, visibleCount });
  if (visibleCount) f.seed("playerMotion", { networkId: 1, identity: f.ctx.sender, mapId: "water_reach", isVisible: true });
  f.run(server.publishMapFrames);
  expect([...f.db.playerMapFrame.iter()].map((row: any) => row.playerCount)).toEqual([visibleCount]);
  expect([...f.db.mapFrameSchedule.iter()]).toHaveLength(0);
});
