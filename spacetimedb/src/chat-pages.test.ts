import { expect, it, vi } from "vitest";
import { crystalFixture, server, identity } from "../../tests/helpers/crystal-hollows-fixture";
import { socialHistoryPage } from "./social-service";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("serves exactly 50 public messages and pages older IDs despite interleaved new messages", () => {
  const f = crystalFixture();
  for (let i = 1; i <= 200; i++) f.seed("chatMessage", { id: BigInt(i), sender: f.ctx.sender, senderName: "Player", message: String(i) });
  const proc = { withTx: (callback: (ctx: unknown) => unknown) => callback(f.ctx) };
  expect(server.latestChatMessages(f.ctx as never)).toHaveLength(50);
  const first = server.getChatHistory(proc as never, { beforeId: 0n });
  expect(first.messages[0].id).toBe(151n);
  f.seed("chatMessage", { id: 201n, sender: f.ctx.sender, senderName: "Player", message: "new" });
  const older = server.getChatHistory(proc as never, { beforeId: 151n });
  expect(older.messages.map(row => row.id)).toEqual(Array.from({ length: 50 }, (_, i) => BigInt(101 + i)));
  expect(first.hasMore).toBe(true);
  expect(server.getChatHistory(proc as never, { beforeId: 2n }).hasMore).toBe(false);
});
it("never returns another conversation's messages and revokes history after leaving a guild", () => {
  const f = crystalFixture();
  const peer = identity("2");
  f.seed("playerProfile", { identity: peer, displayName: "Peer" });
  const conversation = `dm:${[f.ctx.sender.toHexString(), peer.toHexString()].sort().join(":")}`;
  f.seed("socialMessage", { id: 1n, sender: f.ctx.sender, recipient: peer, channel: "dm", conversation, message: "private" });
  const scan = vi.spyOn(f.db.playerProfile, "iter");
  expect(socialHistoryPage(f.ctx as never, "dm", peer.toHexString(), 0n).messages).toHaveLength(1);
  expect(scan).not.toHaveBeenCalled();
  f.ctx.sender = identity("3");
  expect(socialHistoryPage(f.ctx as never, "dm", peer.toHexString(), 0n).messages).toHaveLength(0);
  expect(() => socialHistoryPage(f.ctx as never, "guild", "", 0n)).toThrow(/Join a guild/);
});
