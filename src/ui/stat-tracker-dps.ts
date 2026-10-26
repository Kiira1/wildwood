import { playerDps, DAMAGE_SOURCE_NAMES, DPS_BREAKDOWN_WINDOW_MS } from '../game/runtime/dps-meter';
import { formatCompactNumber } from './number-format';
import { setText } from './dom-write';

/** Optional alternate view of the existing meter; no additional sampling or timer. */
export function installStatTrackerDps(panel: HTMLElement, settings: HTMLElement, storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let shownSources = '';
  const switchKey = 'wildstat-stat-tracker-dps-switch';
  const viewKey = 'wildstat-stat-tracker-dps-view';
  let showSwitch = false, dpsView = false;
  try { showSwitch = storage.getItem(switchKey) === 'true'; dpsView = storage.getItem(viewKey) === 'true'; } catch {}
  const switchLabel = document.createElement('label');
  switchLabel.className = 'stat-tracker-compact-option';
  const switchCheckbox = document.createElement('input');
  switchCheckbox.type = 'checkbox';
  switchCheckbox.checked = showSwitch;
  switchLabel.append(switchCheckbox, 'DPS switch');
  const compactLabel = settings.querySelector('.stat-tracker-compact-option')!;
  const modes = document.createElement('div');
  modes.className = 'stat-tracker-mode-options';
  compactLabel.before(modes);
  modes.append(compactLabel, switchLabel);
  const switchButton = document.createElement('button');
  switchButton.type = 'button';
  switchButton.className = 'stat-tracker-view-switch';
  switchButton.textContent = '⇄';
  panel.querySelector('.stat-tracker-handle')!.before(switchButton);
  const stats = panel.querySelector('table')!;
  const section = document.createElement('section');
  section.className = 'stat-tracker-dps';
  section.hidden = true;
  const button = document.createElement('div');
  button.className = 'stat-tracker-dps-toggle';
  const title = document.createElement('span');
  const total = document.createElement('span');
  button.append(title, total);
  const details = document.createElement('div');
  details.className = 'stat-tracker-dps-details';
  details.hidden = true;
  const empty = document.createElement('p');
  empty.textContent = 'Hit something to see where your damage comes from.';
  const list = document.createElement('dl');
  const footnote = document.createElement('p');
  footnote.textContent = `Last ${DPS_BREAKDOWN_WINDOW_MS / 1000}s`;
  details.append(list, empty, footnote);
  section.append(button, details);
  panel.querySelector('footer')!.before(section);
  function refresh() {
    const collapsed = panel.classList.contains('is-collapsed');
    const swapping = showSwitch && dpsView;
    const handle = panel.querySelector<HTMLButtonElement>('.stat-tracker-handle')!;
    const name = swapping ? 'DPS' : panel.classList.contains('is-compact') && !collapsed ? 'Stats' : 'Stat tracker';
    setText(handle, `${name} ${collapsed ? '▸' : '▾'}`);
    panel.classList.toggle('is-dps-view', swapping);
    switchButton.hidden = !showSwitch || collapsed;
    switchButton.title = swapping ? 'Stat Tracker' : 'DPS Breakdown';
    switchButton.setAttribute('aria-label', `Show ${switchButton.title}`);
    switchButton.setAttribute('aria-pressed', String(swapping));
    stats.hidden = collapsed || swapping;
    section.hidden = collapsed || !swapping;
    details.hidden = !swapping;
    setText(title, 'DPS Breakdown');
    if (section.hidden || panel.hidden) return;
    const rows = playerDps.breakdown();
    const sum = rows.reduce((value, row) => value + row.perSecond, 0);
    setText(total, formatCompactNumber(sum));
    empty.hidden = rows.length > 0;
    list.hidden = footnote.hidden = rows.length === 0;
    const sources = rows.map(row => row.source).join();
    if (shownSources !== sources) {
      shownSources = sources;
      list.replaceChildren();
      for (const text of ['Source', 'DPS', 'Share']) {
        const heading = document.createElement('div'); heading.className = 'stat-tracker-dps-heading'; heading.textContent = text; list.append(heading);
      }
      for (const row of rows) {
        const line = document.createElement('div');
        line.className = 'stat-tracker-dps-row';
        const name = document.createElement('dt'); name.textContent = DAMAGE_SOURCE_NAMES[row.source];
        line.append(name, document.createElement('dd'), document.createElement('dd'));
        list.append(line);
      }
    }
    rows.forEach((row, index) => {
      const line = list.children[3 + index] as HTMLElement;
      const share = sum > 0 ? row.perSecond / sum : 0;
      setText(line.children[1], formatCompactNumber(row.perSecond));
      setText(line.children[2], `${Math.round(share * 100)}%`);
      line.style.setProperty('--share', `${share * 100}%`);
    });
  }
  function paint() {
    window.dispatchEvent(new window.CustomEvent('stat-tracker-dps-change', { detail: showSwitch }));
    refresh();
  }
  switchButton.addEventListener('click', () => {
    dpsView = !dpsView;
    try { storage.setItem(viewKey, String(dpsView)); } catch {}
    paint();
  });
  switchCheckbox.addEventListener('change', () => {
    showSwitch = switchCheckbox.checked;
    try { storage.setItem(switchKey, String(showSwitch)); } catch {}
    paint();
  });
  paint();
  return { refresh, resetVisibleView() {
    if (!showSwitch || !dpsView) return false;
    playerDps.resetBreakdown();
    refresh();
    return true;
  } };
}
