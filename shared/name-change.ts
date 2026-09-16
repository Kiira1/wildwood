export const NAME_CHANGE_GEM_COST = 50;
export const NAME_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export type NameChangeStatus = { cost: number; availableAtMs: number; serverNowMs: number; balance: number };
export function nameChangeStatus(changedAtMs: number | null, nowMs: number, balance: number): NameChangeStatus {
  return { cost: changedAtMs === null ? 0 : NAME_CHANGE_GEM_COST,
    availableAtMs: changedAtMs === null ? 0 : changedAtMs + NAME_CHANGE_COOLDOWN_MS, serverNowMs: nowMs, balance };
}
