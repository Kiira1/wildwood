import { expect, it, vi } from "vitest";
import { Identity } from "spacetimedb";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));
it("requires admin access and persists explicitly granted prototype equipment", () => {
  const f = crystalFixture(), player = f.ctx.sender;
  const args = { identity: player, itemId: "wooden_sword", equip: true };
  expect(() => f.run(server.devGrantEquipment, args)).toThrow("Developer access required");
  f.ctx.sender = Identity.fromString("c200383520521c925f3cf6deafb20cd6a7d6168d1c31cb3c0ddb731c197a2d79");
  f.run(server.devGrantEquipment, args);
  const progress = f.db.playerProgress.identity.find(player);
  expect(JSON.parse(progress.inventoryJson)).toContain("wooden_sword");
  expect(progress.equippedRightHand).toBe("wooden_sword");
  expect(progress.cosmeticRightHand).toBe("");
  f.run(server.devGrantEquipment, args);
  expect(JSON.parse(f.db.playerProgress.identity.find(player).inventoryJson).filter((id: string) => id === "wooden_sword")).toHaveLength(1);
  f.ctx.sender = player;
  f.run(server.savePlayerProgress, { ...progress, inventoryJson: "[]" });
  expect(f.db.playerProgress.identity.find(player).equippedRightHand).toBe("wooden_sword");
  expect(JSON.parse(f.db.playerProgress.identity.find(player).inventoryJson)).toContain("wooden_sword");
});

it("does not let a regular account create or equip a sword through a forged save", () => {
  const f = crystalFixture(), progress = f.db.playerProgress.identity.find(f.ctx.sender);
  f.run(server.savePlayerProgress, { ...progress, inventoryJson: '["wooden_sword"]', equippedRightHand: "wooden_sword" });
  const saved = f.db.playerProgress.identity.find(f.ctx.sender);
  expect(JSON.parse(saved.inventoryJson)).not.toContain("wooden_sword");
  expect(saved.equippedRightHand).not.toBe("wooden_sword");
});
