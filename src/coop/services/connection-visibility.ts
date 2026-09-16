/** Context, not a claim about why a socket closed: keep close codes separately. */
export function createConnectionVisibility(now: () => number, initiallyHidden = false) {
  let hiddenAt: number | null = initiallyHidden ? now() : null;
  let visibleAt: number | null = null, lastHiddenForMs = 0;
  function hide() { hiddenAt ??= now(); }
  function show() {
    if (hiddenAt === null) return;
    lastHiddenForMs = Math.max(0, now() - hiddenAt);
    hiddenAt = null; visibleAt = now();
  }
  function snapshot() {
    const sinceVisibleMs = visibleAt === null ? 0 : Math.max(0, now() - visibleAt);
    const returning = visibleAt !== null && sinceVisibleMs < 30_000;
    return {
      activity: hiddenAt !== null ? "background" : returning ? "tab-return" : "foreground",
      hiddenForMs: hiddenAt !== null ? Math.max(0, now() - hiddenAt) : returning ? lastHiddenForMs : 0,
      sinceVisibleMs,
    };
  }
  return { hide, show, snapshot };
}
