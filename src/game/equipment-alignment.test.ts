import { expect, it } from "vitest";
import { defaultWeaponAlignment } from "./equipment-alignment";
import { weaponPresentation, sourceDefaultPresentation } from "../tools/sprite-aligner/vendor-weapons";

it("promotes the exported sword grip to the category default without affecting bows or raw source mode", () => {
  const exported = { x: 38.07, y: -3.97, scale: 1, angle: -28, flipX: false,
    pivotX: 0.2120783942239344, pivotY: 0.5109876959261637 };
  const sword = { id: "new-sword", source: "sword.png", category: "Sword", label: "Sword" };
  const world = weaponPresentation(sword);
  expect(defaultWeaponAlignment(world)).toEqual(exported);
  expect(defaultWeaponAlignment(weaponPresentation(sword, true))).toBeUndefined();
  expect(defaultWeaponAlignment(sourceDefaultPresentation(world))).toBeUndefined();
  expect(defaultWeaponAlignment(weaponPresentation({ ...sword, category: "Bow" }))).toBeUndefined();
  const override = { x: 2, y: 3, scale: .9 };
  expect(defaultWeaponAlignment({ ...world, alignment: override })).toEqual(override);
});
