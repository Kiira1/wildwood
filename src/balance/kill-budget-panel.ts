import { normalizeKillBudget, type KillBudgetConfig } from "./kill-budget";
import type { BalanceSimulationResult } from "./simulator";

export function createKillBudgetPanel() {
  const field = (id: string) => document.getElementById(id) as HTMLInputElement;
  const fields = { damageKills: field("budgetDamageKills"), healthKills: field("budgetHealthKills"),
    campaignGrowth: field("budgetCampaignGrowth"), endlessGrowth: field("budgetEndlessGrowth") };
  const enabled = field("killBudgetEnabled");
  const curve = document.getElementById("budgetCurve") as HTMLSelectElement;
  for (const input of Object.values(fields)) input.addEventListener("input", () => { curve.value = "custom"; });
  const rows = document.getElementById("killBudgetRows")!;
  const note = document.getElementById("killBudgetNote")!;
  const number = (value: number | null) => value === null ? "Unreachable" : value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const ratio = (value: number) => `${value.toLocaleString(undefined, { maximumSignificantDigits: 4 })}×`;
  return {
    read(): KillBudgetConfig {
      return normalizeKillBudget({ enabled: enabled.checked, curve: curve.value as "calibrated" | "custom", ...Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, Number(input.value)])) });
    },
    write(config: KillBudgetConfig) {
      enabled.checked = config.enabled;
      curve.value = config.curve ?? "calibrated";
      for (const [key, input] of Object.entries(fields)) input.value = String(config[key as keyof typeof fields]);
    },
    render(result: BalanceSimulationResult) {
      note.textContent = `${result.config.killBudget.enabled ? "Kill-budget scenario is active; the main charts show its simulated progression." : "Current balance is active; proposed counts below are a preview. Enable the kill-budget scenario and run again to compare the time curve."} Counts use the representative trial’s actual entry build. Red = damage kills; green = health kills. Best local reward per kill, including elites. Other stats are held fixed: this is not the fewest possible kills across all farming strategies. Survival means the strongest hit costs at most 30% HP, not surviving a full undodged fight. Boss regeneration is included. Unreached maps have no entry build.`;
      rows.replaceChildren();
      for (const map of result.maps) {
        const row = document.createElement("tr");
        const entry = result.bossReadiness[map.mapId];
        const values = entry ? [map.name,
          `${number(entry.current.damageKills)} → ${number(entry.proposed.damageKills)}`,
          `${number(entry.current.healthKills)} → ${number(entry.proposed.healthKills)}`,
          `${number(entry.current.totalKills)} → ${number(entry.proposed.totalKills)}`,
          ratio(entry.bossHpMultiplier), ratio(entry.bossDamageMultiplier),
          `${Math.round(entry.targetSeconds)}s`, `${entry.damageEnemy} / ${entry.healthEnemy}`]
          : [map.name, "Not reached", "—", "—", "—", "—", "—", "—"];
        values.forEach((text, index) => {
          const cell = document.createElement("td"); cell.textContent = text;
          if (index === 1) cell.style.color = "#b33430";
          if (index === 2) cell.style.color = "#247745";
          row.append(cell);
        });
        rows.append(row);
      }
    },
  };
}
