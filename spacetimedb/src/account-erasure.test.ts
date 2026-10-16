import { expect, it, vi } from "vitest";
import { ERASURE_TARGETS, eraseIdentityRows } from "./account-erasure";
import { crystalFixture } from "../../tests/helpers/crystal-hollows-fixture";
import { Identity } from "../../tests/helpers/spacetime-memory-db";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("covers every table that holds an identity, and nothing twice", () => {
  // The list is generated from the schema. If a table is added with a
  // t.identity() column and not listed, erasure silently leaves data behind.
  const names = ERASURE_TARGETS.map(target => target.table);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toContain("playerProgress");
  expect(names).toContain("socialMessage");
  expect(names).toContain("chatMessage");
  expect(names).toContain("accountDeletionRequest");
  // The two event tables are deliver-and-drop, so there is nothing to erase.
  expect(names).not.toContain("bossHitResult");
  expect(names).not.toContain("playerMotionDetailFrame");
  for (const target of ERASURE_TARGETS) {
    expect(target.columns.length, target.table).toBeGreaterThan(0);
    if (target.mode === "index") expect(target.index, target.table).toBeTruthy();
    if (target.mode !== "scan") expect(target.pk, target.table).toBeTruthy();
  }
});

it("removes the account's rows and leaves everyone else's alone", () => {
  const f = crystalFixture();
  const other = Identity.fromString("c2".padEnd(64, "7"));
  f.progress(other, { damage: 5 });
  f.seed("playerLegalConsent", { identity: f.ctx.sender, termsVersion: "v1", ageBand: 2, acceptedAt: f.ctx.timestamp });
  f.seed("playerLegalConsent", { identity: other, termsVersion: "v1", ageBand: 2, acceptedAt: f.ctx.timestamp });
  f.seed("accountDeletionRequest", { identity: f.ctx.sender, requestedAt: f.ctx.timestamp, status: "pending" });

  const result = eraseIdentityRows(f.ctx, [f.ctx.sender]);

  expect(result.complete).toBe(true);
  expect(result.deleted).toBeGreaterThan(0);
  expect(progressOf(f, f.ctx.sender)).toBeNull();
  expect(f.db.playerLegalConsent.identity.find(f.ctx.sender)).toBeNull();
  expect(f.db.accountDeletionRequest.identity.find(f.ctx.sender)).toBeNull();
  // The other player is untouched.
  expect(progressOf(f, other)).not.toBeNull();
  expect(f.db.playerLegalConsent.identity.find(other)).not.toBeNull();
});

it("is safe to run again once an account is clean", () => {
  const f = crystalFixture();
  eraseIdentityRows(f.ctx, [f.ctx.sender]);
  const second = eraseIdentityRows(f.ctx, [f.ctx.sender]);
  expect(second.deleted).toBe(0);
  expect(second.complete).toBe(true);
});

it("stops at its row budget and says what is left", () => {
  const f = crystalFixture();
  f.seed("playerLegalConsent", { identity: f.ctx.sender, termsVersion: "v1", ageBand: 2, acceptedAt: f.ctx.timestamp });
  const first = eraseIdentityRows(f.ctx, [f.ctx.sender], 1);
  expect(first.deleted).toBe(1);
  expect(first.complete).toBe(false);
  expect(first.remaining.length).toBeGreaterThan(0);
  // Running it out finishes the job.
  let guard = 0;
  while (!eraseIdentityRows(f.ctx, [f.ctx.sender], 1).complete && guard++ < 200);
  expect(guard).toBeLessThan(200);
  expect(progressOf(f, f.ctx.sender)).toBeNull();
});

it("erases only the account asked for: a linked guest or registered half stays, the link between them goes", async () => {
  const { server } = await import("../../tests/helpers/crystal-hollows-fixture");
  const f = crystalFixture();
  const guest = Identity.fromString("c2".padEnd(64, "9"));
  f.progress(guest, { damage: 3 });
  f.seed("playerProfile", { identity: guest, displayName: "Bright Fox 814" });
  f.seed("analyticsConversion", { id: 1n, guestIdentity: guest, accountIdentity: f.ctx.sender, dayKey: "2026-09-22" });
  const account = f.ctx.sender;
  f.ctx.sender = Identity.fromString("c200383520521c925f3cf6deafb20cd6a7d6168d1c31cb3c0ddb731c197a2d79");
  f.run(server.devEraseAccount, { identityHex: guest.toHexString(), confirmation: "ERASE", reason: "test" });
  expect(progressOf(f, guest)).toBeNull();
  expect(progressOf(f, account)).not.toBeNull();
  expect(f.db.analyticsConversion.count()).toBe(0n);
  f.seed("analyticsConversion", { id: 2n, guestIdentity: guest, accountIdentity: account, dayKey: "2026-09-22" });
  f.progress(guest, { damage: 3 });
  f.run(server.devEraseAccount, { identityHex: account.toHexString(), confirmation: "ERASE", reason: "test" });
  expect(progressOf(f, account)).toBeNull();
  expect(progressOf(f, guest)).not.toBeNull();
});

it("finds rows keyed in snake_case and rows naming the player second", () => {
  // gem_purchase and player_session have snake_case keys in the schema, and a
  // friendship lists this player as the peer rather than the owner.
  const f = crystalFixture();
  const friend = Identity.fromString("c2".padEnd(64, "5"));
  f.seed("gemPurchase", { reservationId: "r-1", identity: f.ctx.sender, packId: "small", status: "settled",
    createdAt: f.ctx.timestamp, updatedAt: f.ctx.timestamp });
  f.seed("socialFriend", { key: "friend-1", owner: friend, peer: f.ctx.sender });
  expect(f.db.playerSession.connectionId.find(f.ctx.connectionId)).not.toBeNull();

  eraseIdentityRows(f.ctx, [f.ctx.sender]);

  expect(f.db.gemPurchase.reservationId.find("r-1")).toBeNull();
  expect(f.db.playerSession.connectionId.find(f.ctx.connectionId)).toBeNull();
  expect(f.db.socialFriend.key.find("friend-1")).toBeNull();
});

it("covers the tables 0.812 added", () => {
  const f = crystalFixture();
  f.seed("guildJoinRequest", { identity: f.ctx.sender, guildId: 1n, requestedAt: 1n });
  f.seed("playerJoinDate", { identity: f.ctx.sender, joinedAt: f.ctx.timestamp });
  eraseIdentityRows(f.ctx, [f.ctx.sender]);
  expect(f.db.guildJoinRequest.identity.find(f.ctx.sender)).toBeNull();
  expect(f.db.playerJoinDate.identity.find(f.ctx.sender)).toBeNull();
});

it("reads a unique index (find only, as SpacetimeDB 2.11 has it) instead of crashing on filter", () => {
  // Every live erase threw "index.filter is not a function" on such an accessor (2026-10-12); the memory
  // test database gives every index a filter, so only a hand-made one shows the runtime's shape.
  const player = Identity.fromString("c2".padEnd(64, "4"));
  const rows = new Map([["k1", { key: "k1", identity: player }]]);
  const ctx = { db: { pausedResearch: {
    identity: { find: (identity: any) => [...rows.values()].find(row => row.identity.isEqual(identity)) ?? null },
    key: { find: (key: string) => rows.get(key) ?? null, delete: (key: string) => rows.delete(key) },
    iter: () => rows.values(),
  } } };
  const result = eraseIdentityRows(ctx, [player]);
  expect(result).toMatchObject({ deleted: 1, complete: true });
  expect(rows.size).toBe(0);
});
