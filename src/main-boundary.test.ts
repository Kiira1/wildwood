import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { measureSource } from "../tests/helpers/source-readability";

// src/main.ts has no exports and nothing imports it, so no behavioural test can
// cover its wiring. These ratchets are the only automated pressure on its size.
// Every past raise and its reason is in `git log -p src/main-boundary.test.ts`.
//
// Lower the numbers as extractions land. Never satisfy them by packing code onto
// longer lines or deleting useful comments: extract a named module instead.
const MAX_LINES = 1_938;
const TARGET_LINES = 1_000;
const MAX_LINES_OVER_160 = 86;
const MAX_LINES_OVER_300 = 17;
const MAX_BYTES = 113_669;

const mainSource = new URL("./main.ts", import.meta.url);

describe("game composition boundary", () => {
  it("never grows past its last recorded size", () => {
    expect(measureSource(mainSource).lines).toBeLessThanOrEqual(MAX_LINES);
  });

  it("records how far the facade still is from the documented target", () => {
    // Fails once the facade reaches 1,000 lines, as a prompt to replace this
    // ratchet with the strict sub-1,000 assertion that wildstat-coop.ts uses.
    expect(MAX_LINES).toBeGreaterThan(TARGET_LINES);
  });

  it("adds no long lines, so the line ratchet cannot be dodged by packing", () => {
    const measure = measureSource(mainSource);
    expect(measure.linesOver160).toBeLessThanOrEqual(MAX_LINES_OVER_160);
    expect(measure.linesOver300).toBeLessThanOrEqual(MAX_LINES_OVER_300);
  });

  it("never grows past its byte budget", () => {
    expect(measureSource(mainSource).bytes).toBeLessThanOrEqual(MAX_BYTES);
  });
});

describe("game composition wiring", () => {
  // main.ts has no tests of its own, and a callback that takes fewer arguments
  // still type-checks. Dropping the attacker here left Reflect dead against
  // every melee enemy from 0.823 to 0.829 while its own tests passed.
  it("hands the enemy that struck to the player's damage, so Reflect can answer it", () => {
    const source = readFileSync(mainSource, "utf8");
    expect(source).toMatch(/\(amount, source\) => playerCombat\.damagePlayer\(amount, source\)/);
  });
});
