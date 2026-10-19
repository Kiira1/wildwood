import { existsSync, readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { TOOL_LEVEL_NAMES, TOOL_MAX_LEVEL } from "../../../../shared/tools";
import { WEAPON_ALIGNMENT_DEFAULTS } from "../../equipment-alignment";
import { AXE_GRIP, AXE_SIZE, HATCHET_OVERRIDES, HATCHET_PRESENTATION, WOODCUTTING_HATCHET, hatchetArtSource } from "./hatchet-sprite";
import { PICKAXE_PRESENTATION } from "./pickaxe-sprite";
afterEach(() => vi.unstubAllGlobals());

const manifest = JSON.parse(readFileSync(new URL("../../../../scripts/art/tool-axes.json", import.meta.url), "utf8")) as
  { hatchet: { level: number; name: string; source: string }[] };

it("ships one vendor axe for every tool level, each its own design", () => {
  expect(manifest.hatchet.map(axe => axe.level)).toEqual(Array.from({ length: TOOL_MAX_LEVEL + 1 }, (_, level) => level));
  expect(manifest.hatchet.map(axe => axe.name)).toEqual(TOOL_LEVEL_NAMES);
  expect(manifest.hatchet[0].source).toContain("Axe_022_BrownGary");
  expect(new Set(manifest.hatchet.map(axe => axe.source)).size).toBe(TOOL_MAX_LEVEL + 1);
  for (let level = 0; level <= TOOL_MAX_LEVEL; level += 1) {
    expect(existsSync(new URL(`../../../../public/${hatchetArtSource(level)}`, import.meta.url))).toBe(true);
  }
  expect([hatchetArtSource(-2), hatchetArtSource(99)]).toEqual([hatchetArtSource(0), hatchetArtSource(TOOL_MAX_LEVEL)]);
});

it("holds the axe by its haft where the wooden sword is held, and swings it as the pickaxe swings", () => {
  const sword = WEAPON_ALIGNMENT_DEFAULTS.SWORD, axe = HATCHET_PRESENTATION.alignment!;
  // Where each grip lands, from the art's middle across and from its top down (player-appearance.ts draws it so).
  const swordGrip = { x: 118 * (sword.pivotX! - .5) + sword.x, y: 59 * sword.pivotY! + sword.y };
  const axeGrip = { x: AXE_SIZE.width * (axe.pivotX! - .5) + axe.x, y: AXE_SIZE.height * axe.pivotY! + axe.y };
  expect(axeGrip.x).toBeCloseTo(swordGrip.x, 6);
  expect(axeGrip.y).toBeCloseTo(swordGrip.y, 6);
  expect([AXE_SIZE.width * axe.pivotX!, AXE_SIZE.height * axe.pivotY!]).toEqual([AXE_GRIP.x, AXE_GRIP.y]);
  expect([axe.angle, axe.scale]).toEqual([sword.angle, sword.scale]);
  expect(HATCHET_OVERRIDES[WOODCUTTING_HATCHET]).toBe(HATCHET_PRESENTATION);
  expect({ ...HATCHET_PRESENTATION, alignment: undefined }).toEqual({ ...PICKAXE_PRESENTATION, alignment: undefined });
});

it("puts the level's axe in hand", async () => {
  class FakeImage { src = ""; }
  vi.stubGlobal("Image", FakeImage);
  vi.resetModules();
  const { toolSprite } = await import("./tool-sprites");
  for (const level of [0, 4, TOOL_MAX_LEVEL]) expect(toolSprite("hatchet", level)?.src).toBe(hatchetArtSource(level));
  expect(toolSprite("hatchet", 4)).toBe(toolSprite("hatchet", 4));
});
