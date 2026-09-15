import { expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { requestPatreonSupport } from "./patreon-support";
import { patreonStatus } from "./patreon";
import { DEVELOPER_IDENTITY } from "../../shared/developer-identity";
import { Identity, Timestamp } from "../../tests/helpers/spacetime-memory-db";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("stores the contact privately with the server-owned character and never grants a membership", () => {
  const f = crystalFixture();
  requestPatreonSupport(f.ctx as any, " patron@example.com ");
  const rows = [...f.db.bugReport.iter()];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ reporter: f.ctx.sender, reporterName: "Test Player" });
  expect(rows[0].message).toContain("patron@example.com");
  expect([...f.db.chatMessage.iter()]).toHaveLength(0);
  expect([...f.db.patreonLink.iter()]).toHaveLength(0);
  expect(() => requestPatreonSupport(f.ctx as any, "other@example.com")).toThrow("received");
  f.ctx.timestamp = new Timestamp(100_000_000n);
  requestPatreonSupport(f.ctx as any, "corrected@example.com");
  expect([...f.db.bugReport.iter()]).toHaveLength(1);
  expect([...f.db.bugReport.iter()][0].message).toContain("corrected@example.com");
});
it.each(["", "username", "a@b", "a@b.com\nFake claim", "a".repeat(250) + "@b.com"])("rejects invalid support emails: %s", email => {
  const f = crystalFixture();
  expect(() => requestPatreonSupport(f.ctx as any, email)).toThrow("email address");
  expect([...f.db.bugReport.iter()]).toHaveLength(0);
});
it("gives only the developer a selectable Gold preview without announcing a purchase", () => {
  const f = crystalFixture();
  f.ctx.sender = Identity.fromString(DEVELOPER_IDENTITY);
  expect(patreonStatus(f.ctx as any, f.ctx.sender)).toMatchObject({ preview: true, tier: "gold", frame: "gold", linked: false });
  f.run(server.setAvatarFrame, { frame: "silver" });
  expect(patreonStatus(f.ctx as any, f.ctx.sender).frame).toBe("silver");
  f.run(server.setAvatarFrame, { frame: "none" });
  expect(patreonStatus(f.ctx as any, f.ctx.sender).frame).toBe("none");
  expect([...f.db.chatMessage.iter()]).toHaveLength(0);
  expect([...f.db.patreonLink.iter()]).toHaveLength(0);
  expect(patreonStatus(f.ctx as any, identity("2"))).toMatchObject({ tier: "none", frame: "none" });
});
