import { REWARD_COLORS, REWARD_LABELS, type RewardHealthRow } from "./reward-health-data";

export function formatRewardNumber(value: number) {
  if (value === 0) return "0";
  return value < .001 || value >= 1e9 ? value.toExponential(3) : new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(value);
}
function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}, text = "") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  node.textContent = text;
  return node;
}
export function renderRewardHealthChart(svg: SVGSVGElement, rows: RewardHealthRow[], logarithmic: boolean, units: number, inspect: (row: RewardHealthRow) => void) {
  svg.replaceChildren();
  const maps = [...new Set(rows.map(row => row.mapId))];
  const width = Math.max(1000, maps.length * 125 + 120), height = 520;
  const left = 100, top = 30, bottom = 130, right = 28;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.width = `${width}px`;
  svg.append(svgNode("title", {}, "Reward per enemy health"), svgNode("desc", {}, "Colors identify reward stats. Circles are regular enemies and squares are bosses. Exact values also appear in the table below."));
  if (!rows.length) { svg.append(svgNode("text", { x: 100, y: 100 }, "No payouts match these filters.")); return; }
  const positive = rows.map(row => row.ratio * units).filter(value => value > 0);
  const min = logarithmic ? Math.floor(Math.log10(Math.min(...positive))) : 0;
  const max = logarithmic ? Math.max(min + 1, Math.ceil(Math.log10(Math.max(...positive)))) : Math.max(...positive) * 1.1 || 1;
  const y = (value: number) => top + plotHeight * (1 - ((logarithmic ? Math.log10(value) : value) - min) / (max - min));
  const ticks = logarithmic ? Array.from({ length: max - min + 1 }, (_, i) => 10 ** (min + i)) : Array.from({ length: 6 }, (_, i) => max * i / 5);
  for (const tick of ticks) {
    svg.append(svgNode("line", { x1: left, x2: width - right, y1: y(tick), y2: y(tick), class: "chart-grid" }),
      svgNode("text", { x: left - 12, y: y(tick) + 4, "text-anchor": "end", class: "chart-axis-label" }, formatRewardNumber(tick)));
  }
  svg.append(svgNode("text", { x: left, y: 15, class: "chart-axis-title" }, `Reward per ${units.toLocaleString()} HP · ${logarithmic ? "log scale" : "linear scale"}`));
  maps.forEach((mapId, mapIndex) => {
    const mapRows = rows.filter(row => row.mapId === mapId);
    const enemies = [...new Set(mapRows.map(row => row.enemyId))];
    const groupWidth = plotWidth / maps.length;
    const groupLeft = left + mapIndex * groupWidth;
    svg.append(svgNode("line", { x1: groupLeft, x2: groupLeft, y1: top, y2: top + plotHeight, class: "chart-grid" }));
    const labelX = groupLeft + groupWidth / 2, labelY = top + plotHeight + 24;
    svg.append(svgNode("text", { x: labelX, y: labelY, transform: `rotate(-40 ${labelX} ${labelY})`, "text-anchor": "end", class: "chart-map-label" }, mapRows[0].mapName));
    for (const row of mapRows) {
      if (logarithmic && row.ratio <= 0) continue;
      const cx = groupLeft + groupWidth * (enemies.indexOf(row.enemyId) + 1) / (enemies.length + 1), cy = y(row.ratio * units);
      const point = row.kind === "boss" ? svgNode("rect", { x: cx - 5, y: cy - 5, width: 10, height: 10 }) : svgNode("circle", { cx, cy, r: 5 });
      const description = `${row.mapName} · ${row.enemy} · ${REWARD_LABELS[row.stat]}: ${formatRewardNumber(row.reward)} ÷ ${formatRewardNumber(row.hp)} HP = ${formatRewardNumber(row.ratio)} per HP`;
      point.setAttribute("fill", REWARD_COLORS[row.stat]); point.setAttribute("class", "reward-point");
      point.setAttribute("tabindex", "0"); point.setAttribute("role", "button"); point.setAttribute("aria-label", description);
      point.append(svgNode("title", {}, description));
      for (const event of ["pointerenter", "focus", "click"]) point.addEventListener(event, () => inspect(row));
      point.addEventListener("keydown", event => { if ((event as KeyboardEvent).key === "Enter" || (event as KeyboardEvent).key === " ") { event.preventDefault(); inspect(row); } });
      svg.append(point);
    }
  });
}
