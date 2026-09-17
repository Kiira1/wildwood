export const PATREON_TICKER_CHANGED = "wildstat:patreon-ticker-changed";

/** Leases expire locally without polling or trusting a developer preview frame. */
export function validSupporterNames(rows: Iterable<{ name: string; validUntilMs: number }>, now = Date.now()) {
  return [...rows].filter(row => row.validUntilMs > now && row.name.trim())
    .map(row => row.name).sort((a, b) => a.localeCompare(b));
}
