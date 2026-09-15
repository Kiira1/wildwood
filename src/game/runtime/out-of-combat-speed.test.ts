import { expect, it } from "vitest";
import { BLACK_BOOTS, TRAILBLAZER_BOOTS } from "../../../shared/items";
import { createOutOfCombatSpeed } from "./out-of-combat-speed";
it("adds exactly 25 after five seconds and equipment swaps cannot reset combat", () => {
  let now = 0;
  const speed = createOutOfCombatSpeed(() => now);
  expect(speed.bonus(BLACK_BOOTS)).toBe(25);
  speed.markCombat();
  expect(speed.bonus(BLACK_BOOTS)).toBe(0);
  now = 4999; expect(speed.bonus(BLACK_BOOTS)).toBe(0);
  expect(speed.bonus(TRAILBLAZER_BOOTS)).toBe(0);
  now = 5000; expect(speed.bonus(BLACK_BOOTS)).toBe(25);
  speed.markCombat(); now = 9999; expect(speed.bonus(BLACK_BOOTS)).toBe(0);
  now = 10000; expect(speed.bonus(BLACK_BOOTS)).toBe(25);
  expect(speed.bonus(BLACK_BOOTS, true)).toBe(0);
  now = 14999; expect(speed.bonus(BLACK_BOOTS)).toBe(0);
  now = 15000; expect(speed.bonus(BLACK_BOOTS)).toBe(25);
});
