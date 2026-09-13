import { describe, expect, it, vi } from "vitest";
import { DbConnection } from "../../module_bindings";
import { guardConnectionActivity } from "./connection-activity";

async function openConnection() {
  // Use the real SDK's v3 batching; browsers delay the close event after
  // readyState changes, unlike a mock that fires onclose inside close().
  const socket = {
    protocol: "v3.bsatn.spacetimedb", readyState: 1,
    onopen: () => {}, onclose: (_event: CloseEvent) => {},
    onmessage: (_message: { data: Uint8Array }) => {}, onerror: (_event: ErrorEvent) => {},
    send: vi.fn((_message: Uint8Array) => { sentStates.push(socket.readyState); }),
    close: vi.fn(() => { socket.readyState = 2; }),
  };
  const sentStates: number[] = [];
  const disconnected = vi.fn();
  const connection = guardConnectionActivity(DbConnection.builder()
    .withUri("ws://localhost:3000").withDatabaseName("connection-test")
    .withWSFn(async () => socket).onDisconnect(disconnected).build());
  await Promise.resolve();
  socket.onopen();
  const queue = () => connection.subscriptionBuilder().subscribe("SELECT * FROM player");
  return { connection, socket, sentStates, disconnected, queue };
}

describe("connection activity during socket shutdown", () => {
  it("stops a queued v3 flush immediately after disconnect is requested", async () => {
    const { connection, socket, sentStates, queue } = await openConnection();
    connection.disconnect();
    queue();
    expect(connection.isActive).toBe(false);
    await Promise.resolve();
    expect(socket.readyState).toBe(2);
    expect(sentStates).toEqual([]);
  });

  it.each([2, 3])("stops an already queued flush when readyState becomes %s before onclose", async state => {
    const { connection, socket, sentStates, queue } = await openConnection();
    queue();
    socket.readyState = state;
    expect(connection.isActive).toBe(false);
    await Promise.resolve();
    expect(sentStates).toEqual([]);
  });

  it("keeps open-socket batching, close callbacks, and a fresh connection working", async () => {
    const first = await openConnection();
    first.queue(); first.queue();
    await Promise.resolve();
    expect(first.sentStates).toEqual([1]);
    first.connection.disconnect();
    await Promise.resolve();
    first.socket.readyState = 3;
    first.socket.onclose({} as CloseEvent);
    expect(first.disconnected).toHaveBeenCalledOnce();
    expect(first.connection.isActive).toBe(false);
    const next = await openConnection();
    expect(next.connection.isActive).toBe(true);
    next.queue();
    await Promise.resolve();
    expect(next.sentStates).toEqual([1]);
  });
});
