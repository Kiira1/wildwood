import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createGemShopController } from './gem-shop-controller';

afterEach(() => vi.unstubAllGlobals());
it.each([false, true])('connects the character before checkout unless already linked (%s)', async linked => {
  const { document, window } = parseHTML('<html><body><button>Shop</button></body></html>');
  const replace = vi.fn(), close = vi.fn();
  Object.assign(window, { open: vi.fn(() => ({ location: { replace }, close, opener: {} })) });
  vi.stubGlobal('document', document); vi.stubGlobal('window', window);
  const beginPatreonLink = vi.fn(async () => 'https://www.patreon.com/oauth2/authorize?state=test');
  createGemShopController({ button: document.querySelector('button')!, setOpen: vi.fn(), supporter: {
    patreonStatus: vi.fn(async () => ({ configured: true, linked, tier: 'none' as const, frame: 'none' as const, validUntilMs: 0 })), beginPatreonLink,
  } });
  document.querySelector('.shop-patreon-button')!.dispatchEvent(new window.Event('click', { cancelable: true }));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(beginPatreonLink).toHaveBeenCalledTimes(linked ? 0 : 1);
  expect(replace).toHaveBeenCalledWith(linked ? 'https://www.patreon.com/c/wildstat/membership' : 'https://www.patreon.com/oauth2/authorize?state=test');
  expect(close).not.toHaveBeenCalled();
});
it.each([false, true])('shows the Patreon support link only on web (native=%s)', native => {
  const { document, window } = parseHTML('<html><body><button id="shop">Shop</button></body></html>');
  vi.stubGlobal('WILDSTAT_NATIVE_PREVIEW', native);
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  createGemShopController({ button: document.querySelector('button')!, setOpen: vi.fn() });
  const link = document.querySelector<HTMLAnchorElement>('.shop-patreon-button');
  expect(Boolean(link)).toBe(!native);
  expect(document.querySelectorAll('.gem-shop-pack').length).toBe(native ? 4 : 0);
  if (link) {
    expect(link.href).toBe('https://www.patreon.com/c/wildstat/membership');
    expect(link.textContent).toContain('development and server costs');
    expect(link.rel).toBe('noopener noreferrer');
  }
});
it('hides gem packs and purchase messaging on web, even if a test bridge exists', () => {
  const { document, window } = parseHTML('<html><body><button id="shop">Shop</button></body></html>');
  const load = vi.fn(), buy = vi.fn();
  Object.assign(window, { wildstatTestPurchases: { mode: 'test', load, buy } });
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  const controller = createGemShopController({ button: document.querySelector('button')!, setOpen: vi.fn() });
  const dialog = document.querySelector('dialog')!;
  Object.assign(dialog, { show() { dialog.open = true; } });
  controller.open();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.gem-shop-pack button')];
  expect(buttons).toHaveLength(0);
  expect(document.getElementById('gemShopLimit')).toBeNull();
  expect(dialog.hasAttribute('aria-describedby')).toBe(false);
  buttons.forEach(button => button.dispatchEvent(new window.Event('click')));
  expect(load).not.toHaveBeenCalled(); expect(buy).not.toHaveBeenCalled();
  expect(document.querySelector('.gem-shop-notice')).toBeNull();
});

it('opens without blocking the toolbar and closes when another toolbar window is chosen', () => {
  const { document, window } = parseHTML('<html><body><div class="settings-wrap"><button id="shop">Shop</button><button id="inventory">Inventory</button></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  const setOpen = vi.fn();
  const controller = createGemShopController({ button: document.querySelector<HTMLButtonElement>('#shop')!, setOpen });
  const dialog = document.querySelector('dialog')!;
  const show = vi.fn(() => { dialog.open = true; });
  const showModal = vi.fn();
  Object.assign(dialog, { show, showModal, close() { dialog.open = false; dialog.dispatchEvent(new window.Event('close')); } });
  controller.open();
  expect(show).toHaveBeenCalledOnce();
  expect(showModal).not.toHaveBeenCalled();
  expect(document.getElementById('shop')!.getAttribute('aria-expanded')).toBe('true');
  document.getElementById('inventory')!.dispatchEvent(new window.Event('click', { bubbles: true }));
  expect(controller.isOpen()).toBe(false);
  expect(setOpen).toHaveBeenLastCalledWith(false);
  expect(document.getElementById('shop')!.getAttribute('aria-expanded')).toBe('false');
});
