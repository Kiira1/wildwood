import { expect, it } from "vitest";
import { createRemoteCorpses } from "./remote-corpses";
import type { RemotePlayer } from "../contracts";

it("keeps independent death snapshots for two minutes, across respawns and map visits", () => {
  const cache = createRemoteCorpses();
  const player = { id: "player", x: 10, y: 20, headItem: "samurai_hat", moving: true } as RemotePlayer;
  const death = { id: player.id, mapId: "samurai_garden", x: 10, y: 20, facing: 0, startedAtMs: 0 };
  cache.add(player, death, 4);
  player.x = 300; player.headItem = "";
  cache.add(player, { ...death, x: 300, startedAtMs: 10_000 }, 4);
  expect(cache.players("home_exterior", 60_000)).toEqual([]);
  const bodies = cache.players("samurai_garden", 120_000);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toMatchObject({ x: 10, headItem: "samurai_hat", identity: "player", skinTone: 4, moving: false });
  expect(bodies[0].id).not.toBe(bodies[1].id);
  expect(cache.death(bodies[0].id, "samurai_garden", 120_000)).not.toBeNull();
  expect(cache.death(bodies[0].id, "samurai_garden", 120_001)).toBeNull();
  expect(cache.players("samurai_garden", 130_001)).toEqual([]);
});

it("clears private session snapshots when the account changes", () => {
  const cache = createRemoteCorpses();
  cache.add({ id: "a" } as RemotePlayer, { id: "a", mapId: "tutorial_forest", x: 1, y: 2, facing: 0, startedAtMs: 0 });
  cache.clear();
  expect(cache.players("tutorial_forest", 100)).toEqual([]);
});
