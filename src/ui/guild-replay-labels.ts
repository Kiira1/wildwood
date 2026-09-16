/** Reuse outlined text instead of rasterizing 80 names/HP labels at 60 Hz.
 * One canvas per label; changing health replaces its pixels rather than growing
 * a cache for every historical HP value. Owned and released by one replay. */
export function createGuildReplayLabels(doc: Document) {
  const entries = new Map<string, { canvas: HTMLCanvasElement; key: string }>();
  return {
    draw(ctx: CanvasRenderingContext2D, id: string, text: string, x: number, y: number,
      maxWidth: number, fontSize: number, outline: number, ratio: number) {
      const key = `${text}|${maxWidth}|${fontSize}|${outline}|${ratio}`;
      let entry = entries.get(id);
      if (!entry) {
        entry = { canvas: doc.createElement("canvas"), key: "" };
        entries.set(id, entry);
      }
      const width = maxWidth + 10, height = fontSize * 2 + 10;
      if (entry.key !== key) {
        const canvas = entry.canvas;
        canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio);
        const label = canvas.getContext("2d");
        if (!label) return;
        label.setTransform(ratio, 0, 0, ratio, 0, 0);
        label.font = `900 ${fontSize}px "Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif`;
        label.textAlign = "center"; label.textBaseline = "middle"; label.lineJoin = "round";
        label.strokeStyle = "#000"; label.fillStyle = "#fff"; label.lineWidth = outline;
        label.strokeText(text, width / 2, height / 2, maxWidth);
        label.fillText(text, width / 2, height / 2, maxWidth);
        entry.key = key;
      }
      ctx.drawImage(entry.canvas, x - width / 2, y - height / 2, width, height);
    },
    dispose() {
      for (const { canvas } of entries.values()) { canvas.width = 0; canvas.height = 0; }
      entries.clear();
    },
  };
}
