import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { HOME_TRAVEL_PORTAL } from "../../shared/home";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));
const position = { x: HOME_TRAVEL_PORTAL.x, y: HOME_TRAVEL_PORTAL.y - HOME_TRAVEL_PORTAL.height * .32 };
function home() { const f = crystalFixture(); f.patch("player", { mapId: "home_exterior", ...position }); return f; }
it("travels from the home portal to any unlocked campaign map", () => {
  const f = home(); f.patch("playerProgress", { snowlandsUnlocked: true });
  f.run(server.changeMap, { mapId: "intermediate_snowlands", ...position });
  expect(f.db.player.identity.find(f.ctx.sender).mapId).toBe("intermediate_snowlands");
});
it("keeps unlock and proximity checks on the home portal", () => {
  const f = home();
  expect(() => f.run(server.changeMap, { mapId: "intermediate_snowlands", ...position })).toThrow("Desert Spider");
  expect(() => f.run(server.changeMap, { mapId: "endless_1", ...position })).toThrow("previous map");
  expect(() => f.run(server.changeMap, { mapId: "tutorial_forest", x: 1000, y: 1400 })).toThrow("closer");
  expect(() => f.run(server.changeMap, { mapId: "tutorial_forest", x: NaN, y: 490 })).toThrow("finite");
  f.run(server.changeMap, { mapId: "tutorial_forest", ...position });
  expect(f.db.player.identity.find(f.ctx.sender).mapId).toBe("tutorial_forest");
});

it("does not bypass new unlocks through an old Home return point", () => {
  const f = home();
  f.patch("playerProgress", { desertUnlocked: true, ionCitadelUnlocked: false });
  f.seed("playerEndlessRebaseBackup", { identity: f.ctx.sender, recordedAt: f.ctx.timestamp });
  f.seed("homeReturnLocation", { identity: f.ctx.sender, mapId: "ion_citadel", x: 1500, y: 1500, facing: 0 });
  f.run(server.changeMap, { mapId: "home_exterior", ...position });
  expect(f.db.player.identity.find(f.ctx.sender).mapId).toBe("tutorial_forest");
});
