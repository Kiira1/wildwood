import { describe, expect, it } from "vitest";
import { createBossService } from "./boss-service";

describe("co-op boss service", () => {
  it("drains hit results and clears them on session reset", () => {
    const service = createBossService();
    const hit = { mapId: "crystal_hollows", x: 4050, y: 4050, damage: 1550, critical: true };
    service.tables.upsertHitResult(hit);
    expect(service.api.drainBossHitResults()).toEqual([hit]);
    expect(service.api.drainBossHitResults()).toEqual([]);
    service.tables.upsertHitResult(hit);
    service.resetSession();
    expect(service.api.drainBossHitResults()).toEqual([]);
  });
});
