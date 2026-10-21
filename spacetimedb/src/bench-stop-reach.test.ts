import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { TOWN_BENCH_POSITION } from "../../shared/town";
import { worldBoundsFor } from "../../shared/world-bounds";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("a bench stop only lands where the player could have walked, and an honest one still starts an upgrade", () => {
  const f = crystalFixture();
  const bench = TOWN_BENCH_POSITION;
  const town = worldBoundsFor("town");
  // Far from the bench, across the town.
  const far = { x: bench.x > town.width / 2 ? 200 : town.width - 200, y: bench.y };
  f.patch("player", { mapId: "town", x: far.x, y: far.y });

  f.run(server.prepareWorldActionPosition, { x: bench.x, y: bench.y });
  const pulled = f.db.player.identity.find(f.ctx.sender);
  expect(Math.hypot(pulled.x - far.x, pulled.y - far.y)).toBeLessThanOrEqual(96 + 1e-6);
  expect(Math.hypot(pulled.x - bench.x, pulled.y - bench.y)).toBeGreaterThan(500);
  const motion = f.db.playerMotion.identity.find(f.ctx.sender);
  expect(Math.hypot(motion.x - bench.x, motion.y - bench.y)).toBeGreaterThan(500);

  // Walking there takes time; once it could have, the same stop is taken as asked.
  f.ctx.timestamp = { microsSinceUnixEpoch: f.ctx.timestamp.microsSinceUnixEpoch + 300_000_000n } as any;
  f.run(server.prepareWorldActionPosition, { x: bench.x + 10, y: bench.y });
  const there = f.db.player.identity.find(f.ctx.sender);
  expect([there.x, there.y]).toEqual([bench.x + 10, bench.y]);
  f.run(server.startItemUpgrade, { slot: 1, itemId: "HAND" });
  expect(f.db.activeItemUpgrade.identity.find(f.ctx.sender)?.itemId).toBe("HAND");
});
