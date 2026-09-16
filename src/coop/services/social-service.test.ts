import { describe, expect, it, vi } from "vitest";
import { Identity } from "spacetimedb";
import type { ReducerPort } from "../ports";
import { createSocialService } from "./social-service";

const identity = (n: number) => Identity.fromString(n.toString(16).padStart(64, "0"));
const alice = identity(1), bob = identity(2), cara = identity(3);
const snapshot = { identity: alice.toHexString(), signedIn: true, friends: [{ identity: bob.toHexString(), name: "Bob", online: false }],
  incomingRequests: [], outgoingRequests: [], guildInvitations: [], outgoingGuildInvitations: [], currentGuild: { id: "4", name: "Test" } };
function harness() {
  const connection = { isActive: true, reducers: { friendAction: vi.fn(async () => {}), guildInviteAction: vi.fn(async () => {}),
    sendSocialMessage: vi.fn(async () => {}), reportSocialMessage: vi.fn(async () => {}) },
    procedures: { getSocialHub: vi.fn(async () => JSON.stringify(snapshot)) } };
  let active = connection;
  const drain = vi.fn(async () => true);
  const service = createSocialService({ reducers: { connection: () => active, protocolBlocked: () => false,
    runWorldReducer: async (fn: () => unknown) => fn(), errorMessage: (error: Error) => error.message } as unknown as ReducerPort,
    localIdentity: () => alice.toHexString(), notify: vi.fn(), drainPendingProgress: drain });
  const row = (id: bigint, channel: string, sender = bob, recipient = alice) => ({ id, channel, guildId: channel === "guild" ? 4n : 0n,
    sender, recipient, senderName: sender.equals(bob) ? "Bob" : "Alice", recipientName: recipient.equals(cara) ? "Cara" : "Alice",
    senderGender: 0, powerLevel: 10, message: "Hello", moderated: false, sentAt: { microsSinceUnixEpoch: 1_000n },
    replyToMessageId: 0n, replyToSenderName: "", replyToMessage: "" });
  return { service, connection, drain, row, replace() { active = { ...connection }; } };
}
describe("private social client state", () => {
  it("keeps archived conversation names when their messages are outside the live page", async () => {
    const h = harness();
    h.connection.procedures.getSocialHub.mockResolvedValue(JSON.stringify({ ...snapshot, conversations: [{ identity: cara.toHexString(), name: "Cara" }] }));
    await h.service.api.loadSocial();
    expect(h.service.api.privateConversations()).toContainEqual({ identity: cara.toHexString(), name: "Cara" });
    expect(h.service.api.privateMessages(cara.toHexString())).toEqual([]);
  });
  it("keeps guild and each private conversation separate, including outbound messages", async () => {
    const h = harness(); await h.service.api.loadSocial();
    h.service.tables.upsertMessage(h.row(1n, "guild"));
    h.service.tables.upsertMessage(h.row(2n, "dm"));
    h.service.tables.upsertMessage(h.row(3n, "dm", alice, cara));
    expect(h.service.api.guildMessages().map(row => row.id)).toEqual([1n]);
    expect(h.service.api.privateMessages("bOB").map(row => row.id)).toEqual([2n]);
    expect(h.service.api.privateMessages("Cara").map(row => row.id)).toEqual([3n]);
    expect(h.service.api.privateConversations()).toMatchObject([{ identity: cara.toHexString(), name: "Cara", lastMessage: "Hello", lastMessageMine: true }, { identity: bob.toHexString(), name: "Bob", lastMessage: "Hello", lastMessageMine: false }]);
  });
  it("updates previews without resetting paged history on every incoming message", () => {
    const h = harness();
    const base = { ...snapshot, conversations: [{ identity: bob.toHexString(), name: "Bob", lastMessage: "one", lastSentAtMs: 1 }] };
    h.service.tables.upsertHub({ identity: alice, snapshot: JSON.stringify(base) });
    const revision = h.service.api.historyRevision();
    h.service.tables.upsertHub({ identity: alice, snapshot: JSON.stringify({ ...base,
      conversations: [{ ...base.conversations[0], lastMessage: "two", lastSentAtMs: 2 }] }) });
    expect(h.service.api.historyRevision()).toBe(revision);
    expect(h.service.api.privateConversations()[0].lastMessage).toBe("two");
  });
  it("removes revoked rows immediately and clears every cache on session change", async () => {
    const h = harness(); await h.service.api.loadSocial(); h.service.tables.upsertMessage(h.row(1n, "dm"));
    h.service.tables.removeMessage({ id: 1n }); expect(h.service.api.privateMessages("Bob")).toEqual([]);
    h.service.tables.upsertMessage(h.row(2n, "guild")); h.service.resetSession();
    expect(h.service.api.guildMessages()).toEqual([]); expect(h.service.api.friends()).toEqual([]);
    expect(h.service.api.currentGuild()).toBeNull();
  });
  it("resolves known friends by identity without mixing a reused historical username", async () => {
    const h = harness(); await h.service.api.loadSocial();
    h.service.tables.upsertMessage(h.row(1n, "dm"));
    h.service.tables.upsertMessage({ ...h.row(2n, "dm", cara), senderName: "Bob" });
    expect(h.service.api.privateMessages("Bob").map(row => row.id)).toEqual([1n]);
    expect(h.service.api.privateMessages(cara.toHexString()).map(row => row.id)).toEqual([2n]);
  });
  it("does not reintroduce guild access when an older snapshot resolves after a live update", async () => {
    const h = harness(); let resolve!: (value: string) => void;
    h.connection.procedures.getSocialHub.mockReturnValue(new Promise(done => { resolve = done; }));
    const load = h.service.api.loadSocial();
    h.service.tables.upsertHub({ identity: alice, snapshot: JSON.stringify({ ...snapshot, currentGuild: null }) });
    resolve(JSON.stringify(snapshot)); await load;
    expect(h.service.api.currentGuild()).toBeNull();
  });
  it("rejects late snapshots from a replaced connection", async () => {
    const h = harness(); let resolve!: (value: string) => void;
    h.connection.procedures.getSocialHub.mockReturnValue(new Promise(done => { resolve = done; }));
    const load = h.service.api.loadSocial(); h.replace(); resolve(JSON.stringify(snapshot));
    await expect(load).rejects.toThrow("session changed"); expect(h.service.api.friends()).toEqual([]);
  });
  it("drains progress before accepting a guild invitation and rejects overlapping actions", async () => {
    const h = harness(); let resolve!: (value: boolean) => void;
    h.drain.mockReturnValue(new Promise(done => { resolve = done; }));
    const accept = h.service.api.socialAction({ action: "acceptGuildInvite", invitationId: "7" });
    await expect(h.service.api.socialAction({ action: "requestFriend", username: "Bob" })).rejects.toThrow("already being saved");
    resolve(false); await expect(accept).rejects.toThrow("still syncing");
    expect(h.connection.reducers.guildInviteAction).not.toHaveBeenCalled();
  });
  it("sends private replies through the private reducer with their recipient", async () => {
    const h = harness(); expect(await h.service.api.sendPrivateMessage("Bob", "Hi", 9n)).toEqual({ ok: true });
    expect(h.connection.reducers.sendSocialMessage).toHaveBeenCalledWith({ channel: "dm", target: "Bob", message: "Hi", replyToMessageId: 9n });
  });
});

