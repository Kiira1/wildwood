export type ScreenLock = {
  release: () => Promise<void>;
  released?: boolean;
  addEventListener?: (type: "release", listener: () => void) => void;
};
export type NativeScreenWakeLock = {
  active: boolean;
  request: () => Promise<ScreenLock>;
};
export const SCREEN_ACTIVITY_EVENT = "wildstat:screen-activity";

/** Serialize acquisition/release so a late request cannot leave an unwanted lock. */
export function createScreenWakeLock(request: () => Promise<ScreenLock>, changed: (active: boolean, failed: boolean) => void) {
  let enabled = false;
  let visible = true;
  let lock: ScreenLock | null = null;
  let pending: Promise<void> | null = null;
  let revision = 0;

  function sync(): Promise<void> {
    if (pending) return pending;
    const version = revision;
    const wanted = enabled && visible;
    if (wanted === Boolean(lock)) return Promise.resolve();
    pending = (async () => {
      try {
        if (wanted) {
          const acquired = await request();
          lock = acquired;
          acquired.addEventListener?.("release", () => {
            if (lock !== acquired) return;
            lock = null;
            changed(false, false);
            // Respect an OS release; retry on foreground or user interaction.
          });
          if (acquired.released) lock = null;
        } else if (lock) {
          const previous = lock;
          await previous.release();
          if (lock === previous) lock = null;
        }
        changed(Boolean(lock), false);
      } catch {
        changed(Boolean(lock), true);
      }
    })().finally(() => {
      pending = null;
      if (revision !== version) void sync();
    });
    return pending;
  }
  return {
    setEnabled(value: boolean) { enabled = value; revision++; return sync(); },
    setVisible(value: boolean) { visible = value; revision++; return sync(); },
    retry: sync,
  };
}
