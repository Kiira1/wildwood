import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { measureSource } from "../tests/helpers/source-readability";

// src/main.ts has no exports. src/main-boot.test.ts runs its composition, but
// nothing else can see its wiring, so these ratchets hold its size down.
// Every past raise and its reason is in `git log -p src/main-boundary.test.ts`.
//
// Lower the numbers as extractions land. Never satisfy them by packing code onto
// longer lines or deleting useful comments: extract a named module instead.
const MAX_LINES = 940;
const MAX_LINES_OVER_160 = 2;
const MAX_LINES_OVER_300 = 0;
const MAX_BYTES = 51_502;

const mainSource = new URL("./main.ts", import.meta.url);

describe("game composition boundary", () => {
  // Intentional agent-context budget, as for wildstat-coop.ts: extract focused modules when this grows.
  it("keeps the composition root below 1,000 lines", () => {
    expect(measureSource(mainSource).lines).toBeLessThan(1_000);
  });

  it("never grows past its last recorded size", () => {
    expect(measureSource(mainSource).lines).toBeLessThanOrEqual(MAX_LINES);
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
