import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { HOME_EXTERIOR_MAP_ID, HOME_EXTERIOR_SPAWN } from "../../shared/home";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

describe("single player home travel", () => {
  it("constrains home movement to its 1200 by 1500 boundary", () => {
    const f = crystalFixture();
    f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 1200, y: 1800 });
    f.run(server.updateMovementState, { x: 1500, y: 1800, vx: 0, vy: 0, simulationTick: 1, motionEpoch: 1, sequence: 1 });
    expect(f.db.playerMotion.identity.find(f.ctx.sender)).toMatchObject({ x: 1183, y: 1483 });
  });
  it("uses the root for home movement while enemy maps use shards", () => {
    const f = crystalFixture();
    Object.assign(f.ctx, { databaseIdentity: identity("c") });
    f.seed("shardRuntime", { id: 0, role: "root", enabled: true });
    f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 1200, y: 1800 });
    expect(f.db.mapShardMember.identity.find(f.ctx.sender)).toBeNull();
    f.run(server.prepareWorldActionPosition, { x: 480, y: 664 });
    f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 380, y: 414 });
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "crystal_hollows", x: 1200, y: 1800 });
    expect(f.db.mapShardMember.identity.find(f.ctx.sender).mapId).toBe("crystal_hollows");
    // A second visit must not borrow the old home's analytical motion.
    f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 2200, y: 2800 });
    expect(f.db.mapShardMember.identity.find(f.ctx.sender)).toBeNull();
    f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 500, y: 700 });
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "crystal_hollows", x: 2200, y: 2800 });
  });
  it("starts upgrades at the home bench, but rejects the former snowlands bench", () => {
    const f = crystalFixture();
    f.patch("playerProgress", { inventoryJson: '["starter_bow"]' });
    f.patch("player", { mapId: "intermediate_snowlands", x: 800, y: 710 });
    expect(() => f.run(server.startItemUpgrade, { slot: 1, itemId: "starter_bow" })).toThrow("Touch the Upgrade Bench first");
    f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 800, y: 710 });
    f.run(server.prepareWorldActionPosition, { x: 480, y: 664 });
    f.run(server.startItemUpgrade, { slot: 1, itemId: "starter_bow" });
    expect(f.db.activeItemUpgrade.identity.find(f.ctx.sender)).toMatchObject({ itemId: "starter_bow", targetLevel: 1 });
  });
  it("persists the exact departure point and restores it after home movement", () => {
    const f = crystalFixture();
    f.patch("player", { facing: Math.PI });
    f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 1234.5, y: 2345.25 });
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: HOME_EXTERIOR_MAP_ID, ...HOME_EXTERIOR_SPAWN });
    expect(f.db.playerLastLocation.identity.find(f.ctx.sender).mapId).toBe(HOME_EXTERIOR_MAP_ID);
    expect(f.db.playerMotionIdentity.identity.find(f.ctx.sender).isVisible).toBe(false);
    f.patch("player", { x: 480, y: 664 });
    f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 380, y: 414 });
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "crystal_hollows", x: 1234.5, y: 2345.25, facing: Math.PI });
  });
  it("updates the return point on each visit and rejects invalid positions", () => {
    const f = crystalFixture();
    expect(() => f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: NaN, y: 2345 })).toThrow("Invalid teleport position");
    for (const x of [1100, 2200]) {
      f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x, y: 2000 });
      f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 500, y: 700 });
      expect(f.db.player.identity.find(f.ctx.sender).x).toBe(x);
    }
  });
  it("keeps return locations separate for different players", () => {
    const f = crystalFixture();
    const other = identity("b");
    f.seed("homeReturnLocation", { identity: other, mapId: "tutorial_forest", x: 300, y: 400, facing: 0 });
    f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 1500, y: 1800 });
    expect(f.db.homeReturnLocation.identity.find(other).x).toBe(300);
  });
  it.each([
    [true, false], [false, true], [true, true],
  ])("allows duels with challenger at Home=%s and opponent at Home=%s", (challengerHome, opponentHome) => {
    const f = crystalFixture();
    const other = identity("b");
    f.progress(other);
    f.seed("playerProfile", { identity: other, displayName: "Opponent" });
    f.seed("player", { ...f.db.player.identity.find(f.ctx.sender), identity: other,
      mapId: opponentHome ? HOME_EXTERIOR_MAP_ID : "tutorial_forest", x: 500, y: 700 });
    if (challengerHome) f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 1500, y: 1800 });
    const origin = f.db.player.identity.find(f.ctx.sender);
    const opponentBefore = f.db.player.identity.find(other);
    const returnBefore = f.db.homeReturnLocation.identity.find(f.ctx.sender);
    f.run(server.requestDuel, { opponent: other });
    const duel = [...f.db.duel.iter()][0];
    expect(duel).toMatchObject({ status: "countdown", challengerOriginX: origin.x, challengerOriginY: origin.y });
    f.ctx.timestamp = new Timestamp(duel.endsAtMicros + 1_000_000n);
    f.run(server.pulseDuel);
    const finishing = f.db.duel.id.find(duel.id);
    expect(finishing.status).toBe("finishing");
    f.ctx.timestamp = new Timestamp(finishing.endsAtMicros);
    f.run(server.pulseDuel);
    expect(f.db.duelReplay.id.find(duel.id)).not.toBeNull();
    expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: origin.mapId, x: origin.x, y: origin.y });
    expect(f.db.player.identity.find(other)).toEqual(opponentBefore);
    expect(f.db.homeReturnLocation.identity.find(f.ctx.sender)).toEqual(returnBefore);
    if (challengerHome) {
      f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: origin.x, y: origin.y });
      expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "crystal_hollows", x: 1500, y: 1800 });
    }
  });
});

