import { describe, expect, it, vi } from "vitest";
import { createReleaseApi, executeRollout, mapLimit } from "./rollout.mjs";
import { releaseScope } from "./cli.mjs";
function fixture() {
  let clock = 0;
  const d = { now: () => clock, sleep: async ms => { clock += ms; },
    phase: vi.fn(async () => {}), deployWeb: vi.fn(async () => {}), deployServers: vi.fn(async () => { clock += 1200; }),
    missingAcknowledgements: vi.fn(async () => 0) };
  return { d, plan: { id: "release-1", version: "0.696", startsAt: 10000, reload: true, webRun: 123 } };
}
describe("prepared release orchestration", () => {
  it("publishes prepared web before switching servers and records actual interruption", async () => {
    const f = fixture(); const timing = await executeRollout(f.plan, f.d);
    expect(f.d.phase.mock.calls.map(args => args[1])).toEqual(["scheduled", "draining", "updating", "complete"]);
    expect(f.d.deployWeb.mock.invocationCallOrder[0]).toBeLessThan(f.d.deployServers.mock.invocationCallOrder[0]);
    expect(timing.interruptionMs).toBe(1200);
  });
  it("resumes compatible clients before distributing a backend-dependent web build", async () => {
    const f = fixture(); f.plan.scope = { root: true, maps: true };
    await executeRollout(f.plan, f.d);
    const completionIndex = f.d.phase.mock.calls.findIndex(args => args[1] === "complete");
    expect(f.d.deployServers.mock.invocationCallOrder[0]).toBeLessThan(f.d.phase.mock.invocationCallOrder[completionIndex]);
    expect(f.d.phase.mock.invocationCallOrder[completionIndex]).toBeLessThan(f.d.deployWeb.mock.invocationCallOrder[0]);
  });
  it("postpones rather than dropping unacknowledged player progress", async () => {
    const f = fixture(); f.d.missingAcknowledgements.mockResolvedValue(1);
    await expect(executeRollout(f.plan, f.d)).rejects.toThrow("postponed");
    expect(f.d.deployServers).not.toHaveBeenCalled(); expect(f.d.phase.mock.calls.at(-1)[1]).toBe("cancelled");
  });
  it("cancels after web failure before changing any servers", async () => {
    const f = fixture(); f.d.deployWeb.mockRejectedValue(new Error("failed"));
    await expect(executeRollout(f.plan, f.d)).rejects.toThrow("failed"); expect(f.d.deployServers).not.toHaveBeenCalled();
    expect(f.d.phase.mock.calls.at(-1)[1]).toBe("cancelled");
  });
  it("leaves every server alone for client-only changes", () => {
    expect(releaseScope(["src/main.ts", "public/assets/wildstat/game.css"])).toEqual({ root: false, maps: false });
    expect(releaseScope(["shared/rules.ts"]).maps).toBe(true);
  });
  it("rejects destructive or client-breaking plans before publishing", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ AutoMigrate: { token: "t", break_clients: true } }) }));
    const api = createReleaseApi({ host: "https://example.test", database: "game", token: "fake", fetchImpl });
    await expect(api.publish("map", "code")).rejects.toThrow("client-compatibility"); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("uses compatible publishing with clear=false", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ AutoMigrate: { token: "t", break_clients: false } }) }));
    const api = createReleaseApi({ host: "https://example.test", database: "game", token: "fake", fetchImpl });
    await api.publish("map", "code");
    expect(fetchImpl.mock.calls[1][0]).toContain("clear=false&policy=Compatible");
  });
  it("bounds simultaneous map publishes and stops scheduling work after failure", async () => {
    let active = 0, peak = 0;
    await mapLimit([1,2,3,4,5], 2, async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; });
    expect(peak).toBe(2);
    const run = vi.fn(async () => { throw new Error("failed"); });
    await expect(mapLimit([1,2,3,4,5], 2, run)).rejects.toThrow("failed"); expect(run).toHaveBeenCalledTimes(2);
  });
});
