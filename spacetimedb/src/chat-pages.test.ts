import { expect, it, vi } from "vitest";
import { crystalFixture, server, identity } from "../../tests/helpers/crystal-hollows-fixture";
import { createSocialService, latestSocialMessages, socialSnapshot, socialHistoryPage } from "./social-service";
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

it("retains private history beyond both old caps and discovers conversations outside the live page", () => {
  const f = crystalFixture(), peer = identity("2"), olderPeer = identity("3");
  f.seed("playerProfile", { identity: peer, displayName: "Peer" });
  f.seed("playerProfile", { identity: olderPeer, displayName: "Old friend" });
  f.seed("socialFriend", { key: `${f.ctx.sender.toHexString()}:${peer.toHexString()}`, owner: f.ctx.sender, peer });
  const conversation = `dm:${[f.ctx.sender.toHexString(), peer.toHexString()].sort().join(":")}`;
  f.seed("socialMessage", { id: 1n, sender: olderPeer, recipient: f.ctx.sender, channel: "dm",
    conversation: `dm:${[f.ctx.sender.toHexString(), olderPeer.toHexString()].sort().join(":")}`, message: "old conversation" });
  for (let i = 2; i <= 602; i++) f.seed("socialMessage", { id: BigInt(i), sender: f.ctx.sender, recipient: peer, channel: "dm", conversation, message: String(i) });
  createSocialService({ joinGuild() {} }).sendMessage(f.ctx as never, "dm", peer.toHexString(), "new", 0n);
  expect([...f.db.socialMessage.iter()]).toHaveLength(603);
  expect(latestSocialMessages(f.ctx as never)).toHaveLength(50);
  expect(socialSnapshot(f.ctx as never).conversations).toContainEqual(expect.objectContaining({ identity: olderPeer.toHexString(), name: "Old friend" }));
  expect(socialHistoryPage(f.ctx as never, "dm", peer.toHexString(), 52n).messages.map(row => row.id)).toEqual(Array.from({ length: 50 }, (_, i) => BigInt(i + 2)));
  expect(socialHistoryPage(f.ctx as never, "dm", olderPeer.toHexString(), 0n).messages[0].id).toBe(1n);
  f.seed("playerBlock", { key: `${f.ctx.sender.toHexString()}:${olderPeer.toHexString()}`, owner: f.ctx.sender, blocked: olderPeer });
  expect(socialSnapshot(f.ctx as never).conversations).not.toContainEqual(expect.objectContaining({ identity: olderPeer.toHexString(), name: "Old friend" }));
  expect(() => socialHistoryPage(f.ctx as never, "dm", olderPeer.toHexString(), 0n)).toThrow(/unavailable/);
});
