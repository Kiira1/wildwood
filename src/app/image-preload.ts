/** Decode only needed sheets, once. A missing/slow image must not hold chat. */
export function createImagePreloader() {
  const sheets = new Map<string, { image: HTMLImageElement; ready: Promise<void> }>();
  return async (paths: readonly string[]) => {
    if (typeof Image === "undefined") return;
    await Promise.all([...new Set(paths)].map(path => {
      const cached = sheets.get(path);
      if (cached) return cached.ready;
      const image = new Image();
      const pending = new Promise<void>(resolve => {
        let finished = false;
        const done = (ok: boolean) => {
          if (finished) return;
          finished = true; clearTimeout(deadline);
          image.onload = image.onerror = null;
          if (!ok) sheets.delete(path);
          resolve();
        };
        const deadline = setTimeout(() => done(false), 1500);
        image.onerror = () => done(false);
        image.onload = () => {
          if (image.decode) void image.decode().then(() => done(true), () => done(false));
          else done(true);
        };
      });
      sheets.set(path, { image, ready: pending });
      image.src = path;
      return pending;
    }));
  };
}

export const preloadImages = createImagePreloader();
