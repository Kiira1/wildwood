export type AndroidUpdate = { available: boolean; versionCode: number; installedVersionCode: number };
export type AndroidUpdateBridge = { check(): Promise<AndroidUpdate>; openStore(): Promise<void> };
export const ANDROID_UPDATE_CHECK_MS = 5 * 60_000;
const SNOOZE_MS = 8 * 60 * 60_000;
const SNOOZE_KEY = 'wildstat.android-update.snooze';

export function createAndroidUpdateController(options: {
  bridge: AndroidUpdateBridge; storage: Pick<Storage, 'getItem' | 'setItem'>;
  show: (versionCode: number | null) => void; now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let lastCheck = -Infinity, inFlight = false, disposed = false;
  let latest: number | null = null;
  let snooze = { versionCode: 0, until: 0 };
  try {
    const saved = JSON.parse(options.storage.getItem(SNOOZE_KEY) || 'null');
    if (Number.isSafeInteger(saved?.versionCode) && Number.isFinite(saved?.until)) snooze = saved;
  } catch {}
  async function check() {
    if (disposed || inFlight || now() - lastCheck < ANDROID_UPDATE_CHECK_MS) return;
    inFlight = true; lastCheck = now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([options.bridge.check(), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Update check timed out')), 15_000);
      })]);
      if (disposed) return;
      latest = result.available === true && Number.isSafeInteger(result.versionCode)
        && Number.isSafeInteger(result.installedVersionCode) && result.installedVersionCode > 0
        && result.versionCode > result.installedVersionCode ? result.versionCode : null;
      options.show(latest && (snooze.versionCode !== latest || snooze.until <= now()) ? latest : null);
    } catch { /* Offline, sideloaded, or Play unavailable: gameplay continues. */ }
    finally { clearTimeout(timeout); inFlight = false; }
  }
  function dismiss() {
    if (latest === null) return;
    snooze = { versionCode: latest, until: now() + SNOOZE_MS };
    try { options.storage.setItem(SNOOZE_KEY, JSON.stringify(snooze)); } catch {}
    options.show(null);
  }
  return { check, dismiss, openStore: () => options.bridge.openStore(), dispose: () => { disposed = true; } };
}
