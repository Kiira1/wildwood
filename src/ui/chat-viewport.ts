/** Variable-height window: only nearby rows own DOM, portraits and glow effects.
 * Text history stays independent; measured heights preserve the scroll anchor. */
const OVERSCAN = 1.5, MAX_ROWS = 60;

export function createChatViewport() {
  let ids: bigint[] = [], offsets = [0], width = 0;
  let renderedStart = 0, renderedEnd = 0;
  let origin = 0;
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
    top -= origin;
    let low = 0, high = ids.length;
    while (low < high) { const mid = (low + high) >>> 1; if (offsets[mid + 1] <= top) low = mid + 1; else high = mid; }
    return Math.min(Math.max(0, ids.length - 1), low);
  }
  function range(top: number, height: number, latest = false) {
    if (latest) top = Math.max(0, offsets[ids.length] + origin - height);
    height = Math.max(1, height);
    const first = indexAt(top), last = indexAt(top + height);
    // About a screen and a half each side: rows are built and their portraits
    // decoded well before they scroll in, and a fling re-windows once a screen.
    let start = Math.max(0, Math.min(first - 6, indexAt(top - height * OVERSCAN)));
    let end = Math.min(ids.length, Math.max(start + 1, last + 7, indexAt(top + height * (1 + OVERSCAN)) + 1));
    if (end - start > MAX_ROWS) {
      start = Math.max(start, first - Math.max(0, Math.floor((MAX_ROWS - (last + 1 - first)) / 2)));
      end = Math.min(end, start + MAX_ROWS);
    }
    return { start, end, top: offsets[start] + origin, bottom: offsets[ids.length] - offsets[end] };
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
      // Consume the overscan until half a screen is left, then shift the
      // window. Recentring it at every row boundary churns DOM and layout.
      height = Math.max(1, height);
      return (renderedStart > 0 && top - offsets[renderedStart] - origin < height / 2)
        || (renderedEnd < ids.length && offsets[renderedEnd] + origin - top - height < height / 2);
    },
    /** How many rows sit above this scroll position. */
    rowsAbove: (top: number) => indexAt(top),
    anchor(top: number) { const index = indexAt(top); return { id: ids[index], offset: top - offsets[index] - origin }; },
    restore(anchor: { id: bigint | undefined; offset: number }, fallback: number) { const index = ids.indexOf(anchor.id!); return index < 0 ? fallback : offsets[index] + anchor.offset + origin; },
    // Absorb newly measured heights in the offscreen spacer during momentum,
    // instead of assigning scrollTop (which cancels native scrolling on iOS).
    preserve(anchor: { id: bigint | undefined; offset: number }, top: number) {
      const index = ids.indexOf(anchor.id!);
      if (index >= 0) origin = top - offsets[index] - anchor.offset;
      return { top: offsets[renderedStart] + origin, bottom: offsets[ids.length] - offsets[renderedEnd] };
    },
    shifted: () => origin !== 0,
    settle() { origin = 0; },
    measure(rows: readonly { id: bigint; height: number }[]) {
      let changed = false;
      for (const row of rows) if (row.height > 0 && heights.get(row.id) !== row.height) { heights.set(row.id, row.height); changed = true; }
      if (changed) rebuild();
      return { top: offsets[renderedStart] + origin, bottom: offsets[ids.length] - offsets[renderedEnd] };
    },
    reset() { ids = []; offsets = [0]; heights.clear(); renderedStart = renderedEnd = 0; origin = 0; },
  };
}
