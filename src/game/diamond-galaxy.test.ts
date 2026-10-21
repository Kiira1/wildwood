import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIAMOND_GALAXY_ARMOR, DIAMOND_GALAXY_BOOTS, DIAMOND_GALAXY_BOW, DIAMOND_GALAXY_HELMET,
  GALAXY_ARMOR, GALAXY_BOOTS, GALAXY_BOW, GALAXY_HELMET, isCosmeticOnlyItem, itemDefinition,
} from "../../shared/items";
import { PATREON_DIAMOND_ITEM_IDS } from "../../shared/patreon-cosmetics";
import { galaxyFinishFrame } from "./galaxy-finish";
import { appearanceHasGalaxyFinish, itemArtMarkup, itemFinish, itemPresentation } from "./item-presentation";
import { cosmeticInventoryStacks, inventoryFromSave } from "./inventory";

const DIAMOND_SET = [DIAMOND_GALAXY_HELMET, DIAMOND_GALAXY_ARMOR, DIAMOND_GALAXY_BOOTS, DIAMOND_GALAXY_BOW];
const GALAXY_SET = [GALAXY_HELMET, GALAXY_ARMOR, GALAXY_BOOTS, GALAXY_BOW];

// Lending, wearing, a reload and a lapse are played in tests/scenarios/gear.test.ts (GEAR-20).
describe("the Diamond Galaxy set", () => {
  it("is four Patreon Diamond cosmetics on the Galaxy silhouettes, in the Diamond sky", () => {
    expect(DIAMOND_SET.map(id => itemDefinition(id)?.slot)).toEqual(["HEAD", "CHEST", "FEET", "HAND"]);
    DIAMOND_SET.forEach((id, index) => {
      expect(isCosmeticOnlyItem(id), id).toBe(true);
      expect(itemDefinition(id)?.acquisition, id).toBe("PATREON_DIAMOND");
      expect(itemDefinition(id)?.stats, id).toEqual(["PATREON DIAMOND · NO STATS"]);
      expect(itemFinish(id), id).toBe("DIAMOND_GALAXY");
      expect(itemPresentation(id)?.world, id).toEqual(itemPresentation(GALAXY_SET[index])?.world);
    });
    expect(PATREON_DIAMOND_ITEM_IDS).toEqual(DIAMOND_SET);
    expect(appearanceHasGalaxyFinish({ chestItem: DIAMOND_GALAXY_ARMOR })).toBe(true);
    expect(itemArtMarkup(DIAMOND_GALAXY_ARMOR)).toContain("var(--diamond-galaxy-art-texture,");
    expect(itemArtMarkup(GALAXY_ARMOR)).toContain("var(--galaxy-art-texture,");
  });



  it("stays on as the server saved it while the membership is still loading, so a sign-in does not save it off", () => {
    const loading = inventoryFromSave("[]", "", "", "", false, false, "", "", "", DIAMOND_GALAXY_ARMOR, "", "", "", "[]", null);
    expect(loading.cosmeticChest).toBe(DIAMOND_GALAXY_ARMOR);
    // Nothing to pick from yet, though: it is not offered until the tier says so.
    expect(cosmeticInventoryStacks(loading).map(stack => stack.itemId)).not.toContain(DIAMOND_GALAXY_HELMET);
    // Every worn look stays as the server saved it: the server is the one that takes off what is not owned.
    expect(inventoryFromSave("[]", "", "", "", false, false, "", "", "", GALAXY_ARMOR, "", "", "", "[]", null).cosmeticChest).toBe(GALAXY_ARMOR);
  });


});

describe("the sky finish's palettes", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("paints a separate frame per palette, so a Galaxy and a Diamond piece never share one", () => {
    const fills: string[] = [];
    const context = () => new Proxy({} as Record<string | symbol, unknown>, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "getImageData" || key === "createImageData") return (...args: number[]) => {
          const [width, height] = args.length === 4 ? [args[2], args[3]] : args;
          return { width, height, data: new Uint8ClampedArray(width * height * 4) };
        };
        if (key === "createPattern") return () => ({});
        return () => ({ addColorStop() {} });
      },
      set(target, key, value) { if (key === "fillStyle" && typeof value === "string") fills.push(value); target[key] = value; return true; },
    });
    vi.stubGlobal("document", { createElement: () => { const canvas = { width: 1, height: 1, getContext: () => ctx }; const ctx = context(); return canvas; } });
    const sprite = { complete: true, naturalWidth: 40, naturalHeight: 40, width: 40, height: 40 } as unknown as HTMLImageElement;
    const galaxy = galaxyFinishFrame(sprite, undefined, 0, "GALAXY");
    const diamond = galaxyFinishFrame(sprite, undefined, 0, "DIAMOND_GALAXY");
    expect(galaxy).not.toBeNull();
    expect(diamond).not.toBe(galaxy);
    // Each palette's own empty sky was painted.
    expect(fills).toEqual(expect.arrayContaining(["#03040f", "#0b2442"]));
  });
});
