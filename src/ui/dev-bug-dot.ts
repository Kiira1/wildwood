/** The newest bug report the developer has looked at on the Bugs tab, kept on this device. */
const SEEN_KEY = "wildstat-dev-bugs-seen";

/** Whether a bug report has come in since the developer last looked at the Bugs tab. */
export function hasUnseenBug(reports: readonly { reportedAtMs: number }[], seenAtMs: number) {
  return reports.some(report => report.reportedAtMs > seenAtMs);
}

/**
 * A red dot for the developer on the way to the Bugs tab (the Settings button, Open Tools, the tab itself) while a
 * bug report waits unseen. Looking at the Bugs tab clears it.
 */
export function createDevBugDot(deps: {
  targets: readonly HTMLElement[];
  reports: () => readonly { reportedAtMs: number }[];
  isDeveloper: () => boolean;
  storage?: Pick<Storage, "getItem" | "setItem">;
}) {
  const storage = deps.storage ?? (() => { try { return localStorage; } catch { return undefined; } })();
  let seen = 0;
  try { seen = Number(storage?.getItem(SEEN_KEY)) || 0; } catch { /* Shows every report as new. */ }
  const dots = deps.targets.map(target => {
    const dot = target.ownerDocument.createElement("span");
    dot.className = "dev-bug-dot";
    dot.hidden = true;
    dot.setAttribute("aria-hidden", "true");
    target.classList.add("has-dev-bug-dot");
    target.append(dot);
    return dot;
  });
  function render() {
    const show = deps.isDeveloper() && hasUnseenBug(deps.reports(), seen);
    for (const dot of dots) if (dot.hidden === show) dot.hidden = !show;
  }
  function markSeen() {
    seen = Math.max(seen, ...deps.reports().map(report => report.reportedAtMs));
    try { storage?.setItem(SEEN_KEY, String(seen)); } catch { /* Kept for this page only. */ }
    render();
  }
  render();
  return { render, markSeen };
}
