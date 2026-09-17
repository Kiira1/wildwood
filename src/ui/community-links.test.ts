import { expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createCommunityLinks } from './community-links';

it('keeps both community links available in the native app and opens its browser', async () => {
  const { document, window } = parseHTML('<html><body></body></html>');
  const open = vi.fn(async () => {});
  Object.assign(window, { WILDSTAT_NATIVE_PREVIEW: true, wildstatOpenCommunity: open });
  const root = createCommunityLinks(document);
  const links = root.querySelectorAll('a');
  expect(links).toHaveLength(2);
  for (const link of links) {
    const click = new window.Event('click', { cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(open).toHaveBeenLastCalledWith(link.href);
  }
  delete (window as any).wildstatOpenCommunity;
  delete (window as any).WILDSTAT_NATIVE_PREVIEW;
});
