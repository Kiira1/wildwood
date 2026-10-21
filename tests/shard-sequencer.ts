import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

/**
 * Splits the suite for `--shard` by how long each file takes, not by file
 * count: a booted scenario file runs for many seconds, most unit files for
 * well under one. Seconds per file come from tests/shard-weights.json
 * (`npm run test:weights` rewrites it); a file not listed counts as `unlisted`.
 */
const weights: { unlisted: number; files: Record<string, number> } =
  JSON.parse(readFileSync(new URL("./shard-weights.json", import.meta.url), "utf8"));

export class WeightedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]) {
    const { index, count } = this.ctx.config.shard!;
    const path = (spec: TestSpecification) => relative(this.ctx.config.root, spec.moduleId).replace(/\\/g, "/");
    const seconds = (spec: TestSpecification) => weights.files[path(spec)] ?? weights.unlisted;
    // Longest first, each to the part with the least so far: the same split on every machine.
    const parts = Array.from({ length: count }, () => ({ seconds: 0, files: [] as TestSpecification[] }));
    const ordered = [...files].sort((a, b) => seconds(b) - seconds(a) || (path(a) < path(b) ? -1 : 1));
    for (const spec of ordered) {
      const lightest = parts.reduce((best, part) => part.seconds < best.seconds ? part : best);
      lightest.files.push(spec);
      lightest.seconds += seconds(spec);
    }
    return parts[index - 1].files;
  }
}
