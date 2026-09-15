import { expect, it, vi } from "vitest";
import { crystalFixture, server, identity } from "../../tests/helpers/crystal-hollows-fixture";
import { readChatReactions, setChatReaction, removeMessageReactions, mergeAccountReactions } from "./chat-reactions";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));
function fixture() {
  const f = crystalFixture(), author = identity("2");
  f.seed("chatMessage", { id: 1n, sender: author, senderName: "Author", message: "Hello", sentAt: f.ctx.timestamp });
  return { ...f, author, react: (reaction = "heart", active = true) => f.run(server.setChatMessageReaction, { channel: "public", messageId: 1n, reaction, active }) };
}
it("counts distinct reactions and credits each received heart only once", () => {
  const f = fixture();
  f.react(); f.react(); f.react("like");
  expect(readChatReactions(f.ctx as any, "public", 1n)).toEqual({ counts: { like: 1 }, selected: ["like"] });
  expect(f.db.playerChatHearts.identity.find(f.author).chatHeartsReceived).toBe(1n);
  f.react("heart", false); f.react("heart", true);
  expect(f.db.playerChatHearts.identity.find(f.author).chatHeartsReceived).toBe(1n);
  const second = { ...f.ctx, sender: identity("3") } as any;
  setChatReaction(second, "public", 1n, "heart", true);
  expect(readChatReactions(second, "public", 1n).counts.heart).toBe(2);
  expect(f.db.playerChatHearts.identity.find(f.author).chatHeartsReceived).toBe(2n);
  removeMessageReactions(f.ctx as any, "public", 1n);
  expect([...f.db.chatReaction.iter()]).toHaveLength(0);
  expect(f.db.playerChatHearts.identity.find(f.author).chatHeartsReceived).toBe(2n);
});
it("rejects self reactions without changing counts or lifetime hearts", () => {
  const f = fixture();
  expect(() => setChatReaction({ ...f.ctx, sender: f.author } as any, "public", 1n, "heart", true)).toThrow("own message");
  expect(f.db.chatReactionSummary.key.find("public:1")).toBeNull();
  expect(f.db.playerChatHearts.identity.find(f.author)).toBeNull();
});
it("protects private/guild messages and keeps message id namespaces separate", () => {
  const f = fixture();
  f.seed("socialMessage", { id: 1n, channel: "dm", sender: f.author, recipient: identity("3"), message: "Private" });
  expect(() => readChatReactions(f.ctx as any, "social", 1n)).toThrow("Message unavailable");
  expect(() => setChatReaction(f.ctx as any, "social", 1n, "heart", true)).toThrow("Message unavailable");
  f.react();
  expect(f.db.chatReactionSummary.key.find("social:1")).toBeNull();
  f.db.socialMessage.id.update({ ...f.db.socialMessage.id.find(1n), channel: "guild", guildId: 7n });
  expect(() => readChatReactions(f.ctx as any, "social", 1n)).toThrow();
  f.seed("guildMember", { identity: f.ctx.sender, guildId: 7n });
  setChatReaction(f.ctx as any, "social", 1n, "laugh", true);
  expect(readChatReactions(f.ctx as any, "social", 1n).counts).toEqual({ laugh: 1 });
});
it("rejects moderated messages, blocked senders, and unsupported emoji", () => {
  const f = fixture();
  expect(() => f.react("anything")).toThrow("Unknown reaction");
  f.db.chatMessage.id.update({ ...f.db.chatMessage.id.find(1n), moderated: true });
  expect(() => f.react()).toThrow("Message unavailable");
  f.db.chatMessage.id.update({ ...f.db.chatMessage.id.find(1n), moderated: false });
  f.seed("playerBlock", { key: `${f.author.toHexString()}:${f.ctx.sender.toHexString()}`, owner: f.author, target: f.ctx.sender });
  expect(() => f.react()).toThrow("Message unavailable");
});
it("keeps heart credit history when a guest registers", () => {
  const f = fixture(), account = identity("4");
  f.react(); f.react("heart", false);
  mergeAccountReactions(f.ctx as any, f.ctx.sender, account);
  setChatReaction({ ...f.ctx, sender: account } as any, "public", 1n, "heart", true);
  expect(f.db.playerChatHearts.identity.find(f.author).chatHeartsReceived).toBe(1n);
});
it("preserves legacy message and lifetime records while new views carry reactions", () => {
  const f = fixture();
  const original = { ...f.db.chatMessage.id.find(1n) };
  f.react();
  expect(f.db.chatMessage.id.find(1n)).toEqual(original);
  expect(f.db.playerLifetime.identity.find(f.author)).toBeNull();
  expect((server.latestChatMessages as any)(f.ctx)[0]).not.toHaveProperty("reactionCountsJson");
  expect(JSON.parse((server.latestChatMessagesWithReactions as any)(f.ctx)[0].reactionCountsJson)).toEqual({ heart: 1 });
  const proc = { withTx: (fn: Function) => fn(f.ctx) };
  expect((server.getChatHistory as any)(proc, { beforeId: 0n }).messages[0]).not.toHaveProperty("reactionCountsJson");
  expect(JSON.parse((server.getChatHistoryWithReactions as any)(proc, { beforeId: 0n }).messages[0].reactionCountsJson)).toEqual({ heart: 1 });
});
it("only exposes social reaction totals through authorized message views", () => {
  const f = fixture();
  f.seed("socialMessage", { id: 1n, channel: "dm", sender: f.author, recipient: f.ctx.sender, message: "Private", sentAt: f.ctx.timestamp });
  setChatReaction(f.ctx as any, "social", 1n, "heart", true);
  expect((server.mySocialMessagesWithReactions as any)(f.ctx)).toHaveLength(1);
  expect((server.mySocialMessagesWithReactions as any)({ ...f.ctx, sender: identity("3") })).toHaveLength(0);
  f.seed("playerBlock", { key: `${f.ctx.sender.toHexString()}:${f.author.toHexString()}`, owner: f.ctx.sender, target: f.author });
  expect((server.mySocialMessagesWithReactions as any)(f.ctx)).toHaveLength(0);
});
it("merges lifetime totals and deduplicates overlapping guest reactions", () => {
  const f = fixture(), account = identity("4");
  f.seed("playerChatHearts", { identity: f.ctx.sender, chatHeartsReceived: 3n });
  f.seed("playerChatHearts", { identity: account, chatHeartsReceived: 5n });
  f.react("like");
  setChatReaction({ ...f.ctx, sender: account } as any, "public", 1n, "like", true);
  mergeAccountReactions(f.ctx as any, f.ctx.sender, account);
  expect(f.db.playerChatHearts.identity.find(account).chatHeartsReceived).toBe(8n);
  expect(f.db.playerChatHearts.identity.find(f.ctx.sender)).toBeNull();
  expect(readChatReactions({ ...f.ctx, sender: account } as any, "public", 1n).counts).toEqual({ like: 1 });
});

