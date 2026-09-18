import { describe, expect, it, vi } from "vitest";
import { clampMovementVector, createPlayerController } from "./player-controller";

describe("player movement vector", () => {
  it("preserves analog magnitude below full speed", () => {
    expect(clampMovementVector(.3, .4)).toEqual({ x: .3, y: .4 });
  });

  it("caps diagonal and combined input at full speed", () => {
    const movement = clampMovementVector(1, 1);
    expect(Math.hypot(movement.x, movement.y)).toBeCloseTo(1);
  });

  it("rejects malformed input", () => {
    expect(clampMovementVector(Number.NaN, 1)).toEqual({ x: 0, y: 0 });
  });
});


it("respawns with current equipment and its health bonus intact", async () => {
  const { createGameBootstrap } = await import("./game-bootstrap");
  const { player, inventory } = createGameBootstrap();
  Object.assign(inventory, { equippedHead: "cloudspire_helmet", equippedChest: "moonfen_armor",
    equippedRightHand: "cloudspire_bow", equippedFeet: "black_boots" });
  const equipped = { ...inventory };
  Object.assign(player, { baseMaxHp: 100, hp: 0, maxHp: 125, damage: 30, regen: 4 });
  const controller = createPlayerController({ player, boss: {}, enemies: [], spawnSites: [], decor: [], paths: [],
    getCurrentMapId: () => "home", mapSpawn: () => ({ x: 100, y: 100 }),
    initialStats: { maxHp: 10, damage: 3 }, healthMultiplierBonus: () => inventory.equippedChest === "moonfen_armor" ? .25 : 0,
    clearTransientCombat: vi.fn(), clearPlayerCombat: vi.fn(), resetBosses: vi.fn(),
    invalidateStaticWorld: vi.fn(), onResetUI: vi.fn(), spawnFromSite: vi.fn(),
  } as any);
  controller.reset(true, true);
  expect(inventory).toEqual(equipped);
  expect(player).toMatchObject({ hp: 125, maxHp: 125, damage: 30, regen: 4 });
});
