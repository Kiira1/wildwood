import { describe, expect, it } from "vitest";
import { itemPresentation } from "../../game/item-presentation";
import { weaponPresentation, sourceDefaultPresentation } from "./vendor-weapons";

describe("vendor weapon baselines", () => {
  it("uses the actual game tuning for matching artwork, and natural dimensions for source defaults", () => {
    const weapon = { id: "vendor:bow", label: "Bow", category: "Bow", source: "/art-source/vendor/bow.png", gameItemId: "starter_bow" };
    const game = weaponPresentation(weapon);
    expect(game).toEqual({ ...itemPresentation("starter_bow")!.world, source: weapon.source });
    expect(game.width).toBe(115);
    expect(game.top).toBe(106);
    expect(weaponPresentation(weapon, true)).toEqual({ kind: "SPRITE", source: weapon.source, layer: "HAND", top: 116, handAction: "BOW" });
  });
  it("applies the shared sword category only in game mode", () => {
    const weapon = { id: "vendor:sword", label: "Sword", category: "Sword", source: "/art-source/vendor/sword.png" };
    expect(weaponPresentation(weapon).weaponCategory).toBe("SWORD");
    expect(weaponPresentation(weapon, true).weaponCategory).toBeUndefined();
    expect(weaponPresentation(weapon).handAction).toBe("SWING");
  });
  it("resets tuned armor to natural artwork at the shared chest anchor", () => {
    expect(sourceDefaultPresentation({ kind: "SPRITE", layer: "CHEST", source: "armor.png", width: 76, height: 68, top: 100 }))
      .toEqual({ kind: "SPRITE", layer: "CHEST", source: "armor.png", bottom: 168 });
  });
});
