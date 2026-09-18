import "./stat-graph.css";
import "./reward-health-graph.css";
import { MAP_IDS } from "../../shared/rules";
import { REWARD_STATS, REWARD_COLORS, REWARD_LABELS, rewardHealthRows, rewardHealthCsv, type RewardHealthRow } from "./reward-health-data";
import { formatRewardNumber, renderRewardHealthChart } from "./reward-health-chart";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = (id: string) => element<HTMLSelectElement>(id);
const enabledStats = new Set(REWARD_STATS);
let rows: RewardHealthRow[] = [];
let visibleRows: RewardHealthRow[] = [];

for (const stat of REWARD_STATS) {
  const label = document.createElement("label"), checkbox = document.createElement("input"), swatch = document.createElement("span");
  checkbox.type = "checkbox"; checkbox.checked = true; checkbox.value = stat;
  swatch.className = "stat-swatch"; swatch.style.background = REWARD_COLORS[stat];
  label.append(checkbox, swatch, REWARD_LABELS[stat]); element("stats").append(label);
  checkbox.addEventListener("change", () => { if (checkbox.checked) enabledStats.add(stat); else enabledStats.delete(stat); render(); });
}
function boundedInput(id: string, maximum: number) {
  const input = element<HTMLInputElement>(id);
  const value = Number(input.value);
  const normalized = Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value))) : 1;
  input.value = String(normalized); return normalized;
}
function reload() {
  const scope = select("scope").value;
  const endless = scope !== "campaign";
  document.querySelectorAll<HTMLElement>(".endless-control").forEach(label => { label.hidden = !endless; });
  const start = boundedInput("endless-start", 10000), count = boundedInput("endless-count", 100);
  const mapIds = [...(scope !== "endless" ? MAP_IDS : []), ...(endless ? Array.from({ length: count }, (_, i) => `endless_${start + i}`) : [])];
  rows = rewardHealthRows(mapIds);
  const maps = new Map(rows.map(row => [row.mapId, row.mapName]));
  const mapSelect = select("map");
  mapSelect.replaceChildren(new Option("All maps", "all"), ...[...maps].map(([id, name]) => new Option(name, id)));
  render();
}
function inspect(row: RewardHealthRow) {
  element("point-detail").textContent = `${row.mapName} · ${row.enemy} (${row.elite ? "elite" : row.kind}) — ${REWARD_LABELS[row.stat]} +${formatRewardNumber(row.reward)} / ${formatRewardNumber(row.hp)} HP = ${formatRewardNumber(row.ratio)} per HP. ${row.population} spawn${row.population === 1 ? "" : "s"}.`;
}
function renderTable() {
  const sorted = [...visibleRows];
  const direction = select("sort").value;
  if (direction !== "map") sorted.sort((a, b) => direction === "high" ? b.ratio - a.ratio : a.ratio - b.ratio);
  const body = document.querySelector<HTMLTableSectionElement>("#reward-table tbody")!;
  const units = Number(select("units").value);
  element("ratio-heading").textContent = `Reward / ${units.toLocaleString()} HP`;
  const fragment = document.createDocumentFragment();
  for (const row of sorted) {
    const tr = document.createElement("tr");
    for (const [index, text] of [row.mapName, row.enemy, row.elite ? "Elite" : row.kind === "boss" ? "Boss" : "Regular", REWARD_LABELS[row.stat], formatRewardNumber(row.hp), formatRewardNumber(row.reward), formatRewardNumber(row.ratio * units)].entries()) {
      const td = document.createElement("td"); td.textContent = text;
      if (index === 3) { td.style.color = REWARD_COLORS[row.stat]; td.style.fontWeight = "700"; }
      if (index >= 4) td.title = String(index === 4 ? row.hp : index === 5 ? row.reward : row.ratio * units);
      tr.append(td);
    }
    fragment.append(tr);
  }
  if (!sorted.length) {
    const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 7; td.textContent = "No payouts match these filters."; tr.append(td); fragment.append(tr);
  }
  body.replaceChildren(fragment);
}
function render() {
  visibleRows = rows.filter(row => enabledStats.has(row.stat) && (select("map").value === "all" || row.mapId === select("map").value) && (select("kind").value === "all" || row.kind === select("kind").value));
  element("summary").textContent = `${new Set(visibleRows.map(row => row.enemyId)).size} enemies · ${visibleRows.length} payouts`;
  element("point-detail").textContent = "Select a point to inspect its reward and health.";
  renderRewardHealthChart(document.querySelector<SVGSVGElement>("#efficiency-chart")!, visibleRows, select("scale").value === "log", Number(select("units").value), inspect);
  renderTable();
}
for (const id of ["scope", "endless-start", "endless-count"]) element(id).addEventListener("change", reload);
for (const id of ["map", "kind", "scale", "units"]) element(id).addEventListener("change", render);
element("sort").addEventListener("change", renderTable);
element("export").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([rewardHealthCsv(visibleRows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "wildstat-reward-per-health.csv"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
reload();
