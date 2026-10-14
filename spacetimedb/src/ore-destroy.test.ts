import { describe, expect, it, vi } from "vitest";
import { ConnectionId } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { addOres, oreCount, oreKindsHeldFor } from "./item-refine";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

function bag() {
  const f = crystalFixture();
  addOres(f.ctx, f.ctx.sender, "copper_ore", 12);
  addOres(f.ctx, f.ctx.sender, "iron_ore", 3);
  const destroy = (oreId = "copper_ore", expectedCount = 12) => f.run(server.destroyOre, { oreId, expectedCount });
  return { ...f, destroy };
}

describe("destroying an ore stack", () => {
  it("frees one bag slot and leaves other ores and another player's stack alone", () => {
    const f = bag(), other = identity("2");
    addOres(f.ctx, other, "copper_ore", 12);
    expect(oreKindsHeldFor(f.ctx, f.ctx.sender)).toBe(2);
    f.destroy();
    expect(oreCount(f.ctx, f.ctx.sender, "copper_ore")).toBe(0);
    expect(oreKindsHeldFor(f.ctx, f.ctx.sender)).toBe(1);
    expect(oreCount(f.ctx, f.ctx.sender, "iron_ore")).toBe(3);
    expect(oreCount(f.ctx, other, "copper_ore")).toBe(12);
    expect(() => f.destroy()).toThrow("not in your bag");
    expect(oreCount(f.ctx, other, "copper_ore")).toBe(12);
  });

  it.each([0, 11, 13])("rejects a stale confirmed count of %s without taking ore", expectedCount => {
    const f = bag();
    expect(() => f.destroy("copper_ore", expectedCount)).toThrow("ore stack changed");
    expect(oreCount(f.ctx, f.ctx.sender, "copper_ore")).toBe(12);
  });

  it("rejects invalid ore names and an ore the player does not hold", () => {
    const f = bag();
    expect(() => f.destroy("not_an_ore")).toThrow("not an ore");
    expect(() => f.destroy("starshard")).toThrow("not in your bag");
    expect(oreKindsHeldFor(f.ctx, f.ctx.sender)).toBe(2);
  });

  it("requires the controlling game session", () => {
    const f = bag();
    f.patch("playerController", { connectionId: new ConnectionId(2n) });
    expect(() => f.destroy()).toThrow("active in another tab");
    expect(oreCount(f.ctx, f.ctx.sender, "copper_ore")).toBe(12);
  });

  it("does not change the bag during a duel", () => {
    const f = bag();
    f.seed("duel", { id: 1n, challenger: f.ctx.sender, opponent: identity("2"), status: "active" });
    expect(() => f.destroy()).toThrow("Finish your duel first.");
    expect(oreCount(f.ctx, f.ctx.sender, "copper_ore")).toBe(12);
  });
});
