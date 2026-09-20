import { describe, expect, it } from "vitest";
import { MAP_SHARD_CAPACITY, MAP_SHARD_WARM_AT, selectMapShard, shouldWarmMapShard, type MapShardCandidate } from "./map-sharding";
const shard = (id: string, occupants: number, state: MapShardCandidate["state"] = "ready", mapId = "forest"): MapShardCandidate => ({ id, occupants, state, mapId });
const FULL = MAP_SHARD_CAPACITY, NEARLY_FULL = MAP_SHARD_CAPACITY - 1;
describe("map shard admission", () => {
  it("keeps the standby empty until the capacity is genuinely reached", () => {
    expect(MAP_SHARD_WARM_AT).toBeLessThan(MAP_SHARD_CAPACITY);
  });
  it("fills occupied instances before the standby and never admits past capacity", () => {
    expect(selectMapShard([shard("a", NEARLY_FULL), shard("b", 0)], "forest")?.id).toBe("a");
    expect(selectMapShard([shard("a", FULL), shard("b", 0)], "forest")?.id).toBe("b");
    expect(selectMapShard([shard("a", FULL)], "forest")).toBeNull();
  });
  it("warms at the warm threshold and suppresses duplicate provisioning while a standby starts", () => {
    expect(shouldWarmMapShard([], "forest")).toBe(true);
    expect(shouldWarmMapShard([shard("a", MAP_SHARD_WARM_AT - 1)], "forest")).toBe(false);
    expect(shouldWarmMapShard([shard("a", MAP_SHARD_WARM_AT)], "forest")).toBe(true);
    expect(shouldWarmMapShard([shard("a", FULL), shard("b", 0, "starting")], "forest")).toBe(false);
    expect(selectMapShard([shard("b", 0, "starting")], "forest")).toBeNull();
  });
  it("keeps an existing seat on reconnect and excludes failed, draining, and other maps", () => {
    const candidates = [shard("a", FULL), shard("b", 0, "failed"), shard("c", 0, "draining"), shard("d", 0, "ready", "desert")];
    expect(selectMapShard(candidates, "forest", "a")?.id).toBe("a");
    expect(selectMapShard(candidates, "forest")).toBeNull();
    expect(shouldWarmMapShard(candidates, "forest")).toBe(true);
  });
});
