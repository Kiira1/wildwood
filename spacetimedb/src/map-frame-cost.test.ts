import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
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

it("samples only shared world maps, including for an invisible observer", () => {
  const f = crystalFixture();
  f.seed("playerMotionMapState", { mapId: "home_exterior", playerCount: 20, visibleCount: 0 });
  f.seed("playerMotionMapState", { mapId: "water_reach", playerCount: 2, visibleCount: 1 });
  f.seed("playerMotion", { networkId: 1, identity: f.ctx.sender, mapId: "water_reach", isVisible: true, x: 100, y: 100 });
  const scan = vi.spyOn(f.db.playerMotion, "iter");
  f.run(server.publishMapFrames);
  expect([...f.db.playerMapFrame.iter()].map((row: any) => [row.mapId, row.playerCount])).toEqual([["water_reach", 1]]);
  expect([...f.db.mapFrameSchedule.iter()]).toHaveLength(1);
  expect(scan).toHaveBeenCalledTimes(1);
});

it.each([0, 1])("publishes a final clearing frame before stopping at visible count %i", visibleCount => {
  const f = crystalFixture();
  f.seed("playerMotionMapState", { mapId: "water_reach", playerCount: 1, visibleCount });
  if (visibleCount) f.seed("playerMotion", { networkId: 1, identity: f.ctx.sender, mapId: "water_reach", isVisible: true });
  f.run(server.publishMapFrames);
  expect([...f.db.playerMapFrame.iter()].map((row: any) => row.playerCount)).toEqual([visibleCount]);
  expect([...f.db.mapFrameSchedule.iter()]).toHaveLength(0);
});
