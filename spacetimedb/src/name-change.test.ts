import { expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { NAME_CHANGE_COOLDOWN_MS, nameChangeStatus } from "../../shared/name-change";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

function fixture(balance = 100n) {
  const f = crystalFixture();
  f.seed("playerGemWallet", { identity: f.ctx.sender, balance, revision: 0n, updatedAt: f.ctx.timestamp });
  return f;
}
function advance(f: ReturnType<typeof fixture>, milliseconds = NAME_CHANGE_COOLDOWN_MS) {
  f.ctx.timestamp = new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + BigInt(milliseconds) * 1000n);
}
const rename = (f: ReturnType<typeof fixture>, displayName = "New Name", expectedCost = 50) =>
  f.run(server.changeDisplayName, { displayName, expectedCost });
const balance = (f: ReturnType<typeof fixture>) => f.db.playerGemWallet.identity.find(f.ctx.sender).balance;
const name = (f: ReturnType<typeof fixture>) => f.db.playerProfile.identity.find(f.ctx.sender).displayName;

it("allows the first rename for free with no gems and records its cooldown", () => {
  const f = fixture(0n);
  f.run(server.setDisplayName, { displayName: "First Name" });
  expect(name(f)).toBe("First Name");
  expect(balance(f)).toBe(0n);
  expect(f.db.playerNameCooldown.identity.find(f.ctx.sender).changedAt).toEqual(f.ctx.timestamp);
});

it("rejects a second change before 24 hours without spending, then charges exactly 50", () => {
  const f = fixture();
  f.run(server.setDisplayName, { displayName: "First Name" });
  advance(f, NAME_CHANGE_COOLDOWN_MS - 1);
  expect(() => rename(f)).toThrow("24 hours");
  expect(balance(f)).toBe(100n);
  expect(name(f)).toBe("First Name");
  advance(f, 1);
  rename(f);
  expect(balance(f)).toBe(50n);
  expect(name(f)).toBe("New Name");
  expect([...f.db.gemTransaction.iter()].filter((r: any) => r.kind === "name_change")).toHaveLength(1);
  rename(f); // A retry for the same name never spends twice.
  expect(balance(f)).toBe(50n);
  expect(() => rename(f, "Third Name")).toThrow("24 hours");
});

it("does not spend gems on insufficient funds, invalid names, or taken names", () => {
  const f = fixture(49n);
  f.run(server.setDisplayName, { displayName: "First Name" });
  const changedAt = f.db.playerNameCooldown.identity.find(f.ctx.sender).changedAt;
  advance(f);
  expect(() => rename(f)).toThrow();
  expect(() => rename(f, "!invalid!")).toThrow("Name must");
  f.seed("playerProfile", { identity: identity("2"), displayName: "Taken Name" });
  expect(() => rename(f, "taken name")).toThrow("already taken");
  expect(balance(f)).toBe(49n);
  expect(name(f)).toBe("First Name");
  expect(f.db.playerNameCooldown.identity.find(f.ctx.sender).changedAt).toEqual(changedAt);
});

it("requires the expected fee and never silently charges legacy or tutorial requests", () => {
  const f = fixture();
  expect(() => rename(f)).toThrow("Reopen");
  f.run(server.setDisplayName, { displayName: "Quiet Owl 587" });
  advance(f);
  expect(() => f.run(server.setDisplayName, { displayName: "Another Name" })).toThrow("50 Gems");
  expect(() => rename(f, "Another Name", 1)).toThrow("Reopen");
  expect(balance(f)).toBe(100n);
  rename(f); // Generated-looking names cannot bypass the recorded history.
  expect(balance(f)).toBe(50n);
});

it("uses existing history and provides the server time with the cost and wallet balance", () => {
  expect(nameChangeStatus(null, 100, 0)).toEqual({ cost: 0, availableAtMs: 0, serverNowMs: 100, balance: 0 });
  expect(nameChangeStatus(0, 100, 50)).toEqual({ cost: 50, availableAtMs: NAME_CHANGE_COOLDOWN_MS, serverNowMs: 100, balance: 50 });
  const f = fixture();
  f.seed("playerNameCooldown", { identity: f.ctx.sender, changedAt: f.ctx.timestamp });
  expect(() => rename(f)).toThrow("24 hours");
  advance(f);
  rename(f);
  expect(balance(f)).toBe(50n);
});
