import { isNativePreview } from './native-preview';

export const AUTO_FARM_RESUME_KEY = 'wildstat:autofarm-resume:v1';
export type AutoFarmIntent = { identity: string; map: string; choice: string };

/** Web intent stays tab-local. Native intent must survive the WebView being
 * destroyed during an app upgrade; identity/map validation happens on restore.
 * Written only when starting/stopping, with no server or per-frame storage work. */
export function createAutoFarmResumeStore(storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = () => isNativePreview() ? localStorage : sessionStorage) {
  return {
    read(): AutoFarmIntent | null {
      try {
        const value = JSON.parse(storage().getItem(AUTO_FARM_RESUME_KEY) ?? 'null');
        return value && ['identity', 'map', 'choice'].every(key => typeof value[key] === 'string' && value[key].length > 0)
          ? { identity: value.identity, map: value.map, choice: value.choice } : null;
      } catch { return null; }
    },
    write(value: AutoFarmIntent) {
      try { storage().setItem(AUTO_FARM_RESUME_KEY, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ }
    },
    clear() {
      try { storage().removeItem(AUTO_FARM_RESUME_KEY); } catch { /* In-memory farming still works. */ }
    },
  };
}
