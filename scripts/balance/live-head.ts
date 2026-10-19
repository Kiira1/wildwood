import { execFileSync } from "node:child_process";
import { validateBalanceSettings } from "../../shared/map-balance";
import type { BalanceSettings } from "../../shared/map-balance-types";

/** The live head revision and its settings, read-only (one join, so the pair is consistent). No player data. */
export function readLiveBalance(): { revision: number; settings: BalanceSettings } {
  const query = "SELECT v.revision, v.settings_json FROM map_balance_version v JOIN map_balance_head h ON v.revision = h.revision";
  const output = execFileSync(process.env.SPACETIME_BIN || "spacetime", [
    "sql", "wildwood-coop", "--server", "maincloud", "--format", "json", query,
  ], { encoding: "utf8", timeout: 30_000 });
  const rows = JSON.parse(output)[0]?.rows;
  if (rows?.length !== 1) throw new Error("Expected one live balance revision.");
  const [revision, json] = rows[0];
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid balance revision.");
  return { revision, settings: validateBalanceSettings(JSON.parse(json)) };
}

/** Where two balances differ, factor by factor ("cloudspire.enemyHealth 1 → 1.2"). */
export function balanceDifferences(live: BalanceSettings, repo: BalanceSettings) {
  const out: string[] = [];
  if ((live.curveVersion ?? 0) !== (repo.curveVersion ?? 0)) out.push(`curve ${live.curveVersion ?? "old"} → ${repo.curveVersion ?? "old"}`);
  for (const [map, factors] of Object.entries(repo.maps)) for (const [field, value] of Object.entries(factors)) {
    const was = (live.maps[map] as Record<string, number> | undefined)?.[field];
    if (was !== value) out.push(`${map}.${field} ${was} → ${value}`);
  }
  return out;
}
