import "./stat-graph.css";
import { formatCompactNumber } from "../ui/number-format";
import { AUTHORED_STAT_GRAPH, STAT_GRAPH_METRICS, type StatGraphMetric } from "./stat-graph-data";
export * from "./stat-graph-data";

function formatValue(value: number) {
  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 1) return value.toPrecision(3).replace(/0+$/, "").replace(/\.$/, "");
  return formatCompactNumber(value);
}

function formatFullValue(value: number) {
  if (Math.abs(value) < 1_000_000_000_000_000_000_000) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
  }
  return value.toExponential(4);
}

function formatMultiplier(value: number | null) {
  if (value === null) return "—";
  if (value >= 100 || value < 0.01) return `${value.toExponential(2)}×`;
  if (value >= 10 || value < 0.1) return `${value.toFixed(1)}×`;
  return `${value.toFixed(2)}×`;
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

function renderChart(svg: SVGSVGElement, metrics: readonly StatGraphMetric[]) {
  const width = 1120;
  const height = 410;
  const margin = { top: 24, right: 24, bottom: 92, left: 76 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = metrics.flatMap((metric) => AUTHORED_STAT_GRAPH
    .map((row) => row.multipliers[metric.key])
    .filter((value): value is number => value !== null && value > 0));
  const minimum = Math.min(...values, 1);
  const maximum = Math.max(...values, 1);
  const minimumExponent = Math.min(0, Math.floor(Math.log10(minimum)));
  const maximumExponent = Math.max(0, Math.ceil(Math.log10(maximum)));
  const domainMinimum = 10 ** minimumExponent;
  const domainMaximum = 10 ** maximumExponent;
  const logMinimum = Math.log10(domainMinimum);
  const logRange = Math.log10(domainMaximum) - logMinimum || 1;
  const x = (index: number) => margin.left + (index / (AUTHORED_STAT_GRAPH.length - 1)) * plotWidth;
  const y = (value: number) => margin.top + (1 - (Math.log10(value) - logMinimum) / logRange) * plotHeight;

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Map-to-map balance multipliers");
  const title = svgElement("title", {});
  title.textContent = "Map-to-map balance multipliers";
  const description = svgElement("desc", {});
  description.textContent = "Each point is the current map value divided by the previous map value. Tutorial Forest is the baseline.";
  svg.append(title, description);

  for (let exponent = minimumExponent; exponent <= maximumExponent; exponent += 1) {
    for (const base of [1, 2, 5]) {
      const tick = base * 10 ** exponent;
      if (tick < domainMinimum || tick > domainMaximum) continue;
      const tickY = y(tick);
      svg.append(
        svgElement("line", {
          x1: String(margin.left), x2: String(width - margin.right),
          y1: String(tickY), y2: String(tickY),
          class: tick === 1 ? "chart-grid chart-baseline" : "chart-grid",
        }),
        svgElement("text", {
          x: String(margin.left - 12), y: String(tickY + 4),
          class: "chart-axis-label", "text-anchor": "end",
        }),
      );
      svg.lastChild!.textContent = formatMultiplier(tick);
    }
  }

  svg.append(
    svgElement("line", {
      x1: String(margin.left), x2: String(margin.left),
      y1: String(margin.top), y2: String(height - margin.bottom),
      class: "chart-axis",
    }),
    svgElement("line", {
      x1: String(margin.left), x2: String(width - margin.right),
      y1: String(height - margin.bottom), y2: String(height - margin.bottom),
      class: "chart-axis",
    }),
  );

  const yAxisTitle = svgElement("text", {
    x: "18", y: String(margin.top + plotHeight / 2),
    class: "chart-axis-title", transform: `rotate(-90 18 ${margin.top + plotHeight / 2})`,
    "text-anchor": "middle",
  });
  yAxisTitle.textContent = "multiplier vs previous map";
  svg.append(yAxisTitle);

  AUTHORED_STAT_GRAPH.forEach((row, index) => {
    const label = svgElement("text", {
      x: String(x(index)), y: String(height - margin.bottom + 22),
      class: "chart-map-label", transform: `rotate(-38 ${x(index)} ${height - margin.bottom + 22})`,
      "text-anchor": "end",
    });
    label.textContent = `${index + 1}. ${row.name}`;
    svg.append(label);
  });

  for (const metric of metrics) {
    let path = "";
    let connected = false;
    AUTHORED_STAT_GRAPH.forEach((row, index) => {
      const multiplier = row.multipliers[metric.key];
      if (multiplier === null || multiplier <= 0) {
        connected = false;
        return;
      }
      path += `${connected ? " L" : "M"} ${x(index).toFixed(2)} ${y(multiplier).toFixed(2)}`;
      connected = true;
    });
    if (path) svg.append(svgElement("path", { d: path, class: `chart-line series-${metric.series}` }));

    AUTHORED_STAT_GRAPH.forEach((row, index) => {
      const multiplier = row.multipliers[metric.key];
      if (multiplier === null || multiplier <= 0) return;
      const point = svgElement("circle", {
        cx: String(x(index)), cy: String(y(multiplier)), r: "4",
        class: `chart-point series-${metric.series}`,
      });
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `${row.name}: ${formatMultiplier(multiplier)}`;
      point.append(title);
      svg.append(point);
    });
  }
}

function renderLegend(container: HTMLElement, metrics: readonly StatGraphMetric[]) {
  container.replaceChildren();
  for (const metric of metrics) {
    const item = document.createElement("span");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = `legend-swatch series-${metric.series}`;
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, document.createTextNode(metric.label));
    container.append(item);
  }
}

function renderTable(table: HTMLTableElement, metrics: readonly StatGraphMetric[]) {
  table.replaceChildren();
  const head = table.createTHead().insertRow();
  const metricHeading = document.createElement("th");
  metricHeading.scope = "col";
  metricHeading.textContent = "Metric";
  head.append(metricHeading);
  for (const [index, row] of AUTHORED_STAT_GRAPH.entries()) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.innerHTML = `<span>${index + 1}</span><small>${row.name}</small>`;
    head.append(cell);
  }

  const body = table.createTBody();
  for (const metric of metrics) {
    const row = body.insertRow();
    const label = row.insertCell();
    label.className = "metric-label";
    label.innerHTML = `<span class="legend-swatch series-${metric.series}"></span>${metric.label}`;
    for (const [index, data] of AUTHORED_STAT_GRAPH.entries()) {
      const cell = row.insertCell();
      const value = data.values[metric.key];
      const multiplier = data.multipliers[metric.key];
      if (value === null) {
        cell.innerHTML = "<span class=\"missing\">—</span>";
        continue;
      }
      const valueText = formatValue(value);
      const fullValue = formatFullValue(value);
      const stepText = index === 0 ? "BASE" : formatMultiplier(multiplier);
      const source = metric.regularReward
        ? data.regularRewards[metric.regularReward.stat][metric.regularReward.sourceIndex]
        : null;
      const sourceText = source ? `${source.kind} · ` : "";
      cell.innerHTML = `<span title="${fullValue}">${valueText}</span><small>${sourceText}${stepText}</small>`;
    }
  }
}

function render() {
  const combatMetrics = STAT_GRAPH_METRICS.filter((metric) => metric.group === "combat");
  const rewardMetrics = STAT_GRAPH_METRICS.filter((metric) => metric.group === "rewards");
  const combatChart = document.querySelector<SVGSVGElement>("#combat-chart");
  const rewardChart = document.querySelector<SVGSVGElement>("#reward-chart");
  const combatLegend = document.querySelector<HTMLElement>("#combat-legend");
  const rewardLegend = document.querySelector<HTMLElement>("#reward-legend");
  const combatTable = document.querySelector<HTMLTableElement>("#combat-table");
  const rewardTable = document.querySelector<HTMLTableElement>("#reward-table");
  if (!combatChart || !rewardChart || !combatLegend || !rewardLegend || !combatTable || !rewardTable) return;

  renderChart(combatChart, combatMetrics);
  renderChart(rewardChart, rewardMetrics);
  renderLegend(combatLegend, combatMetrics);
  renderLegend(rewardLegend, rewardMetrics);
  renderTable(combatTable, combatMetrics);
  renderTable(rewardTable, rewardMetrics);
}

if (typeof document !== "undefined") render();
