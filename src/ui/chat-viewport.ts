/** Variable-height window: only nearby rows own DOM, portraits and glow effects.
 * Text history stays independent; measured heights preserve the scroll anchor. */
export function createChatViewport() {
  let ids: bigint[] = [], offsets = [0], width = 0;
  let renderedStart = 0, renderedEnd = 0;
  const heights = new Map<bigint, number>();
  const rebuild = () => { offsets = [0]; for (const id of ids) offsets.push(offsets[offsets.length - 1] + (heights.get(id) ?? 100)); };
  function select(next: readonly { id: bigint }[], nextWidth: number) {
    if (width && nextWidth && Math.abs(width - nextWidth) > 1) heights.clear();
    width = nextWidth;
    ids = next.map(row => row.id);
    const keep = new Set(ids);
    for (const id of heights.keys()) if (!keep.has(id)) heights.delete(id);
    rebuild();
  }
  function indexAt(top: number) {
    let low = 0, high = ids.length;
    while (low < high) { const mid = (low + high) >>> 1; if (offsets[mid + 1] <= top) low = mid + 1; else high = mid; }
    return Math.min(Math.max(0, ids.length - 1), low);
  }
  function range(top: number, height: number, latest = false) {
    if (latest) top = Math.max(0, offsets[ids.length] - height);
    const first = indexAt(top), last = indexAt(top + Math.max(1, height));
    const start = Math.max(0, first - 6), end = Math.min(ids.length, Math.max(start + 1, last + 7), start + 60);
    return { start, end, top: offsets[start], bottom: offsets[ids.length] - offsets[end] };
  }
  function window(top: number, height: number, latest = false) {
    const result = range(top, height, latest);
    renderedStart = result.start; renderedEnd = result.end;
    return result;
  }
  return {
    select, window,
    needsRender(top: number, height: number) {
      if (!ids.length) return false;
      if (renderedEnd <= renderedStart) return true;
      // Consume the overscan before shifting the window. Recentring it at
      // every row boundary churns DOM/layout throughout a touch scroll.
      const first = indexAt(top), last = indexAt(top + Math.max(1, height));
      return (renderedStart > 0 && first < renderedStart + 2)
        || (renderedEnd < ids.length && last >= renderedEnd - 2);
    },
    anchor(top: number) { const index = indexAt(top); return { id: ids[index], offset: top - offsets[index] }; },
    restore(anchor: { id: bigint | undefined; offset: number }, fallback: number) { const index = ids.indexOf(anchor.id!); return index < 0 ? fallback : offsets[index] + anchor.offset; },
    measure(rows: readonly { id: bigint; height: number }[]) {
      let changed = false;
      for (const row of rows) if (row.height > 0 && heights.get(row.id) !== row.height) { heights.set(row.id, row.height); changed = true; }
      if (changed) rebuild();
      return { top: offsets[renderedStart], bottom: offsets[ids.length] - offsets[renderedEnd] };
    },
    reset() { ids = []; offsets = [0]; heights.clear(); renderedStart = renderedEnd = 0; },
  };
}
