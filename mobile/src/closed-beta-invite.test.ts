import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { ANDROID_BETA_GROUP_URL, ANDROID_BETA_TEST_URL, ANDROID_INTERNAL_TEST_URL, CLOSED_BETA_INVITE_KEY, installClosedBetaInvite, rememberClosedBetaJoin, shouldShowClosedBetaInvite } from './closed-beta-invite';

const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mountInvite(openStore = vi.fn(async () => {}), storage = memory()) {
  vi.useFakeTimers();
  const { document } = parseHTML('<html><head></head><body></body></html>');
  vi.stubGlobal('document', document);
  installClosedBetaInvite(openStore, storage);
  await vi.advanceTimersByTimeAsync(4_000);
  const click = async (selector: string) => {
    document.querySelector<HTMLButtonElement>(selector)!.click();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { document, storage, openStore, click };
}

describe('closed beta invite', () => {
  it('asks until the tester explicitly confirms joining', () => {
    const storage = memory();
    expect(shouldShowClosedBetaInvite(storage)).toBe(true);
    rememberClosedBetaJoin(storage);
    expect(shouldShowClosedBetaInvite(storage)).toBe(false);
  });

  it('shows corrected instructions to testers whose old invite only opened Play', () => {
    const storage = memory();
    storage.setItem(CLOSED_BETA_INVITE_KEY, 'joined');
    expect(shouldShowClosedBetaInvite(storage)).toBe(true);
  });

  it('keeps the instructions and future reminder after opening Play, and allows reopening', async () => {
    const f = await mountInvite();
    await f.click('.closed-beta-join');
    expect(f.openStore).toHaveBeenCalledTimes(1);
    expect(f.openStore).toHaveBeenLastCalledWith(ANDROID_BETA_TEST_URL);
    expect(f.document.querySelector('#closedBetaInvite')).not.toBeNull();
    expect(shouldShowClosedBetaInvite(f.storage)).toBe(true);
    await f.click('.closed-beta-join');
    expect(f.openStore).toHaveBeenCalledTimes(2);
    await f.click('.closed-beta-confirm');
    expect(f.document.querySelector('#closedBetaInvite')).toBeNull();
    expect(shouldShowClosedBetaInvite(f.storage)).toBe(false);
  });

  it('does not mark Later as a completed switch', async () => {
    const f = await mountInvite();
    await f.click('.closed-beta-later');
    expect(f.document.querySelector('#closedBetaInvite')).toBeNull();
    expect(shouldShowClosedBetaInvite(f.storage)).toBe(true);
    expect(f.openStore).not.toHaveBeenCalled();
  });

  it('opens group membership and internal opt-out separately without confirming enrollment', async () => {
    const f = await mountInvite();
    await f.click('.closed-beta-group');
    expect(f.openStore).toHaveBeenLastCalledWith(ANDROID_BETA_GROUP_URL);
    expect(shouldShowClosedBetaInvite(f.storage)).toBe(true);
    await f.click('.closed-beta-internal');
    expect(f.openStore).toHaveBeenLastCalledWith(ANDROID_INTERNAL_TEST_URL);
    expect(shouldShowClosedBetaInvite(f.storage)).toBe(true);
    expect(f.document.querySelector('#closedBetaInvite')).not.toBeNull();
  });

  it('allows retrying a failed Play launch without losing the reminder', async () => {
    const openStore = vi.fn(async () => {}).mockRejectedValueOnce(new Error('unavailable'));
    const f = await mountInvite(openStore);
    await f.click('.closed-beta-join');
    expect(f.document.querySelector('.closed-beta-status')!.textContent).toContain('Could not open Google Play');
    expect(shouldShowClosedBetaInvite(f.storage)).toBe(true);
    await f.click('.closed-beta-join');
    expect(openStore).toHaveBeenCalledTimes(2);
    expect(f.document.querySelector('.closed-beta-status')!.textContent).toContain('After joining');
  });

  it('stays quiet in builds with the invite switched off', () => {
    expect(shouldShowClosedBetaInvite(memory(), false)).toBe(false);
  });

  it('still asks when storage is unavailable', () => {
    expect(shouldShowClosedBetaInvite({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} })).toBe(true);
  });
});
