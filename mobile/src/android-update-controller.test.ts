import { afterEach, expect, it, vi } from 'vitest';
import { ANDROID_UPDATE_CHECK_MS, createAndroidUpdateController } from './android-update-controller';
function fixture(values = new Map<string, string>()) {
  const bridge = { check: vi.fn(async () => ({ available: true, versionCode: 672, installedVersionCode: 671 })), openStore: vi.fn(async () => {}) };
  const show = vi.fn();
  const controller = createAndroidUpdateController({ bridge, show, storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } } });
  return { bridge, show, controller, values };
}
afterEach(() => vi.useRealTimers());
it('shows only a newer build that Google Play says is available to this tester', async () => {
  vi.useFakeTimers(); const f = fixture();
  for (const result of [
    { available: false, versionCode: 672, installedVersionCode: 671 },
    { available: true, versionCode: 671, installedVersionCode: 671 },
    { available: true, versionCode: 670, installedVersionCode: 671 },
    { available: true, versionCode: NaN, installedVersionCode: 671 },
  ]) {
    f.bridge.check.mockResolvedValueOnce(result); await f.controller.check();
    expect(f.show).toHaveBeenLastCalledWith(null); vi.advanceTimersByTime(ANDROID_UPDATE_CHECK_MS);
  }
  await f.controller.check(); expect(f.show).toHaveBeenLastCalledWith(672);
});
it('throttles checks and keeps Later dismissed across restarts for eight hours', async () => {
  vi.useFakeTimers(); const f = fixture(); await f.controller.check(); await f.controller.check();
  expect(f.bridge.check).toHaveBeenCalledTimes(1); f.controller.dismiss();
  expect(f.show).toHaveBeenLastCalledWith(null);
  const next = fixture(f.values); await next.controller.check(); expect(next.show).toHaveBeenLastCalledWith(null);
  vi.advanceTimersByTime(8 * 3600_000); await next.controller.check(); expect(next.show).toHaveBeenLastCalledWith(672);
});
it('shows a newer update even if a previous build was dismissed', async () => {
  vi.useFakeTimers(); const f = fixture(); await f.controller.check(); f.controller.dismiss();
  vi.advanceTimersByTime(ANDROID_UPDATE_CHECK_MS);
  f.bridge.check.mockResolvedValue({ available: true, versionCode: 673, installedVersionCode: 671 });
  await f.controller.check(); expect(f.show).toHaveBeenLastCalledWith(673);
});
it('handles offline checks and hung requests without affecting gameplay or locking future checks', async () => {
  vi.useFakeTimers(); const f = fixture(); f.bridge.check.mockRejectedValueOnce(new Error('offline'));
  await f.controller.check(); expect(f.show).not.toHaveBeenCalled();
  vi.advanceTimersByTime(ANDROID_UPDATE_CHECK_MS); f.bridge.check.mockImplementationOnce(() => new Promise(() => {}));
  const check = f.controller.check(); await f.controller.check(); await vi.advanceTimersByTimeAsync(15_000); await check;
  vi.advanceTimersByTime(ANDROID_UPDATE_CHECK_MS); await f.controller.check(); expect(f.show).toHaveBeenLastCalledWith(672);
});
it('opens Google Play only on request and keeps failure retryable', async () => {
  const f = fixture(); await f.controller.check(); expect(f.bridge.openStore).not.toHaveBeenCalled();
  f.bridge.openStore.mockRejectedValueOnce(new Error('missing')); await expect(f.controller.openStore()).rejects.toThrow('missing');
  await f.controller.openStore(); expect(f.bridge.openStore).toHaveBeenCalledTimes(2);
});
it('ignores a late result after disposal', async () => {
  const f = fixture(); let done!: (value: { available: boolean; versionCode: number; installedVersionCode: number }) => void;
  f.bridge.check.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const check = f.controller.check(); f.controller.dispose(); done({ available: true, versionCode: 672, installedVersionCode: 671 });
  await check; expect(f.show).not.toHaveBeenCalled();
});
