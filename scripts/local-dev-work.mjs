/** Coalesce saves and serialize publish/build work, including edits during a build. */
export function createLocalDevWork({ run, reportError, delay = 250 }) {
  const pending = new Set();
  let running = false, closed = false, timer;
  async function flush() {
    if (running || closed || !pending.size) return;
    running = true;
    const changes = new Set(pending);
    pending.clear();
    try { await run(changes); }
    catch (error) { reportError(error); }
    finally {
      running = false;
      if (pending.size && !closed) timer = setTimeout(flush, delay);
    }
  }
  return {
    add(kind) {
      if (!kind || closed) return;
      pending.add(kind);
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    close() { closed = true; clearTimeout(timer); pending.clear(); },
  };
}

export function localChangeKind(path) {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes('/dist/')) return null;
  if (path.startsWith('spacetimedb/src/') || path.startsWith('shared/')) return 'server';
  if (path.startsWith('src/') || /^config\/vite\.(coop|game)\.config\.ts$/.test(path)) return 'client';
  if (path.startsWith('public/')) return path.endsWith('.css') ? 'style' : 'page';
  return null;
}
