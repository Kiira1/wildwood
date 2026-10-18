import { describe, expect, it } from "vitest";
import { createFramePlayers } from "./frame-players";

describe("createFramePlayers", () => {
  it("builds once for callers within a frame, and again the next frame", () => {
    let now = 1_000, builds = 0;
    const players = createFramePlayers(() => { builds++; return []; }, () => now);
    players(); now += 1; players(); now += 2; players();
    expect(builds).toBe(1);
    now += 16; players();
    expect(builds).toBe(2);
  });
});
