import { expect, it, vi } from "vitest";
import { PLAYER_SPEED } from "../../shared/rules";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("keeps server-owned inventory, unlocks, and ignores client combat stats when saving", () => {
  const f = crystalFixture();
  const inventoryJson = '["sky_bow","water_armor","sky_bow","not-an-item"]';
  f.patch("playerProgress", { inventoryJson, desertUnlocked: true, waterUnlocked: true });
  const base = progressOf(f, f.ctx.sender);
  f.run(server.savePlayerProgress, { ...base, damage: 1, maxHp: 1, enemyKills: 5,
    inventoryJson: '["samurai_bow"]', equippedRightHand: "sky_bow", equippedChest: "water_armor", desertUnlocked: false });
  const saved = progressOf(f, f.ctx.sender);
  expect(saved.damage).toBe(base.damage);
  expect(saved.maxHp).toBe(base.maxHp);
  expect(saved.desertUnlocked).toBe(true);
  expect(JSON.parse(saved.inventoryJson).filter((id: string) => id === "sky_bow")).toHaveLength(1);
  expect(saved.inventoryJson).not.toContain("samurai_bow");
  expect(saved.inventoryJson).not.toContain("not-an-item");
  expect(saved.equippedRightHand).toBe("sky_bow");
  expect(saved.equippedChest).toBe("water_armor");
  expect(f.db.playerLifetime.identity.find(f.ctx.sender)?.enemyKills ?? 0n).toBe(0n);
});

it("ignores combat stat uploads without resetting resting speed", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { infernalUnlocked: true, waterUnlocked: true, equippedFeet: "black_boots", inventoryJson: '["black_boots"]' });
  f.patch("player", { feetItem: "black_boots", speed: 205 });
  const base = progressOf(f, f.ctx.sender);
  f.run(server.savePlayerProgress, { ...base, damage: base.damage + 1, enemyKills: 3 });
  expect(f.db.player.identity.find(f.ctx.sender).speed).toBe(205);
  expect(progressOf(f, f.ctx.sender).damage).toBe(base.damage);
});

it("removes the temporary boots bonus when those boots are unequipped", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { infernalUnlocked: true, waterUnlocked: true, equippedFeet: "black_boots", inventoryJson: '["black_boots"]' });
  f.patch("player", { feetItem: "black_boots", speed: PLAYER_SPEED + 25 });
  const base = progressOf(f, f.ctx.sender);
  f.run(server.savePlayerProgress, { ...base, equippedFeet: "", enemyKills: 3 });
  expect(f.db.player.identity.find(f.ctx.sender).speed).toBe(PLAYER_SPEED);
});

it("preserves the active black-boots bonus during an unrelated equipment edit", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { infernalUnlocked: true, waterUnlocked: true, equippedFeet: "black_boots", inventoryJson: '["black_boots","water_armor"]' });
  f.patch("player", { feetItem: "black_boots", speed: PLAYER_SPEED + 25 });
  const base = progressOf(f, f.ctx.sender);
  f.run(server.savePlayerProgress, { ...base, equippedChest: "water_armor", enemyKills: 3 });
  expect(f.db.player.identity.find(f.ctx.sender).speed).toBe(PLAYER_SPEED + 25);
  expect(progressOf(f, f.ctx.sender).equippedChest).toBe("water_armor");
});

it("does not accept forged stats, kills or boots through an equipment save", () => {
  const f = crystalFixture(), base = progressOf(f, f.ctx.sender);
  f.run(server.savePlayerProgress, { ...base, damage: 1e25, maxHp: 1e25, armor: 1e25, regen: 1e25,
    attackRate: 0.01, projectileCount: 20, enemyKills: 4_000_000_000, bootsCollected: true,
    equippedHead: "fake-item", inventoryJson: '["fake-item"]' });
  const result = progressOf(f, f.ctx.sender);
  for (const key of ["damage", "maxHp", "armor", "regen", "attackRate", "projectileCount", "bootsCollected"])
    expect(result[key]).toBe(base[key]);
  expect(f.db.playerLifetime.identity.find(f.ctx.sender)?.enemyKills ?? 0n).toBe(0n);
});
