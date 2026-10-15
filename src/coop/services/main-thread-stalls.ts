/**
 * How long the page's main thread was blocked between two moments, from the
 * browser's long-task entries (50 ms or more). A reducer's reply waits for the
 * main thread, so a slow round trip with a matching stall was this device, not
 * the network or the server. Null where the browser has no long-task timing (Safari).
 */
export function createMainThreadStalls(keepMs = 15_000, now = () => performance.now()) {
  let tasks: { start: number; end: number }[] = [];
  let supported = false;
  try {
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, end: entry.startTime + entry.duration });
        const since = now() - keepMs;
        if (tasks.length && tasks[0].end < since) tasks = tasks.filter(task => task.end >= since);
      }).observe({ type: "longtask", buffered: false });
      supported = true;
    }
  } catch { supported = false; }

  return {
    blockedMs(from: number, to: number): number | null {
      if (!supported) return null;
      let blocked = 0;
      for (const task of tasks) blocked += Math.max(0, Math.min(to, task.end) - Math.max(from, task.start));
      return Math.round(blocked);
    },
    /** For tests: a long task the observer would have seen. */
    note(start: number, duration: number) { supported = true; tasks.push({ start, end: start + duration }); },
  };
}
