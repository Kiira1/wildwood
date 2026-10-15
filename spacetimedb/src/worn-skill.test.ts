import { expect, it, vi } from "vitest";
import { crystalFixture } from "../../tests/helpers/crystal-hollows-fixture";
import { bowSkillKey } from "./bow-skills";
import { syncWornSkill } from "./worn-skill";
import { IRON_BOW, SAMURAI_HAT } from "../../shared/items";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("copies the equipped weapon's roll into the public row, and clears it with no skill weapon in hand", () => {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify([IRON_BOW, SAMURAI_HAT]), equippedRightHand: IRON_BOW });
  f.seed("playerBowSkill", { key: bowSkillKey(f.ctx.sender, IRON_BOW), identity: f.ctx.sender, itemId: IRON_BOW, arrowStorm: 2, ricochet: 3, piercingShot: 4 });
  f.transaction(() => syncWornSkill(f.ctx, f.ctx.sender));
  expect(f.db.playerWornSkill.identity.find(f.ctx.sender)).toMatchObject({ itemId: IRON_BOW, arrowStorm: 2, ricochet: 3, piercingShot: 4, whirlwind: 0 });
  f.patch("playerProgress", { equippedRightHand: "" });
  f.transaction(() => syncWornSkill(f.ctx, f.ctx.sender));
  expect(f.db.playerWornSkill.identity.find(f.ctx.sender)).toBeNull();
});
