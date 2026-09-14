import { expect, it, vi } from 'vitest';
import type { DbConnection } from '../../module_bindings';
import { TERMS_VERSION, AGE_BAND_ADULT } from '../../../shared/legal';
import { createLegalConsentService } from './legal-consent-service';
import { enterWorldAfterConsent } from './world-entry-consent';
function connection() { return { isActive: true, reducers: { acceptTerms: vi.fn(async () => {}), enterWorld: vi.fn(async () => {}) } }; }
function fixture(accepted = true) {
  const first = connection(); let current = first;
  const storage = new Map(accepted ? [['legal', JSON.stringify({ termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT })]] : []);
  const request = vi.fn(async () => true);
  const service = createLegalConsentService({ storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } },
    storageKey: 'legal', connection: () => current as unknown as DbConnection, protocolReady: () => true,
    shouldEnterWorld: () => true, requestWorldEntry: request, notify: vi.fn(), handleFailure: vi.fn() });
  const enter = (c = current) => enterWorldAfterConsent(c as unknown as DbConnection, 'test-tab', service.syncConnection, () => c === current);
  return { first, service, request, enter, replace: () => { current = connection(); return current; } };
}
it('never sends enter_world before explicit acceptance', async () => {
  const f = fixture(false);
  await expect(f.enter()).rejects.toThrow('Terms');
  expect(f.first.reducers.acceptTerms).not.toHaveBeenCalled();
  expect(f.first.reducers.enterWorld).not.toHaveBeenCalled();
});
it('waits for a shared acceptance request, then reuses its successful result on the same connection', async () => {
  const f = fixture(); let done!: () => void;
  f.first.reducers.acceptTerms.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const sync = f.service.syncConnection(f.first as unknown as DbConnection), entering = f.enter();
  await Promise.resolve();
  expect(f.first.reducers.enterWorld).not.toHaveBeenCalled();
  done(); await sync; await entering; await f.enter();
  expect(f.first.reducers.acceptTerms).toHaveBeenCalledTimes(1);
  expect(f.first.reducers.enterWorld).toHaveBeenCalledTimes(2);
});
it('does not enter after failed acceptance and allows a later successful retry', async () => {
  const f = fixture(); f.first.reducers.acceptTerms.mockRejectedValueOnce(new Error('offline'));
  await expect(f.enter()).rejects.toThrow('Terms');
  expect(f.first.reducers.enterWorld).not.toHaveBeenCalled();
  await f.enter(); expect(f.first.reducers.enterWorld).toHaveBeenCalledTimes(1);
});
it('does not enter a departed connection and saves acceptance again on its replacement', async () => {
  const f = fixture(); let done!: () => void;
  f.first.reducers.acceptTerms.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const entering = f.enter(); await Promise.resolve(); const next = f.replace();
  done(); await expect(entering).rejects.toThrow();
  expect(f.first.reducers.enterWorld).not.toHaveBeenCalled();
  await f.enter(); expect(next.reducers.acceptTerms).toHaveBeenCalledTimes(1);
  expect(next.reducers.enterWorld).toHaveBeenCalledTimes(1);
});
it('retains accepted consent when world entry fails and exposes it to the entry barrier immediately', async () => {
  const f = fixture(false); f.request.mockImplementation(async () => { expect(f.service.accepted()).toBe(true); await f.enter(); return false; });
  await expect(f.service.acceptAge(22)).resolves.toMatchObject({ ok: false });
  expect(f.service.accepted()).toBe(true);
  expect(f.first.reducers.acceptTerms).toHaveBeenCalledTimes(1);
  expect(f.first.reducers.enterWorld).toHaveBeenCalledTimes(1);
});
