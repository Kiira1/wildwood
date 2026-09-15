import { expect, it } from "vitest";
import { createLocalCorpses } from "./local-corpses";
import type { RemotePlayer } from "../../coop/contracts";
it("retains the old local body after respawn, independently of the next death and equipment", () => {
  const cache = createLocalCorpses();
  const player = { id: "me", headItem: "samurai_hat", x: 10, y: 20 } as RemotePlayer;
  const death = { id: "me", x: 10, y: 20, facing: 0, startedAtMs: 1000 };
  cache.add("me", "endless_1", player, death, 4);
  expect(cache.players("me", "endless_1", 2000, death)).toEqual([]);
  player.x = 500; player.headItem = "";
  const bodies = cache.players("me", "endless_1", 5000, null);
  expect(bodies[0]).toMatchObject({ x: 10, headItem: "samurai_hat", skinTone: 4 });
  cache.add("me", "endless_1", player, { ...death, x: 500, startedAtMs: 6000 }, 4);
  expect(cache.players("me", "endless_1", 121000, null)).toHaveLength(2);
  expect(cache.players("me", "endless_1", 121001, null)).toHaveLength(1);
  expect(cache.players("me", "home_exterior", 121001, null)).toEqual([]);
  expect(cache.players("other", "endless_1", 121001, null)).toEqual([]);
});
