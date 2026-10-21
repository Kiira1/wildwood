import { describe, expect, it } from "vitest";
import { gameWorld } from "./harness/game";
import { farmer, strong } from "./harness/farmer";
import { pressKey } from "./harness/farm";

// Auto Farm in the booted game through a lost connection and a won and a lost duel.

describe("Auto Farm interruptions in the game (FARM-05)", () => {
  it("holds while the game is paused for a lost connection and through a won and a lost duel, then farms on by itself", async () => {
    const world = gameWorld();
    const bob = world.join("Bob");
    const ann = await farmer(world, "Ann", strong);
    const { tab } = ann;

    // F starts the farm: the world sees a farmer, and its kills come in (Auto Farm reports them once a minute).
    pressKey(tab, "KeyF");
    expect(await tab.until(ann.farming, 10_000)).toBe(true);
    expect(await tab.until(() => ann.kills() > 0, 75_000)).toBe(true);

    // The server goes out of reach: the game pauses behind the reconnect window. It comes back, Retry, and the farm carries on unasked.
    ann.network.down = true;
    tab.connection()!.fake.drop(new Error("network"));
    await tab.play(3_000);
    expect(tab.shown("reconnectOverlay")).toBe(true);
    expect(ann.farming()).toBe(false);
    ann.network.down = false;
    tab.tap("reconnectRetryBtn");
    expect(await tab.until(ann.farming, 10_000)).toBe(true);
    let before = ann.kills();
    expect(await tab.until(() => ann.kills() > before, 75_000)).toBe(true);

    // A duel (Ann challenges Bob, as the profile's Duel button does) holds the farm through the arena and its result.
    await (tab.connection() as any).reducers.requestDuel({ opponent: bob.identity });
    expect(await tab.until(() => tab.shown("closeDuelResultBtn"), 60_000, 250)).toBe(true);
    tab.tap("closeDuelResultBtn");
    before = ann.kills();
    expect(await tab.until(() => ann.kills() > before, 75_000)).toBe(true);
    expect(ann.farming()).toBe(true);

    // Once the duel cooldown is over, Ann challenges a far stronger Bob and loses: her 0 health is the duel's, not a death.
    const cooldownOver = () => world.now() - Number(world.db.duelRequestCooldown.identity.find(ann.player.identity).requestedAt.microsSinceUnixEpoch / 1000n) > 121_000;
    expect(await tab.until(cooldownOver, 130_000, 250)).toBe(true);
    bob.patch("playerProgress", { damage: 1_000_000, maxHp: 10_000_000 });
    await (tab.connection() as any).reducers.requestDuel({ opponent: bob.identity });
    let stopped = false;
    expect(await tab.until(() => { stopped ||= !ann.farming(); return tab.shown("closeDuelResultBtn"); }, 60_000, 250)).toBe(true);
    expect(stopped).toBe(false);
    tab.tap("closeDuelResultBtn");
    before = ann.kills();
    expect(await tab.until(() => ann.kills() > before, 75_000)).toBe(true);
    expect(ann.farming()).toBe(true);
  }, 240_000);
});
