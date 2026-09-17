import { formatCompactNumber } from "./number-format";

/** Keep small upgrades visible (+5 → +5.4); abbreviate large map-tier amounts. */
export function formatEquipmentAmount(value: number) {
  return Math.abs(value) < 1000 ? `${Number(value.toFixed(2))}` : formatCompactNumber(value);
}

export function formatEquipmentStat(stat: string) {
  return stat.replace(/\+([\d.]+)$/, (_, value: string) => `+${formatEquipmentAmount(Number(value))}`);
}
