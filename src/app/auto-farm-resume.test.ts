import { afterEach, expect, it, vi } from 'vitest';
import { createAutoFarmResumeStore } from './auto-farm-resume';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
const intent = { identity: 'player', map: 'desert', choice: 'Scorpion' };
afterEach(() => vi.unstubAllGlobals());

it('retains native farming through a new WebView session and clears it on stop/sign-out', () => {
  vi.stubGlobal('window', { WILDSTAT_NATIVE_PREVIEW: true });
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  createAutoFarmResumeStore().write(intent);
  vi.stubGlobal('sessionStorage', storage());
  expect(createAutoFarmResumeStore().read()).toEqual(intent);
  createAutoFarmResumeStore().clear();
  expect(createAutoFarmResumeStore().read()).toBeNull();
});

it('keeps web farming isolated to its browser tab', () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  createAutoFarmResumeStore().write(intent);
  expect(createAutoFarmResumeStore().read()).toEqual(intent);
  vi.stubGlobal('sessionStorage', storage());
  expect(createAutoFarmResumeStore().read()).toBeNull();
});
