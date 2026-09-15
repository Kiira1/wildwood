/** One durable announcement; clients animate its clock without server traffic. */
export type ReleasePhase = "scheduled" | "draining" | "updating" | "complete" | "cancelled";
export type ReleaseWindow = {
  id: string;
  version: string;
  phase: ReleasePhase;
  startsAt: number;
  expiresAt: number;
  updatedAt: number;
  reload: boolean;
};
export const RELEASE_DRAIN_MS = 30_000;
export const RELEASE_LEASE_MS = 90_000;
export function parseReleaseWindow(value: unknown): ReleaseWindow | null {
  try {
    const r = typeof value === "string" ? JSON.parse(value) : value;
    if (!r || typeof r.id !== "string" || !/^[\w.-]{1,100}$/.test(r.id) ||
      typeof r.version !== "string" || !/^\d+(?:\.\d+)+$/.test(r.version) ||
      !["scheduled", "draining", "updating", "complete", "cancelled"].includes(r.phase) ||
      ![r.startsAt, r.expiresAt, r.updatedAt].every(Number.isSafeInteger) ||
      r.startsAt < 0 || r.expiresAt <= r.updatedAt || typeof r.reload !== "boolean") return null;
    return r as ReleaseWindow;
  } catch { return null; }
}
export function activeRelease(r: ReleaseWindow | null, now: number) {
  return r && now < r.expiresAt && r.phase !== "complete" && r.phase !== "cancelled" ? r : null;
}
