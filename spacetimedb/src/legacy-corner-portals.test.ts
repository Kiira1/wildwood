import { describe, expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { CAMPAIGN_GATEWAYS, endlessEntryPortal, LEGACY_CORNER_GATEWAYS, LEGACY_ENDLESS_ENTRY_PORTAL, stepThrough, portalUsePoint, type MapGatewayPortal } from "../../shared/map-gateways";
import { generateMap } from "../../shared/procedural-maps";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

// Campaign portals moved to the middle of their maps in 0.901.15. Until the
// LEGACY table goes (shared/map-gateways.ts), tabs from before still walk into
// the old corner portals, and the server has to take both.
const use = (portal: MapGatewayPortal) => portalUsePoint(portal);
const portalTo = (gateways: { portals: MapGatewayPortal[] }, destination: string) => gateways.portals.find(portal => portal.destination === destination)!;

describe("portal use at the new middle and the old corner (until the legacy table goes)", () => {
  it("takes the new portal and brings the player out of the portal back", () => {
    const f = crystalFixture();
    f.patch("player", { mapId: "moonfen" });
    f.patch("playerProgress", { crystalHollowsUnlocked: true });
    const gate = use(portalTo(CAMPAIGN_GATEWAYS.moonfen, "crystal_hollows"));
    f.run(server.changeMap, { mapId: "crystal_hollows", x: gate.x, y: gate.y });
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "crystal_hollows", ...stepThrough(portalTo(CAMPAIGN_GATEWAYS.crystal_hollows, "moonfen"), { x: 0, y: 0 }) });
  });

  it("takes an old tab's corner portal and lands it at the old arrival, where that tab puts itself", () => {
    const f = crystalFixture();
    f.patch("player", { mapId: "moonfen" });
    f.patch("playerProgress", { moonfenUnlocked: true, crystalHollowsUnlocked: true });
    const gate = use(portalTo(LEGACY_CORNER_GATEWAYS.moonfen, "crystal_hollows"));
    f.run(server.changeMap, { mapId: "crystal_hollows", x: gate.x, y: gate.y });
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "crystal_hollows", ...LEGACY_CORNER_GATEWAYS.crystal_hollows.arrival });
    // And back through its old back portal.
    const back = use(portalTo(LEGACY_CORNER_GATEWAYS.crystal_hollows, "moonfen"));
    f.run(server.changeMap, { mapId: "moonfen", x: back.x, y: back.y });
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "moonfen", ...LEGACY_CORNER_GATEWAYS.moonfen.arrival });
  });

  it("takes the desert's old editor-placed portal back to the forest", () => {
    const f = crystalFixture();
    f.patch("player", { mapId: "beginner_desert" });
    const gate = use(portalTo(LEGACY_CORNER_GATEWAYS.beginner_desert, "tutorial_forest"));
    f.run(server.changeMap, { mapId: "tutorial_forest", x: gate.x, y: gate.y });
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "tutorial_forest", x: 1025, y: 850 });
  });

  it("takes the last map's way into Endless at either place, out of Endless's portal back", () => {
    for (const portal of [endlessEntryPortal("endless_1"), { ...LEGACY_ENDLESS_ENTRY_PORTAL, destination: "endless_1" }]) {
      const f = crystalFixture();
      f.patch("player", { mapId: "ion_citadel" });
      f.patch("playerProgress", { ionCitadelUnlocked: true, bossRewardClaims: BOSS_REWARD_CLAIM_BITS.aegisPrime });
      const gate = use(portal);
      f.run(server.changeMap, { mapId: "endless_1", x: gate.x, y: gate.y });
      const back = generateMap("endless_1").portals.find(gate => gate.destination === "ion_citadel")!;
      const out = f.db.player.identity.find(f.ctx.sender);
      expect(out.mapId).toBe("endless_1");
      // Out of Endless's portal back, within a step of its middle wherever the old or new way in was taken.
      expect(Math.hypot(out.x - back.x, out.y - (back.y - back.height * .32))).toBeLessThanOrEqual(44.001);
    }
  });

  it("still refuses a player far from both", () => {
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
    const arrival = stepThrough(portalTo(CAMPAIGN_GATEWAYS.crystal_hollows, "moonfen"), { x: 0, y: 0 });
    f.run(server.updateMovementState, { x: arrival.x, y: arrival.y, vx: 0, vy: 0, simulationTick: 2, motionEpoch: 2, sequence: 2 });
    // Its first packet from the arrival is taken as it stands, not pulled back toward the old map's portal.
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "crystal_hollows", x: arrival.x, y: arrival.y });
  });
});
