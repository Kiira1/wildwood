import { describe, expect, it } from "vitest";
import {
  DEVELOPER_ITEM_IDS, GALAXY_ARMOR, GALAXY_BOOTS, GALAXY_BOW, GALAXY_HELMET, isCosmeticOnlyItem, isWeaponItem, itemDefinition,
} from "../../shared/items";
import { itemHasGalaxyFinish } from "./item-presentation";

// How the finish looks is checked by the gear scene (tools/visual-check).
const GALAXY_SET = [GALAXY_HELMET, GALAXY_ARMOR, GALAXY_BOOTS, GALAXY_BOW];

describe("Galaxy set catalogue", () => {
  it("is four developer-granted cosmetics, one per visible slot, with no stats", () => {
    expect(GALAXY_SET.map(id => itemDefinition(id)?.slot)).toEqual(["HEAD", "CHEST", "FEET", "HAND"]);
    for (const id of GALAXY_SET) {
      expect(isCosmeticOnlyItem(id), id).toBe(true);
      expect(DEVELOPER_ITEM_IDS, id).toContain(id);
      expect(itemDefinition(id)?.stats, id).toEqual(["COSMETIC · NO STATS"]);
      expect(itemHasGalaxyFinish(id), id).toBe(true);
    }
    // A look only: the bow never becomes a weapon of its own.
    expect(isWeaponItem(GALAXY_BOW)).toBe(false);
  });
});
