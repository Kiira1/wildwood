import { describe, expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { cleanupConnectionDiagnostics } from "./connection-diagnostics";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));
const sample = { eventId: "diagnostic-0001", kind: "socket-close", occurredAtMs: 10000, clientVersion: "0.685", mapId: "samurai_garden", detail: "closed" };
describe("private connection diagnostics", () => {
  it("links events to the authenticated sender and deduplicates replayed batches", () => {
    const f = crystalFixture();
    const payload = JSON.stringify([{ ...sample, identity: "forged", playerName: "forged", token: "secret" }]);
    f.run(server.recordConnectionDiagnostic, { payload }); f.run(server.recordConnectionDiagnostic, { payload });
    const rows = [...f.db.connectionDiagnostic.iter()]; expect(rows).toHaveLength(1);
    expect(rows[0].identity).toEqual(f.ctx.sender); expect(rows[0].playerName).toBe("Test Player");
    expect(rows[0].detailsJson).not.toMatch(/forged|secret/);
  });
  it("accepts diagnostics before world entry and rejects malformed input without scans", () => {
    const f = crystalFixture();
    const session = f.db.playerSession.connectionId.find(f.ctx.connectionId);
    f.db.playerSession.connectionId.update({ ...session, enteredWorld: false });
    f.run(server.recordConnectionDiagnostic, { payload: JSON.stringify([sample]) });
    f.run(server.recordConnectionDiagnostic, { payload: "not json" });
    expect(f.db.connectionDiagnostic.count()).toBe(1n);
  });
  it("caps per-player volume without scanning history on the record path", () => {
    const f = crystalFixture(); const scan = vi.spyOn(f.db.connectionDiagnostic, "iter");
    for (let batch = 0; batch < 12; batch++) f.run(server.recordConnectionDiagnostic, { payload: JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ ...sample, eventId: `diagnostic-${batch}-${i}` }))) });
    expect(f.db.connectionDiagnostic.count()).toBe(120n); expect(scan).not.toHaveBeenCalled();
    scan.mockRestore();
  });
  it("expires retained events and rate rows", () => {
    const f = crystalFixture(); f.run(server.recordConnectionDiagnostic, { payload: JSON.stringify([sample]) });
    f.ctx.timestamp = new (f.ctx.timestamp.constructor as typeof import("spacetimedb").Timestamp)(8n * 86400n * 1000000n);
    cleanupConnectionDiagnostics(f.ctx);
    expect(f.db.connectionDiagnostic.count()).toBe(0n); expect(f.db.connectionDiagnosticRate.count()).toBe(0n);
  });
});