it("lets an already-stranded Home account return safely without changing progression", () => {
  const f = crystalFixture();
  f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 1234, y: 2345 });
  f.db.homeReturnLocation.identity.delete(f.ctx.sender);
  const progress = f.db.playerProgress.identity.find(f.ctx.sender);
  f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 500, y: 700 });
  expect(f.db.player.identity.find(f.ctx.sender).mapId).toBe("tutorial_forest");
  expect(f.db.playerLastLocation.identity.find(f.ctx.sender).mapId).toBe("tutorial_forest");
  expect(f.db.playerProgress.identity.find(f.ctx.sender)).toEqual(progress);
});

it("transfers a guest's Home return position during registration", async () => {
  const { SPACETIME_AUTH_ISSUER, SPACETIME_AUTH_CLIENT_ID, ATTACK_BALANCE_VERSION } = await import("../../shared/rules");
  const f = crystalFixture();
  const guest = identity("2");
  f.db.playerProgress.identity.delete(f.ctx.sender);
  f.db.playerProfile.identity.delete(f.ctx.sender);
  f.progress(guest, { crystalHollowsUnlocked: true });
  f.seed("playerBalanceVersion", { identity: guest, version: ATTACK_BALANCE_VERSION });
  f.seed("playerLastLocation", { identity: guest, mapId: HOME_EXTERIOR_MAP_ID, ...HOME_EXTERIOR_SPAWN, facing: 0 });
  f.seed("homeReturnLocation", { identity: guest, mapId: "crystal_hollows", x: 1234, y: 2345, facing: 1 });
  f.seed("accountLink", { code: "home-link", guest, createdAt: f.ctx.timestamp });
  f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
  f.run(server.claimGuestAccount, { code: "home-link" });
  expect(f.db.homeReturnLocation.identity.find(guest)).toBeNull();
  expect(f.db.playerProfile.identity.find(f.ctx.sender)).not.toBeNull();
  f.patch("player", { mapId: HOME_EXTERIOR_MAP_ID, ...HOME_EXTERIOR_SPAWN });
  f.run(server.changeMap, { mapId: HOME_EXTERIOR_MAP_ID, x: 500, y: 700 });
  expect(f.db.player.identity.find(f.ctx.sender)).toMatchObject({ mapId: "crystal_hollows", x: 1234, y: 2345, facing: 1 });
  expect(f.db.playerProgress.identity.find(f.ctx.sender).crystalHollowsUnlocked).toBe(true);
});
