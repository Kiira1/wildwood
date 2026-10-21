/**
 * Read-only: who has been paid kills faster than honest play, and who the
 * server has written down for it.
 *
 * gem_kill_daily holds each account's reported kills a UTC day, with the
 * first and last report. Kills over that span is the slowest the account
 * could have been farming: an honest player who also took breaks shows
 * lower, never higher, so a span rate above honest play needs a look. A day
 * with more kills than honest play fits in 24 hours cannot be honest at all.
 *
 * Alongside it, the moderation lines the server writes by itself:
 * sustained_kill_rate (paid kills above honest play for a stretch) and
 * simulation_clock_ahead (a game clock running faster than real time).
 *
 *   npm run audit:kill-rates
 *   npm run audit:kill-rates -- --top 30 --above 2.2
 *
 * Nothing here writes.
 */
import { execFileSync } from "node:child_process";

type Row = Record<string, any>;
const DATABASE = "wildwood-coop";
const args = process.argv.slice(2);
const option = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && Number.isFinite(Number(args[index + 1])) ? Number(args[index + 1]) : fallback;
};
const TOP = option("top", 20);
const ABOVE = option("above", 2.2);

function sql(query: string): Row[] {
  const output = execFileSync(process.env.SPACETIME_BIN || "spacetime", [
    "sql", DATABASE, "--server", "maincloud", "--format", "json", query,
  ], { encoding: "utf8", timeout: 120_000, maxBuffer: 512 * 1024 * 1024 });
  const table = JSON.parse(output)[0];
  if (!table?.rows) return [];
  return table.rows.map((row: any[]) => Object.fromEntries(table.schema.elements
    .map((element: any, index: number) => [element.name?.some ?? element.name, row[index]])));
}

/** Identities arrive as ["0x…"] and timestamps as [micros]. */
const unwrap = (value: any) => Array.isArray(value) ? value[0] : value;
const hex = (identity: any) => String(unwrap(identity)).replace(/^0x/i, "").toLowerCase();
const seconds = (timestamp: any) => Number(unwrap(timestamp)) / 1e6;
const when = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString().slice(5, 16).replace("T", " ");

const names = new Map(sql("SELECT identity, display_name FROM player_profile").map(row => [hex(row.identity), row.display_name as string]));
const nameOf = (identity: string) => names.get(identity) || identity.slice(0, 12);

/** Spans shorter than this say little: a quick burst between two reports. */
const MIN_SPAN_SECONDS = 15 * 60;
type Day = { identity: string; day: string; kills: number; span: number; rate: number };
const days: Day[] = sql("SELECT identity, day_key, kills, first_at, last_at FROM gem_kill_daily").map(row => {
  const span = seconds(row.last_at) - seconds(row.first_at);
  const kills = Number(row.kills);
  return { identity: hex(row.identity), day: new Date(Number(row.day_key) * 86_400_000).toISOString().slice(5, 10), kills, span,
    rate: span >= MIN_SPAN_SECONDS ? kills / span : 0 };
});
const accounts = new Set(days.map(day => day.identity));
const rates = days.filter(day => day.rate > 0).map(day => day.rate).sort((a, b) => a - b);
const percentile = (p: number) => rates.length ? rates[Math.min(rates.length - 1, Math.floor(rates.length * p))] : 0;
const span = [...new Set(days.map(day => day.day))].sort();
console.log(`Kill days: ${accounts.size} accounts, ${days.length} days, ${span[0] ?? "-"} to ${span.at(-1) ?? "-"} UTC.`);
console.log(`Kills over each day's first-to-last report: median ${percentile(.5).toFixed(2)}/s, p99 ${percentile(.99).toFixed(2)}/s.\n`);

console.log(`Days above ${ABOVE}/s, or with more kills than ${ABOVE}/s fits in a day:`);
const suspicious = days.filter(day => day.rate >= ABOVE || day.kills > ABOVE * 86_400)
  .sort((a, b) => b.kills / 86_400 - a.kills / 86_400 || b.rate - a.rate);
if (!suspicious.length) console.log("  nobody");
for (const day of suspicious.slice(0, TOP))
  console.log(`  ${nameOf(day.identity).padEnd(22)} ${day.day}  ${String(day.kills).padStart(8)} kills over ${(day.span / 3_600).toFixed(1).padStart(4)} h  ${day.rate.toFixed(2)}/s`);

console.log(`\nMost kills in a day (top ${TOP}):`);
for (const day of [...days].sort((a, b) => b.kills - a.kills).slice(0, TOP))
  console.log(`  ${nameOf(day.identity).padEnd(22)} ${day.day}  ${String(day.kills).padStart(8)} kills over ${(day.span / 3_600).toFixed(1).padStart(4)} h  ${day.rate.toFixed(2)}/s`);

const flags = sql("SELECT target_identity, target_name, action, rule, reason, recorded_at FROM moderation_action WHERE actor_type = 'automatic'")
  .filter(row => ["pay_ceiling_shadow", "sustained_kill_rate", "simulation_clock_ahead", "enemy_defeat_allowance", "movement_speed_allowance"].includes(row.rule));
console.log("\nAutomatic flags by the server:");
if (!flags.length) console.log("  none");
const byAccount = new Map<string, Row[]>();
// The pay ceiling writes a line when an episode starts and another with its total when it ends.
const label = (row: Row) => row.rule === "pay_ceiling_shadow" ? (row.action === "pay_ceiling_episode_total" ? "pay_ceiling (episode end)" : "pay_ceiling (would clip)") : row.rule;
for (const row of flags) byAccount.set(`${row.target_name}|${label(row)}`, [...(byAccount.get(`${row.target_name}|${label(row)}`) ?? []), row]);
for (const [key, rows] of [...byAccount].sort((a, b) => b[1].length - a[1].length)) {
  const [name, rule] = key.split("|");
  const times = rows.map(row => seconds(row.recorded_at)).sort((a, b) => a - b);
  const cut = rows.reduce((sum, row) => sum + Number(/would have paid (\d+) fewer kills in all/.exec(row.reason)?.[1] ?? 0), 0);
  console.log(`  ${(name || "?").padEnd(22)} ${rule.padEnd(26)} ${String(rows.length).padStart(3)}x  ${when(times[0])}${rows.length > 1 ? ` .. ${when(times.at(-1)!)}` : ""}${cut ? `   ${cut} kills over the ceiling` : ""}`);
}
console.log("\npay_ceiling_shadow: the pay ceiling would have paid this account less (watching only; nothing clipped). Rows before 0.877 only: the shadow check was removed.");
console.log("sustained_kill_rate and simulation_clock_ahead are written by 0.827 and later; enemy_defeat_allowance and movement_speed_allowance are the retired rules from 09-18 to 09-21, which also caught honest players.");
