import { expect, it } from "vitest";
import { swordWhirlwindPose, swordSwingPose } from "./sword-swing";
import { segmentCircleHit, weaponAttackRange } from "./weapon-combat";
it("crosses aim at release and returns to the exported resting angle", () => {
  expect(swordSwingPose(.42 - .12).angle).toBeCloseTo(0);
  expect(swordSwingPose(.42 - .075).angle).toBeCloseTo(-100);
  expect(swordSwingPose(.42 - .19).angle).toBeCloseTo(100);
  expect(swordSwingPose(0)).toEqual({ angle: -28, trail: 0 });
});
it("hits only the actual finite segment including a circle overlapping its endpoint", () => {
  expect(segmentCircleHit(85, 0, 75, 0, 20)).toBeCloseTo(65 / 75);
  expect(segmentCircleHit(96, 0, 75, 0, 20)).toBeNull();
  expect(segmentCircleHit(-30, 0, 75, 0, 20)).toBeNull();
  expect(segmentCircleHit(40, 21, 75, 0, 20)).toBeNull();
  expect(weaponAttackRange("wooden_sword", 200)).toBe(75);
  expect(weaponAttackRange("starter_bow", 200)).toBe(200);
  expect(weaponAttackRange("wooden_sword", 250)).toBe(125);
  expect(weaponAttackRange("starter_bow", 250)).toBe(250);
});

it("animates three uninterrupted Whirlwind turns and releases the normal swing at the end", () => {
  expect(swordWhirlwindPose(.6)?.angle).toBeCloseTo(-28);
  expect(swordWhirlwindPose(.4)?.angle).toBeCloseTo(332);
  expect(swordWhirlwindPose(.2)?.angle).toBeCloseTo(692);
  expect(swordWhirlwindPose(0)).toBeNull();
});
