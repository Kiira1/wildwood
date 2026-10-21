import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnosticWebSocket } from "./diagnostic-websocket";
class FakeSocket extends EventTarget {
  static latest: FakeSocket;
  protocol = "v1.bsatn.spacetimedb"; readyState = 1; binaryType = "";
  onclose: ((e: CloseEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => Promise<void>) | null = null;
  close = vi.fn(); send = vi.fn();
  constructor(readonly url: string, readonly protocols: string[]) { super(); FakeSocket.latest = this; }
}
const args = { url: new URL("wss://test.example"), wsProtocol: ["v1.bsatn.spacetimedb"], nameOrAddress: "test-db", compression: "gzip" as const, lightMode: false };
function setup() {
  vi.stubGlobal("WebSocket", FakeSocket); const record = vi.fn();
  return { record, factory: diagnosticWebSocket(record, { transport: "account", database: "test-db" }) };
}
afterEach(() => vi.unstubAllGlobals());
describe("diagnostic WebSocket credentials", () => {
  it("uses only the temporary WebSocket token and fails when the exchange fails", async () => {
    const { factory, record } = setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ token: "temporary" }) }).mockResolvedValueOnce({ ok: false, status: 503, statusText: "Service Unavailable" }));
    await factory({ ...args, authToken: "private-credential" });
    expect(FakeSocket.latest.url).toContain("token=temporary"); expect(FakeSocket.latest.url).not.toContain("private-credential");
    await expect(factory({ ...args, authToken: "private-credential" })).rejects.toThrow();
    expect(JSON.stringify(record.mock.calls)).not.toContain("private-credential");
  });
  it("renews credentials before connecting and retries a 401 once without exposing tokens", async () => {
    const { record } = setup(); const resolve = vi.fn().mockResolvedValueOnce("current-id").mockResolvedValueOnce("renewed-id");
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 }).mockResolvedValueOnce({ ok: true, json: async () => ({ token: "temporary" }) });
    vi.stubGlobal("fetch", fetch);
    await diagnosticWebSocket(record, { transport: "account", database: "test-db" }, resolve)({ ...args, authToken: "old-id" });
    expect(resolve.mock.calls).toEqual([["old-id", false], ["current-id", true]]);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer renewed-id");
    expect(FakeSocket.latest.url).toContain("token=temporary");
    expect(JSON.stringify(record.mock.calls)).not.toContain("renewed-id");
  });
  it("cancels a stale portal connection while credential renewal is pending", async () => {
    setup(); let current = true; let finish!: (token: string) => void;
    const resolve = () => new Promise<string>(r => { finish = r; });
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const pending = diagnosticWebSocket(vi.fn(), { transport: "account", database: "test-db", isCurrent: () => current }, resolve)({ ...args, authToken: "old" });
    current = false; finish("renewed");
    await expect(pending).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
});
