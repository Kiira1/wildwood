import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("bounds inventory decoding during a normal combat progress save", () => {
  const f = crystalFixture();
  const base = f.db.playerProgress.identity.find(f.ctx.sender);
  const parse = vi.spyOn(JSON, "parse");
  try {
    f.run(server.savePlayerProgress, { ...base, damage: base.damage + 1, enemyKills: 2 });
    expect(parse.mock.calls.length).toBeLessThanOrEqual(12);
    expect(f.db.playerProgress.identity.find(f.ctx.sender).damage).toBe(base.damage + 1);
  } finally { parse.mockRestore(); }
});

it("keeps server-owned inventory, unlocks, and monotonic stats when saving", () => {
  const f = crystalFixture();
  const inventoryJson = '["sky_bow","water_armor","sky_bow","not-an-item"]';
  f.patch("playerProgress", { inventoryJson, desertUnlocked: true });
  const base = f.db.playerProgress.identity.find(f.ctx.sender);
  f.run(server.savePlayerProgress, { ...base, damage: 1, maxHp: 1, enemyKills: 5,
    inventoryJson: '["samurai_bow"]', equippedRightHand: "sky_bow", equippedChest: "water_armor", desertUnlocked: false });
  const saved = f.db.playerProgress.identity.find(f.ctx.sender);
  expect(saved.damage).toBe(base.damage);
  expect(saved.maxHp).toBe(base.maxHp);
  expect(saved.desertUnlocked).toBe(true);
  expect(JSON.parse(saved.inventoryJson).filter((id: string) => id === "sky_bow")).toHaveLength(1);
  expect(saved.inventoryJson).not.toContain("samurai_bow");
  expect(saved.inventoryJson).not.toContain("not-an-item");
  expect(saved.equippedRightHand).toBe("sky_bow");
  expect(saved.equippedChest).toBe("water_armor");
  expect(f.db.playerLifetime.identity.find(f.ctx.sender).enemyKills).toBe(5n);
});

it("makes unchanged speed requests no-ops without inventory decoding or presentation writes", () => {
  const f = crystalFixture();
  const update = vi.spyOn(f.db.player.identity, "update");
  const parse = vi.spyOn(JSON, "parse");
  try {
    f.run(server.setSpeed, { speed: 180 });
    expect(update).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  } finally { parse.mockRestore(); }
});

it("saves combat stats without decoding inventory or resetting resting speed", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { equippedFeet: "black_boots", inventoryJson: '["black_boots"]' });
  f.patch("player", { feetItem: "black_boots", speed: 205 });
  const base = f.db.playerProgress.identity.find(f.ctx.sender);
  const parse = vi.spyOn(JSON, "parse");
  f.run(server.savePlayerProgress, { ...base, damage: base.damage + 1, enemyKills: 3 });
  expect(parse).not.toHaveBeenCalled();
  parse.mockRestore();
  expect(f.db.player.identity.find(f.ctx.sender).speed).toBe(205);
  expect(f.db.playerProgress.identity.find(f.ctx.sender).damage).toBe(base.damage + 1);
});

it("does not rewrite progress or presentation for an unchanged checkpoint", () => {
  const f = crystalFixture();
  const base = f.db.playerProgress.identity.find(f.ctx.sender);
  f.run(server.savePlayerProgress, { ...base, enemyKills: 3 });
  const player = vi.spyOn(f.db.player.identity, "update");
  const progress = vi.spyOn(f.db.playerProgress.identity, "update");
  const lifetime = vi.spyOn(f.db.playerLifetime.identity, "update");
  f.run(server.savePlayerProgress, { ...base, enemyKills: 3 });
  expect(player).not.toHaveBeenCalled();
  expect(progress).not.toHaveBeenCalled();
  expect(lifetime).not.toHaveBeenCalled();
});

it("removes the temporary boots bonus when those boots are unequipped", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { equippedFeet: "black_boots", inventoryJson: '["black_boots"]' });
  f.patch("player", { feetItem: "black_boots", speed: 205 });
  const base = f.db.playerProgress.identity.find(f.ctx.sender);
  f.run(server.savePlayerProgress, { ...base, equippedFeet: "", enemyKills: 3 });
  expect(f.db.player.identity.find(f.ctx.sender).speed).toBe(180);
});

it("preserves the active black-boots bonus during an unrelated equipment edit", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { equippedFeet: "black_boots", inventoryJson: '["black_boots","water_armor"]' });
  f.patch("player", { feetItem: "black_boots", speed: 205 });
  const base = f.db.playerProgress.identity.find(f.ctx.sender);
  f.run(server.savePlayerProgress, { ...base, equippedChest: "water_armor", enemyKills: 3 });
  expect(f.db.player.identity.find(f.ctx.sender).speed).toBe(205);
  expect(f.db.playerProgress.identity.find(f.ctx.sender).equippedChest).toBe("water_armor");
});
