import { PATREON_PAGE } from '../../shared/avatar-frames';

/** Ordinary web links, with an in-app browser when the native bridge is present. */
export function createCommunityLinks(doc: Document) {
  const root = doc.createElement('div');
  root.id = 'settingsCommunityLinks'; root.className = 'setting-support community-links';
  const links = [
    { kind: 'discord', title: 'Join Discord', detail: 'Chat with the community', url: 'https://discord.gg/mcS226NbG4',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4a19.8 19.8 0 0 0-4.9-1.5l-.6 1.2a18.3 18.3 0 0 0-5.5 0l-.6-1.2a19.9 19.9 0 0 0-4.9 1.5C.7 9 .0 13.5.3 17.9a19.8 19.8 0 0 0 6 3l1.2-2a12.7 12.7 0 0 1-1.9-.9l.5-.4a14.1 14.1 0 0 0 11.8 0l.5.4a13.2 13.2 0 0 1-1.9.9l1.2 2a19.7 19.7 0 0 0 6-3c.5-5.1-.8-9.5-3.4-13.5ZM8 15.2c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm8 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z"/></svg>' },
    { kind: 'patreon', title: 'Support on Patreon', detail: 'Help build WildStat', url: PATREON_PAGE,
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21 3.5 12.6C-2 7.1 5.7.1 12 6.4 18.3.1 26 7.1 20.5 12.6Z"/></svg>' },
  ];
  for (const item of links) {
    const link = doc.createElement('a');
    link.className = `community-link community-link--${item.kind}`;
    link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${item.title} (opens in browser)`);
    link.innerHTML = `<span class="community-link-icon">${item.icon}</span><span class="community-link-copy"><strong>${item.title}</strong><small>${item.detail}</small></span><span class="community-link-arrow" aria-hidden="true">↗</span>`;
    link.addEventListener('click', event => {
      const native = (doc.defaultView as unknown as { wildstatOpenCommunity?: (url: string) => Promise<void> } | null)?.wildstatOpenCommunity;
      if (!native) return;
      event.preventDefault();
      void native(item.url).catch(() => { doc.defaultView?.open(item.url, '_blank', 'noopener,noreferrer'); });
    });
    root.append(link);
  }
  return root;
}
