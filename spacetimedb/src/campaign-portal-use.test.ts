import { describe, expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { CAMPAIGN_GATEWAYS, endlessEntryPortal, portalExitPoint, portalUsePoint, type MapGatewayPortal } from "../../shared/map-gateways";
import { generateMap } from "../../shared/procedural-maps";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const use = (portal: MapGatewayPortal) => portalUsePoint(portal);
const portalTo = (gateways: { portals: MapGatewayPortal[] }, destination: string) => gateways.portals.find(portal => portal.destination === destination)!;

describe("portal use at the middle of the map", () => {
  it("takes the new portal and brings the player out of the portal back", () => {
    const f = crystalFixture();
    f.patch("player", { mapId: "moonfen" });
    f.patch("playerProgress", { crystalHollowsUnlocked: true });
    const gate = use(portalTo(CAMPAIGN_GATEWAYS.moonfen, "crystal_hollows"));
    f.run(server.changeMap, { mapId: "crystal_hollows", x: gate.x, y: gate.y });
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "crystal_hollows", ...portalExitPoint(portalTo(CAMPAIGN_GATEWAYS.crystal_hollows, "moonfen")) });
  });

  it("takes the last map's way into Endless, out of Endless's portal back", () => {
    for (const portal of [endlessEntryPortal("endless_1")]) {
      const f = crystalFixture();
      f.patch("player", { mapId: "ion_citadel" });
      f.patch("playerProgress", { ionCitadelUnlocked: true, bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
      const gate = use(portal);
      f.run(server.changeMap, { mapId: "endless_1", x: gate.x, y: gate.y });
      const back = generateMap("endless_1").portals.find(gate => gate.destination === "ion_citadel")!;
      const out = f.db.player.identity.find(f.ctx.sender);
      expect(out.mapId).toBe("endless_1");
      // A step in front of Endless's portal back.
      expect(out).toMatchObject(portalExitPoint(back));
    }
  });

  it("refuses a player far from the portal", () => {
    const f = crystalFixture();
    f.patch("player", { mapId: "moonfen" });
    f.patch("playerProgress", { crystalHollowsUnlocked: true });
    expect(() => f.run(server.changeMap, { mapId: "crystal_hollows", x: 1400, y: 1400 })).toThrow("Move closer");
  });

  it("lets a player who arrived at the new middle walk away from it", () => {
    const f = crystalFixture();
    f.patch("player", { mapId: "moonfen" });
    f.patch("playerProgress", { crystalHollowsUnlocked: true });
    const gate = use(portalTo(CAMPAIGN_GATEWAYS.moonfen, "crystal_hollows"));
    f.run(server.updateMovementState, { x: gate.x, y: gate.y, vx: 0, vy: 0, simulationTick: 1, motionEpoch: 1, sequence: 1 });
    f.run(server.changeMap, { mapId: "crystal_hollows", x: gate.x, y: gate.y });
    const arrival = portalExitPoint(portalTo(CAMPAIGN_GATEWAYS.crystal_hollows, "moonfen"));
    f.run(server.updateMovementState, { x: arrival.x, y: arrival.y, vx: 0, vy: 0, simulationTick: 2, motionEpoch: 2, sequence: 2 });
    // Its first packet from the arrival is taken as it stands, not pulled back toward the old map's portal.
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "crystal_hollows", x: arrival.x, y: arrival.y });
  });
});
