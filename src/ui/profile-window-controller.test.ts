import { expect, it } from "vitest";
import { STARTER_STAFF, WOODEN_SWORD } from "../../shared/items";
import { masteryPointsForLevel } from "../../shared/weapon-mastery";
import { profileMasteryText } from "./profile-window-controller";
import type { PlayerProfileData } from "../wildstat-coop";

const profile = (equippedRightHand: string, mastery?: PlayerProfileData["mastery"]) =>
  ({ progress: { equippedRightHand } as PlayerProfileData["progress"], mastery });

it("shows the right-hand weapon's school and level", () => {
  expect(profileMasteryText(profile("frost_bow", { archery: 23, swordplay: 4 }))).toBe("Archery Lv 23");
  expect(profileMasteryText(profile(WOODEN_SWORD, { archery: 23, swordplay: 4 }))).toBe("Swordplay Lv 4");
  // An empty hand fights with the starter stone, which trains Archery.
  expect(profileMasteryText(profile("", { archery: 2 }))).toBe("Archery Lv 2");
});

it("shows nothing when the active school is level 0, whatever the others are", () => {
  expect(profileMasteryText(profile(STARTER_STAFF, { archery: 23 }))).toBe("");
  expect(profileMasteryText(profile("frost_bow", { archery: 0 }))).toBe("");
  expect(profileMasteryText(profile("frost_bow"))).toBe("");
  expect(profileMasteryText(profile("frost_bow", null))).toBe("");
});

it("reads your own level from the live points over the profile's", () => {
  const points = { archery: BigInt(masteryPointsForLevel(23)), swordplay: 0n, sorcery: 0n };
  expect(profileMasteryText(profile("frost_bow", { archery: 5 }), points)).toBe("Archery Lv 23");
  expect(profileMasteryText(profile("frost_bow", { archery: 5 }), { ...points, archery: 0n })).toBe("");
});
