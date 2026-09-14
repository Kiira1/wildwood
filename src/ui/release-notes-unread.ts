import type { renderUpdateNotice } from "./overlays";

type Releases = Parameters<typeof renderUpdateNotice>[1];
const READ_KEY = "wildstat-release-notes-read-v1";
const indicators = new Set<() => void>();
let sessionRead = "";

function signature(releases: Releases) {
  const latest = releases[0];
  return latest ? JSON.stringify([latest.version, latest.notes]) : "";
}

function lastRead() {
  try { return localStorage.getItem(READ_KEY) ?? sessionRead; } catch { return sessionRead; }
}

/** Shared by sign-in and in-game notes; preparing hidden notes never marks them read. */
export function createReleaseNotesIndicator(toggle: Pick<HTMLElement, "setAttribute">, releases: () => Releases) {
  function refresh() {
    const latest = signature(releases());
    const unread = Boolean(latest && latest !== lastRead());
    toggle.setAttribute("data-unread-notes", String(unread));
    toggle.setAttribute("aria-description", unread ? "Unread release notes" : "");
  }
  function markRead() {
    const latest = signature(releases());
    if (!latest) return;
    sessionRead = latest;
    try { localStorage.setItem(READ_KEY, latest); } catch {}
    for (const update of indicators) update();
  }
  function storageChanged(event: StorageEvent) {
    if (event.key === READ_KEY || event.key === null) refresh();
  }
  indicators.add(refresh);
  if (typeof window !== "undefined") window.addEventListener("storage", storageChanged);
  refresh();
  return {
    refresh,
    markRead,
    dispose() {
      indicators.delete(refresh);
      if (typeof window !== "undefined") window.removeEventListener("storage", storageChanged);
    },
  };
}
