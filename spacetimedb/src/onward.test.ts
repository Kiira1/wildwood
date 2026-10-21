import { describe, expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { reportEnemy } from "../../tests/helpers/enemy-defeat";
import { setActiveCards } from "../../tests/helpers/active-cards";
import { addCard } from "./gear-cards";
import { MAP_PORTALS } from "./map-travel";
import { PROCEDURAL_ENTRY_BOSS, generateMap } from "../../shared/procedural-maps";
import { BOSS_REWARD_CLAIM_BITS } from "../../shared/rules";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;

/** A player on `mapId`, past the campaign, with the Warden II card on unless `onward` is false. */
function onMap(mapId: string, onward = true) {
  const f = crystalFixture();
  f.patch("player", { mapId });
  if (mapId.startsWith("endless_")) f.patch("playerProgress", { bossRewardClaims: BOSS_REWARD_CLAIM_BITS[PROCEDURAL_ENTRY_BOSS] });
  if (onward) f.transaction(() => { addCard(f.ctx, f.ctx.sender, "warden_ii_card"); setActiveCards(f.ctx, f.ctx.sender, ["warden_ii_card"]); });
  return f;
}
const where = (f: Fixture) => { const { mapId, x, y } = f.db.player.identity.find(f.ctx.sender); return { mapId, x, y }; };

describe("Onward (Warden II card)", () => {
  it("takes the player through to the map their boss kill opened, landing where its portal would", () => {
    const portal = MAP_PORTALS.crystal_hollows.find(candidate => candidate.destination === "clockwork_ruins")!;
    const f = onMap("crystal_hollows");
    f.patch("player", { x: portal.x, y: portal.y });
    reportEnemy(f, "boss");
    const landed = where(f);
    expect(landed.mapId).toBe("clockwork_ruins");
    expect(f.db.playerLastLocation.identity.find(f.ctx.sender)).toMatchObject(landed);
    // Walking through the portal by hand from where the boss fell lands on the same spot.
    const walked = onMap("crystal_hollows", false);
    reportEnemy(walked, "boss");
    walked.run(server.changeMap, { mapId: "clockwork_ruins", x: portal.x, y: portal.y });
    expect(where(walked)).toEqual(landed);
  });

  it("goes on from the last campaign map to Endless 1, and from Endless N to N + 1", () => {
    const citadel = onMap("ion_citadel");
    reportEnemy(citadel, "boss");
    expect(where(citadel).mapId).toBe("endless_1");
    const endless = onMap("endless_11");
    endless.seed("proceduralProgress", { identity: endless.ctx.sender, completed: 10 });
    reportEnemy(endless, "boss");
    expect(where(endless).mapId).toBe("endless_12");
  });

  it("does nothing on a boss already beaten, without the card, while dead or in an Aggro run", () => {
    const again = onMap("endless_11");
    again.seed("proceduralProgress", { identity: again.ctx.sender, completed: 11 });
    reportEnemy(again, "boss");
    const without = onMap("endless_11", false);
    without.seed("proceduralProgress", { identity: without.ctx.sender, completed: 10 });
    reportEnemy(without, "boss");
    const dead = onMap("endless_11");
    dead.seed("proceduralProgress", { identity: dead.ctx.sender, completed: 10 });
    dead.patch("player", { hp: 0 });
    reportEnemy(dead, "boss");
    const aggro = onMap("endless_11");
    aggro.seed("proceduralProgress", { identity: aggro.ctx.sender, completed: 10 });
    aggro.seed("playerAggroChallenge", { identity: aggro.ctx.sender, active: true, completed: 0 });
    reportEnemy(aggro, "boss");
    for (const f of [again, without, dead, aggro]) expect(where(f).mapId).toBe("endless_11");
    // The kill still opened the next map for those who had not beaten it.
    for (const f of [without, dead, aggro]) expect(f.db.proceduralProgress.identity.find(f.ctx.sender).completed).toBe(11);
  });

  it("leaves a portal walk that raced the move where the move put the player", () => {
    const f = onMap("endless_11");
    f.seed("proceduralProgress", { identity: f.ctx.sender, completed: 10 });
    reportEnemy(f, "boss");
    const landed = where(f);
    const portal = generateMap("endless_11").portals.find(candidate => candidate.destination === "endless_12")!;
    f.run(server.changeMap, { mapId: "endless_12", x: portal.x, y: portal.y });
    expect(where(f)).toEqual(landed);
  });
});