it("switches one player's reaction without changing other players' reactions", () => {
  const f = fixture(), other = { ...f.ctx, sender: identity("3") } as any;
  f.react("like");
  setChatReaction(other, "public", 1n, "like", true);
  f.react("laugh");
  expect(readChatReactions(f.ctx as any, "public", 1n)).toEqual({ counts: { like: 1, laugh: 1 }, selected: ["laugh"] });
  f.react("laugh"); // Retried selection cannot increase the count.
  f.react("like", false); // A stale removal cannot clear the newer selection.
  expect(readChatReactions(f.ctx as any, "public", 1n).selected).toEqual(["laugh"]);
  f.react("laugh", false);
  expect(readChatReactions(f.ctx as any, "public", 1n)).toEqual({ counts: { like: 1 }, selected: [] });
});
it("cleans up existing multiple selections on the next selection", () => {
  const f = fixture();
  for (const reaction of ["like", "laugh", "heart"]) {
    f.seed("chatReaction", { key: `public:1:${f.ctx.sender.toHexString()}:${reaction}`, messageKey: "public:1",
      actor: f.ctx.sender, reaction, active: true, heartCredited: reaction === "heart" });
  }
  f.seed("chatReactionSummary", { key: "public:1", countsJson: JSON.stringify({ like: 1, laugh: 1, heart: 1 }) });
  f.react("heart");
  expect(readChatReactions(f.ctx as any, "public", 1n)).toEqual({ counts: { heart: 1 }, selected: ["heart"] });
});
it("keeps one reaction when guest and account selections differ", () => {
  const f = fixture(), account = identity("4");
  f.react("laugh");
  setChatReaction({ ...f.ctx, sender: account } as any, "public", 1n, "heart", true);
  mergeAccountReactions(f.ctx as any, f.ctx.sender, account);
  expect(readChatReactions({ ...f.ctx, sender: account } as any, "public", 1n)).toEqual({ counts: { laugh: 1 }, selected: ["laugh"] });
  setChatReaction({ ...f.ctx, sender: account } as any, "public", 1n, "heart", true);
  expect(f.db.playerChatHearts.identity.find(f.author).chatHeartsReceived).toBe(1n);
});

it("rejects reactions to your own private and guild messages", () => {
  const f = fixture();
  for (const channel of ["dm", "guild"]) {
    f.seed("socialMessage", { id: channel === "dm" ? 2n : 3n, channel, sender: f.ctx.sender, recipient: f.author, guildId: 7n, message: "My message" });
  }
  f.seed("guildMember", { identity: f.ctx.sender, guildId: 7n });
  for (const messageId of [2n, 3n]) expect(() => f.run(server.setChatMessageReaction,
    { channel: "social", messageId, reaction: "like", active: true })).toThrow("own message");
  expect([...f.db.chatReaction.iter()]).toHaveLength(0);
});
