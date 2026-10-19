import { expect, it, vi } from "vitest";
import { createAccountRowServices } from "./account-row-services";
import { MINING_NODES } from "../../../shared/mining";
import { WOOD_TREE_NODES } from "../../../shared/woodcutting";

const copper = MINING_NODES.find(node => node.ore === "copper_ore" && node.kind === "small")!;
const pine = WOOD_TREE_NODES.find(tree => tree.kind === "pine")!;

it("counts ores from breaks not yet reported in the bag, and the same object while there are none", () => {
  const rows = createAccountRowServices(() => null, vi.fn());
  const empty = rows.api.ores();
  expect(rows.api.ores()).toBe(empty);
  rows.api.queueMiningBreak(copper.id, 1_000);
  rows.api.queueTreeChop(pine.id, 2_000);
  expect(rows.api.ores()).toEqual({ copper_ore: 1, pine_log: 2 });
  expect(rows.api.ores()).toBe(rows.api.ores());
});

it("sends the waiting breaks before any call whose server check reads ores or bag room", async () => {
  for (const call of [
    (api: any) => api.refineItem("iron_bow", 0n, 0), (api: any) => api.destroyOre("copper_ore", 1), (api: any) => api.craftGradeGear("iron_bow"),
    (api: any) => api.upgradeTool("pickaxe", 0), (api: any) => api.buyShopCard(0, "card"), (api: any) => api.buyGradeGear("iron_bow", 1),
    (api: any) => api.claimStarterWeapon("bow"), (api: any) => api.fallIntoWell(), (api: any) => api.flushGathering(),
  ]) {
    const rows = createAccountRowServices(() => null, vi.fn()), told = vi.fn();
    rows.api.setOnMiningRejected(told);
    rows.api.queueMiningBreak(copper.id, 1_000);
    expect(rows.api.minedNodeAt(copper.id)).toBe(1_000);
    // With no connection the report cannot go, so sending it shows as the break let go.
    await call(rows.api);
    expect(told).toHaveBeenCalledWith("Not Connected");
    expect(rows.api.minedNodeAt(copper.id)).toBeNull();
  }
});
