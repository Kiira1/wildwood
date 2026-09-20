/**
 * Delete map instances that hold nobody. Nothing retires them on its own, so a
 * map visited once keeps its database for good — Endless especially, where each
 * depth anyone reaches leaves one behind.
 *
 * Dry run by default. Pass --apply to delete, --endless-only to limit it to
 * generated maps, which no one returns to.
 *
 * The directory row goes first: while it exists admission can still route a
 * player into a database that is about to disappear.
 */
import { execFileSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const endlessOnly = process.argv.includes("--endless-only");
const database = process.env.WILDSTAT_ROOT_DATABASE ?? "wildwood-coop";
const server = process.env.WILDSTAT_SPACETIME_SERVER ?? "maincloud";

function run(args: string[]) {
  // Maincloud closes connections under a rapid series of calls; a short retry
  // keeps a long pass from stopping partway through.
  for (let attempt = 0; ; attempt++) {
    try {
      return execFileSync("spacetime", args, { encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      if (attempt >= 4) throw error;
      execFileSync("sleep", [String(attempt + 1)]);
    }
  }
}

function sql(query: string) {
  const out = run(["sql", database, query, "--server", server, "--format", "json"]);
  const parsed = JSON.parse(out);
  const columns: string[] = parsed[0]?.schema?.elements?.map((e: any) => e.name?.some) ?? [];
  return parsed.flatMap((section: any) => section.rows ?? []).map((row: any[]) =>
    Object.fromEntries(columns.map((name, index) => [name, row[index]])));
}

const shards = sql("SELECT id, map_id, database_name, state, occupants FROM map_shard");
const members = sql("SELECT shard_id FROM map_shard_member");
const occupied = new Set(members.map(row => String(row.shard_id)));

const candidates = shards.filter(shard =>
  Number(shard.occupants) === 0 &&
  !occupied.has(String(shard.id)) &&
  (!endlessOnly || String(shard.map_id).startsWith("endless_")));

console.log(`instances: ${shards.length}  holding nobody: ${candidates.length}${endlessOnly ? " (generated maps only)" : ""}`);
const byMap = new Map<string, number>();
for (const shard of candidates) byMap.set(String(shard.map_id), (byMap.get(String(shard.map_id)) ?? 0) + 1);
for (const [mapId, count] of [...byMap].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${mapId.padEnd(24)} ${count}`);

let removed = 0;
for (const shard of candidates) {
  if (!apply) { removed += 1; continue; }
  // Re-read immediately: an instance empty a moment ago can take an admission.
  const [current] = sql(`SELECT occupants FROM map_shard WHERE id = ${Number(shard.id)}`);
  if (!current || Number(current.occupants) !== 0) {
    console.log(`  skip ${shard.id} (${shard.map_id}): occupied since the listing`);
    continue;
  }
  // The directory row goes first, which makes it unroutable straight away.
  sql(`DELETE FROM map_shard WHERE id = ${Number(shard.id)}`);
  run(["delete", String(shard.database_name), "--server", server]);
  removed += 1;
  if (removed % 10 === 0) console.log(`  removed ${removed}/${candidates.length}`);
}
console.log(`\n${apply ? "REMOVED" : "WOULD REMOVE"} ${removed} instances. ${shards.length - removed} remain.`);