it("reuses indexed conversations until data changes and invalidates removed or renamed peers", async () => {
  const h = harness(); await h.service.api.loadSocial();
  h.service.tables.upsertMessage(h.row(1n, "dm"));
  h.service.tables.upsertMessage(h.row(2n, "guild"));
  const conversations = h.service.api.privateConversations(), dm = h.service.api.privateMessages("Bob"), guild = h.service.api.guildMessages();
  for (let i = 0; i < 100; i++) {
    expect(h.service.api.privateConversations()).toBe(conversations);
    expect(h.service.api.privateMessages(bob.toHexString())).toBe(dm);
    expect(h.service.api.guildMessages()).toBe(guild);
  }
  h.service.tables.upsertHub({ identity: alice, snapshot: JSON.stringify({ ...snapshot, friends: [{ ...snapshot.friends[0], name: "NewBob" }] }) });
  expect(h.service.api.privateConversations()[0].name).toBe("NewBob");
  expect(h.service.api.privateMessages("NewBob")).toHaveLength(1);
  h.service.tables.removeMessage({ id: 1n });
  expect(h.service.api.privateMessages("NewBob")).toEqual([]);
  h.service.resetSession();
  expect(h.service.api.privateConversations()).toEqual([]);
  expect(h.service.api.guildMessages()).toEqual([]);
});
