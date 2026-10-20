import { afterEach, expect, it, vi } from "vitest";
import { beginTownTeleport, drawTownTeleport, endTownTeleport } from "./town-teleport";

afterEach(() => { endTownTeleport(); vi.restoreAllMocks(); });

it("restores a player if departure never receives arrival or cleanup", () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const player = vi.fn();
  beginTownTeleport();
  now = 700;
  drawTownTeleport({} as CanvasRenderingContext2D, 0, 0, player);
  expect(player).not.toHaveBeenCalled();
  now = 30_000;
  drawTownTeleport({} as CanvasRenderingContext2D, 0, 0, player);
  expect(player).toHaveBeenCalledOnce();
});

it.each(["arrival", "cancel"])("restores normal drawing after %s", mode => {
  let now = 100;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const player = vi.fn();
  beginTownTeleport(mode === "arrival");
  if (mode === "cancel") endTownTeleport();
  now += 650;
  drawTownTeleport({} as CanvasRenderingContext2D, 0, 0, player);
  expect(player).toHaveBeenCalledOnce();
});
