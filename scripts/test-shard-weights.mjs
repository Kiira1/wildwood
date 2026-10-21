#!/usr/bin/env node
// Measures how long each test file takes (its imports and its tests) in a full
// run of the default suite and writes tests/shard-weights.json, which CI's
// `--shard` split reads (tests/shard-sequencer.ts). Files over a second are
// listed; every other file counts as the median of the rest.
//
//   npm run test:weights
//
// Rerun it after adding or splitting a slow file. A stale entry only makes the
// four CI parts less even; it never skips a test.
import { writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { startVitest } from "vitest/node";

const root = resolve(new URL("..", import.meta.url).pathname);
const out = resolve(root, "tests/shard-weights.json");
const LISTED_FROM_SECONDS = 1;

const seconds = new Map();
const vitest = await startVitest("test", [], { watch: false, reporters: ["dot", {
  onTestRunEnd(modules) {
    for (const module of modules) {
      const { collectDuration, duration } = module.diagnostic();
      seconds.set(relative(root, module.moduleId).replaceAll("\\", "/"), (collectDuration + duration) / 1000);
    }
  },
}] });
await vitest?.close();
if (!vitest || process.exitCode) throw new Error("The suite failed; weights not written");

const small = [...seconds.values()].filter(value => value < LISTED_FROM_SECONDS).sort((a, b) => a - b);
const files = Object.fromEntries([...seconds].filter(([, value]) => value >= LISTED_FROM_SECONDS)
  .sort(([a], [b]) => (a < b ? -1 : 1)).map(([file, value]) => [file, Math.round(value * 10) / 10]));
const unlisted = Math.round((small[small.length >> 1] ?? 0.5) * 100) / 100;
await writeFile(out, `${JSON.stringify({ unlisted, files }, null, 2)}\n`);
console.log(`Wrote ${relative(root, out)}: ${Object.keys(files).length} files listed, ${small.length} at ${unlisted}s`);
