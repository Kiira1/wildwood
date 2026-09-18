import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
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
  expect(f.db.playerProgress.identity.find(f.ctx.sender)).not.toBeNull();
  f.db.playerController.identity.delete(f.ctx.sender);
  expect(() => f.run(server.requestAccountDeletion, { confirmation: "DELETE" })).toThrow();
});
