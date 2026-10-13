import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// spacetimedb/src/index.ts is the module entry: every reducer, procedure, view
// and table declaration has to live here, because they are the published
// schema and the test fixtures address them by name. Nothing else has to. On
// 2026-09-20 the file was 11,576 lines; five extractions moved the shared-boss
// combat, guest claiming and identity removal, one-time migrations, presence
// and motion sync, and duels into their own modules, leaving 6,846. The
// 2026-10-12 cleanup took it to 4,658.
//
// What must remain is the schema surface: 173 reducers, 25 procedures, 27
// views and 89 tables, the schema registration and the imports. Written as
// thin declarations that is roughly 3,500 lines, which is the target below.
// Everything between here and there is a body that belongs in a module.
//
// Lower MAX_LINES as extractions land. Raising it means a declaration genuinely
// had to be added to the schema surface, and the raise is that declaration
// alone. Growth without an extraction first is the drift this guard stops.
// Do not satisfy it by minifying or removing useful comments/whitespace.
// Each raise is recorded in its commit message, not here; `git log -p` on this
// file has the history of every past raise and why it was allowed.
// 4_658 (2026-10-12): session guards, progress and equipment helpers, research,
// power, item upgrades, the gem wallet, the leaderboard refresh, display names,
// chat, maintenance, character reset, map travel and twelve reducer bodies
// moved to their own modules.
const MAX_LINES = 4_638;
const TARGET_LINES = 3_500;

describe("server module boundary", () => {
  it("never grows past its last recorded size", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const lineCount = source.split(/\r?\n/).length - Number(source.endsWith("\n"));

    expect(lineCount).toBeLessThanOrEqual(MAX_LINES);
  });

  it("records how far the entry module still is from its schema-surface floor", () => {
    // Fails once index.ts is down to its declarations, as a prompt to replace
    // this ratchet with a strict assertion at the measured floor.
    expect(MAX_LINES).toBeGreaterThan(TARGET_LINES);
  });
});
