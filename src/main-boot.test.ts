import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disconnectedCoopClient, stubGameBootEnvironment } from "../tests/helpers/game-boot-environment";

// Importing main.ts runs the whole composition root on the real startup page, with no server.
// A missing element or a dependency used before it exists fails here; layout and play are not seen.

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Importing main.ts transforms most of the client, which is slow on a busy machine.
describe("game boot", { timeout: 60_000 }, () => {
  it("composes the game with no coop client at all", async () => {
    const { document, runFrames } = stubGameBootEnvironment();

    await expect(import("./main")).resolves.toBeDefined();
    await vi.advanceTimersByTimeAsync(1_000);
    runFrames(3);

    expect(document.getElementById("game")).not.toBeNull();
  });

  it("composes the game against a coop client that has not connected yet", async () => {
    const { window, runFrames } = stubGameBootEnvironment();
    const coop = disconnectedCoopClient();
    Object.assign(window, { wildstatCoop: coop.client });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(import("./main")).resolves.toBeDefined();
    coop.notifyChange();
    await vi.advanceTimersByTimeAsync(1_000);
    runFrames(3);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("kill reporting is unavailable"));
  });
});
