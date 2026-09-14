import { expect, it, vi } from "vitest";
import { Timestamp } from "../../tests/helpers/spacetime-memory-db";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { readPublicChatPage } from "./public-chat-history";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("retains more than 200 messages and serves complete, nonoverlapping 50-message pages", () => {
  const f = crystalFixture();
  for (let i = 0; i < 253; i++) {
    f.ctx.timestamp = new Timestamp(BigInt(i + 1) * 4_000_000n);
    f.run(server.sendChatMessage, { message: `Message ${i}` });
  }
  expect(f.db.chatMessage.count()).toBe(253n);
  const scan = vi.spyOn(f.db.chatMessage, "iter");
  let page = readPublicChatPage(f.ctx as any), total = 0;
  const seen = new Set<bigint>();
  do {
    expect(page.messages.length).toBeLessThanOrEqual(50);
    for (const row of page.messages) { expect(seen.has(row.id)).toBe(false); seen.add(row.id); }
    total += page.messages.length;
    if (!page.hasMore) break;
    page = readPublicChatPage(f.ctx as any, page.messages[0].id);
  } while (true);
  expect(total).toBe(253);
  expect(scan).not.toHaveBeenCalled();
  expect(readPublicChatPage(f.ctx as any, 1n).messages).toEqual([]);
});

it("expires public chat after 24 hours while preserving moderation evidence", () => {
  const f = crystalFixture();
  f.run(server.sendChatMessage, { message: "send nudes" });
  f.ctx.timestamp = new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + 86_401_000_000n);
  f.run(server.sendChatMessage, { message: "New message" });
  f.run(server.runMaintenanceSweep, { maintenance: {} });
  expect([...f.db.chatMessage.iter()].map(row => row.message)).toEqual(["New message"]);
  expect(readPublicChatPage(f.ctx as any).messages).toHaveLength(1);
  expect([...f.db.moderationAction.iter()][0].before).toBe("send nudes");
});
