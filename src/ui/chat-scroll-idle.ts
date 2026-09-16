/** History can arrive mid-swipe. Commit it only after touch and momentum finish. */
export function createChatScrollIdle() {
  const quietMs = 160;
  let touched = false, lastActivity = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waiting = new Set<() => void>();
  function check() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!waiting.size || touched) return;
    const remaining = quietMs - (performance.now() - lastActivity);
    if (remaining > 0) { timer = setTimeout(check, remaining); return; }
    const ready = [...waiting];
    waiting.clear();
    for (const resolve of ready) resolve();
  }
  function activity() { lastActivity = performance.now(); check(); }
  return {
    activity,
    active: () => touched || performance.now() - lastActivity < quietMs,
    touchStart() { touched = true; activity(); },
    touchEnd() { touched = false; activity(); },
    wait: () => new Promise<void>(resolve => { waiting.add(resolve); check(); }),
    reset() { touched = false; lastActivity = -Infinity; check(); },
  };
}
