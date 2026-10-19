import { describe, expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { progressOf } from "../../tests/helpers/progress";
import { gradeSalePrice } from "../../shared/gear-grades";
import { SAMURAI_HAT } from "../../shared/items";
import { addGold, goldFor } from "./gold";
import { refineLevelFor, setRefineLevel } from "./item-refine";
import { inventoryForProgress } from "./progress-helpers";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

/** A bag holding a Rare Bow (★3), with 100 gold. */
function withRareBow(overrides: Record<string, unknown> = {}) {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify(["rare_bow", SAMURAI_HAT]), equippedRightHand: "", ...overrides });
  f.transaction(() => { addGold(f.ctx, f.ctx.sender, 100); setRefineLevel(f.ctx, f.ctx.sender, "rare_bow", 0n, 3); });
  const sell = (itemId = "rare_bow", copyId = 0n) => f.run(server.sellGradedItem, { itemId, copyId });
  const bag = () => inventoryForProgress(progressOf(f));
  const gold = () => goldFor(f.ctx, f.ctx.sender);
  return { ...f, sell, bag, gold };
}

describe("selling graded gear to the Smith", () => {
  it("pays 70% of the price, refines adding nothing, and takes the piece and its refine", () => {
    const f = withRareBow();
    f.sell();
    expect(f.gold()).toBe(BigInt(100 + gradeSalePrice("rare")));
    expect(f.bag()).not.toContain("rare_bow");
    expect(f.bag()).toContain(SAMURAI_HAT);
    expect(refineLevelFor(f.ctx, f.ctx.sender, "rare_bow")).toBe(0);
  });

  it("sells one kept copy and leaves the first", () => {
    const f = withRareBow();
    const copy = f.seed("playerEquipmentCopy", { id: 0n, identity: f.ctx.sender, itemId: "rare_bow", arrowStorm: 0, ricochet: 0, piercingShot: 0, acquiredAt: f.ctx.timestamp }) as { id: bigint };
    f.sell("rare_bow", copy.id);
    expect(f.bag()).toContain("rare_bow");
    expect([...f.db.playerEquipmentCopy.identity.filter(f.ctx.sender)]).toHaveLength(0);
    expect(f.gold()).toBe(BigInt(100 + gradeSalePrice("rare")));
  });

  it("refuses worn, ungraded, locked and unowned pieces, paying nothing", () => {
    expect(() => withRareBow({ equippedRightHand: "rare_bow" }).sell()).toThrow("Take it off before selling it.");
    expect(() => withRareBow().sell(SAMURAI_HAT)).toThrow("The Smith does not buy that.");
    expect(() => withRareBow().sell("epic_bow")).toThrow("not in your inventory");
    expect(() => withRareBow().sell("rare_bow", 99n)).toThrow("not in your inventory");
    const locked = withRareBow();
    locked.seed("playerEquipmentLock", { key: `${locked.ctx.sender.toHexString()}:rare_bow`, identity: locked.ctx.sender, itemId: "rare_bow", copyId: 0n });
    expect(() => locked.sell()).toThrow("Unlock this equipment before selling it.");
    expect(locked.gold()).toBe(100n);
    expect(locked.bag()).toContain("rare_bow");
  });
});
