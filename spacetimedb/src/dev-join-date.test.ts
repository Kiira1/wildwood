import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { Identity, Timestamp } from "../../tests/helpers/spacetime-memory-db";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const owner = Identity.fromString("c200383520521c925f3cf6deafb20cd6a7d6168d1c31cb3c0ddb731c197a2d79");

it("sets an account's join date for the profile and the Account Created board, logged", () => {
  const f = crystalFixture(), target = f.ctx.sender;
  f.ctx.timestamp = new Timestamp(1_792_000_000_000_000n);
  f.seed("playerLifetime", { identity: target, joinedAt: f.ctx.timestamp, playedMicros: 0n, sessionStartedAt: f.ctx.timestamp, enemyKills: 0n, deathCount: 0n });
  f.seed("leaderboardStanding", { identity: target, prestige: 0, power: 1, playedMicros: 0n, joinedAtMicros: 1n, pages: [] });
  const set = (date: string) => f.run(server.devSetJoinDate, { identityHex: target.toHexString(), date, reason: "" });
  expect(() => set("2026-08-06")).toThrow(/Developer|owner/);
  f.ctx.sender = owner;
  expect(() => set("2026-02-30")).toThrow("Use a date like");
  expect(() => set("2027-01-01")).toThrow("future");
  set("2026-08-06");
  const noon = BigInt(Date.UTC(2026, 7, 6, 12)) * 1000n;
  expect(f.db.playerLifetime.identity.find(target).joinedAt.microsSinceUnixEpoch).toBe(noon);
  expect(f.db.playerJoinDate.identity.find(target).joinedAt.microsSinceUnixEpoch).toBe(noon);
  expect(f.db.leaderboardStanding.identity.find(target).joinedAtMicros).toBe(noon);
  expect([...f.db.moderationAction.iter()].some((row: any) => row.action === "Join date set")).toBe(true);
});
