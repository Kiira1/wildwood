import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { eraseKeepingRequest } from "./account-deletion";
import { progressOf } from "../../tests/helpers/progress";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));
it("queues only the controlling authenticated character, once, without pretending to erase it", () => {
  const f = crystalFixture();
  expect(() => f.run(server.requestAccountDeletion, { confirmation: "" })).toThrow(/Confirm/);
  f.run(server.requestAccountDeletion, { confirmation: "DELETE" });
  const row = f.db.accountDeletionRequest.identity.find(f.ctx.sender);
  expect(row.status).toBe("pending");
  f.run(server.requestAccountDeletion, { confirmation: "DELETE" });
  expect(f.db.accountDeletionRequest.count()).toBe(1n);
  expect(f.db.accountDeletionRequest.identity.find(f.ctx.sender)).toEqual(row);
  expect(progressOf(f, f.ctx.sender)).not.toBeNull();
  f.db.playerController.identity.delete(f.ctx.sender);
  expect(() => f.run(server.requestAccountDeletion, { confirmation: "DELETE" })).toThrow();
});

it("keeps the request queued as erasing until a pass finishes the account, then it is gone", () => {
  const f = crystalFixture();
  f.run(server.requestAccountDeletion, { confirmation: "DELETE" });
  const asked = f.db.accountDeletionRequest.identity.find(f.ctx.sender).requestedAt;
  const first = eraseKeepingRequest(f.ctx, [f.ctx.sender], 2);
  expect(first.complete).toBe(false);
  expect(f.db.accountDeletionRequest.identity.find(f.ctx.sender)).toMatchObject({ status: "erasing", requestedAt: asked });
  let guard = 0;
  while (!eraseKeepingRequest(f.ctx, [f.ctx.sender], 2).complete && guard++ < 500);
  expect(guard).toBeLessThan(500);
  expect(f.db.accountDeletionRequest.identity.find(f.ctx.sender)).toBeNull();
  expect(progressOf(f, f.ctx.sender)).toBeNull();
});
