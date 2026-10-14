import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The server bundles SpacetimeDB's own RNG: scripts/patch-spacetimedb-rng.mjs fixes its signed-shift seed.
const COPIES = ["../node_modules/spacetimedb", "../../node_modules/spacetimedb"]
  .map(copy => new URL(`${copy}/dist/server/index.mjs`, import.meta.url))
  .filter(url => existsSync(url));

/** The installed generator, lifted out of the bundle: pure-rand, then pcg32 and makeRandom. */
function installedMakeRandom(url: URL): (seed: bigint) => () => number {
  const source = readFileSync(url, "utf8");
  const start = source.indexOf("// ../../node_modules/.pnpm/pure-rand@");
  const end = source.indexOf("function isBigIntArray(");
  if (start < 0 || end < 0) throw new Error("The SpacetimeDB RNG moved: look again at scripts/patch-spacetimedb-rng.mjs.");
  const body = `${source.slice(start, end)}\nreturn (seed) => makeRandom(seed);`;
  return new Function(body)();
}

describe("SpacetimeDB's server RNG", () => {
  it("is installed with the unsigned-shift fix", () => {
    expect(COPIES.length).toBeGreaterThan(0);
    for (const url of COPIES) {
      const source = readFileSync(url, "utf8");
      expect(source).not.toContain("return xorshifted >> rot | xorshifted << 32 - rot;");
      expect(source).toContain("return (xorshifted >>> rot | xorshifted << 32 - rot) >>> 0;");
    }
  });

  it("makes a transaction's first draw as fair as its second: a 1% roll comes up about 1%, not 34%", () => {
    for (const url of COPIES) {
      const makeRandom = installedMakeRandom(url);
      const seeds = 20_000;
      let first = 0, second = 0;
      for (let index = 0; index < seeds; index++) {
        // Timestamps in microseconds, a few hundred apart, as transactions are.
        const random = makeRandom(1_791_964_800_000_000n + BigInt(index) * 317n);
        if (random() < .01) first++;
        if (random() < .01) second++;
      }
      expect(first / seeds).toBeGreaterThan(.006);
      expect(first / seeds).toBeLessThan(.014);
      expect(second / seeds).toBeGreaterThan(.006);
      expect(second / seeds).toBeLessThan(.014);
    }
  });
});
