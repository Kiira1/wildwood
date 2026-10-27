import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { installStatTracker } from './stat-tracker';
import { TRACKED_STATS, type TrackerValues } from './stat-tracker-model';
import { attackCapInterval, attackSpeedLabel, critDamageLabel } from '../../shared/stat-rating';
import { criticalDamage, type CriticalDamageParts } from '../../shared/critical-damage';
import { playerDps, statTrackerDps } from '../game/runtime/dps-meter';
import { installDpsBreakdown } from './dps-breakdown';

afterEach(() => {
  statTrackerDps.resetBoss(); statTrackerDps.resetBreakdown(); playerDps.resetBreakdown();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
function setup(saved: Record<string, string> = {}) {
  vi.useFakeTimers();
  const { document, window } = parseHTML('<html><body><div id="hud"></div><button id="statTrackerToggle"></button></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  Object.assign(window, { innerWidth: 800, innerHeight: 600 });
  const values = new Map(Object.entries({ 'wildstat-native-stat-tracker-enabled': 'true', ...saved }));
  const stats = Object.fromEntries(TRACKED_STATS.map(stat => [stat, 10])) as TrackerValues;
  let raise = 0, rate = 3;
  let crit: CriticalDamageParts = { rating: 1e300 };
  installStatTracker({ storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } },
    read: () => {
      const cap = 1 / attackCapInterval({ minInterval: 1 / 3, raise });
      const result = criticalDamage(crit);
      return { identity: 'test', values: { ...stats }, details: {
        attackSpeed: attackSpeedLabel(Math.min(rate, cap), cap).replace(' (Max)', ' Max'),
        critDamage: critDamageLabel(result.multiplier, result.cap).replace(' (Max)', ' Max'),
      } };
    } });
  const panel = document.querySelector<HTMLElement>('.stat-tracker:not(.stat-tracker-settings)')!;
  const settings = document.querySelector<HTMLElement>('.stat-tracker-settings')!;
  const change = (input: HTMLInputElement, checked: boolean) => {
    input.checked = checked;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const compact = settings.querySelector<HTMLInputElement>('.stat-tracker-compact-option input')!;
  const columns = [...settings.querySelectorAll<HTMLInputElement>('.stat-tracker-compact-options input')];
  const current = (stat: string) => panel.querySelector(`[data-stat="${stat}"] td`)!.textContent;
  return { window, panel, settings, compact, columns, change, values, stats, current,
    setCap: (nextRaise: number, nextRate: number) => { raise = nextRaise; rate = nextRate; },
    setCrit: (next: CriticalDamageParts) => { crit = next; } };
}

it('switches DPS views with source shares and keeps each reset independent', () => {
  vi.spyOn(statTrackerDps, 'breakdown').mockReturnValue([
    { source: 'staff-direct', perSecond: 75 }, { source: 'staff-splash', perSecond: 25 },
  ]);
  const resetDps = vi.spyOn(statTrackerDps, 'resetBreakdown');
  const s = setup({ 'wildstat-stat-tracker-dps-switch': 'true', 'wildstat-stat-tracker-compact': 'true' });
  const switchButton = s.panel.querySelector<HTMLButtonElement>('.stat-tracker-view-switch')!;
  const reset = s.panel.querySelector<HTMLButtonElement>('.stat-tracker-reset')!;
  vi.advanceTimersByTime(2000);
  switchButton.click();
  expect(s.panel.querySelector('.stat-tracker-handle')!.textContent).toBe('DPS ▾');
  expect(s.panel.querySelector('table')!.hidden).toBe(true);
  expect(s.panel.querySelector('.stat-tracker-dps-row')!.getAttribute('style')).toContain('75%');
  reset.click();
  expect(resetDps).toHaveBeenCalledTimes(1);
  expect(s.panel.querySelector('.stat-tracker-time')!.textContent).toBe('00:00:02');
  switchButton.click();
  reset.click();
  expect(resetDps).toHaveBeenCalledTimes(1);
  expect(s.panel.querySelector('.stat-tracker-time')!.textContent).toBe('00:00:00');
});

it('shows pinned boss results and an independent DPS timer, then returns to the live 20s view', () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const s = setup({ 'wildstat-stat-tracker-dps-switch': 'true', 'wildstat-stat-tracker-dps-view': 'true',
    'wildstat-stat-tracker-dps-boss-only': 'true' });
  const boss = { hp: 100, dead: false, encounter: 1n };
  vi.advanceTimersByTime(5000);
  now = 5000; statTrackerDps.record(100, 'staff-direct', boss);
  now = 7000; vi.advanceTimersByTime(2000);
  const clock = s.panel.querySelector('.stat-tracker-dps-time')!;
  expect(clock.textContent).toBe('00:00:02');
  expect(s.panel.querySelector('.stat-tracker-time')!.textContent).toBe('00:00:07');
  expect(s.panel.querySelector('.stat-tracker-dps-status p')!.textContent).toBe('Boss fight');
  boss.dead = true; boss.hp = 0; statTrackerDps.tickBoss();
  now = 9000; statTrackerDps.record(1000, 'bow-hit'); vi.advanceTimersByTime(2000);
  expect(clock.textContent).toBe('00:00:02');
  expect(s.panel.querySelector('.stat-tracker-dps-status p')!.textContent).toBe('Boss dead');
  expect(s.panel.querySelector('.stat-tracker-dps-row dt')!.textContent).toBe('Staff Bolt');
  const back = s.panel.querySelector<HTMLButtonElement>('.stat-tracker-dps-back')!;
  expect(back.hidden).toBe(false);
  back.click();
  expect(back.hidden).toBe(true);
  expect(s.panel.querySelector('.stat-tracker-dps-status p')!.textContent).toBe('Last 20s');
  expect(clock.textContent).toBe('00:00:04');
  s.panel.querySelector<HTMLButtonElement>('.stat-tracker-reset')!.click();
  expect(clock.textContent).toBe('00:00:00');
  expect(s.panel.querySelector('.stat-tracker-time')!.textContent).toBe('00:00:09');
});

it('keeps standalone data and markup independent while hiding and restoring its window', () => {
  const s = setup({ 'wildstat-stat-tracker-dps-switch': 'true', 'wildstat-stat-tracker-dps-view': 'true',
    'wildstat-dps-breakdown-enabled': 'true' });
  const storage = { getItem: (key: string) => s.values.get(key) ?? null,
    setItem: (key: string, value: string) => { s.values.set(key, value); } };
  installDpsBreakdown({ meter: playerDps, storage: () => storage });
  const standalone = document.querySelector<HTMLElement>('.dps-breakdown')!;
  // Linkedom omits the live table rows/cells collections provided by browsers.
  Object.defineProperty(standalone.querySelector('tbody')!, 'rows', { get: () =>
    [...standalone.querySelectorAll('tbody tr')].map(row => {
      if (!Object.prototype.hasOwnProperty.call(row, 'cells')) Object.defineProperty(row, 'cells', { get: () => row.children });
      return row;
    }) });
  expect(standalone.hidden).toBe(true);
  playerDps.record(80, 'bow-hit'); statTrackerDps.record(80, 'bow-hit');
  s.panel.querySelector<HTMLButtonElement>('.stat-tracker-reset')!.click();
  expect(playerDps.breakdown().length).toBe(1);
  const toggle = s.settings.querySelector<HTMLInputElement>('.stat-tracker-mode-options label:nth-child(2) input')!;
  s.change(toggle, false);
  expect(standalone.hidden).toBe(false);
  expect(standalone.querySelector('tbody th')!.textContent).toBe('Shots');
  expect(standalone.querySelector('footer')!.textContent).toBe('Last 20s');
  expect(standalone.querySelector('.stat-tracker-dps-back, .stat-tracker-dps-time')).toBeNull();
  const bossOption = [...s.settings.querySelectorAll('label')].find(label => label.textContent === 'Auto-track bosses')!;
  expect(bossOption.hidden).toBe(true);
  s.change(toggle, true);
  expect(bossOption.hidden).toBe(false);
  expect(standalone.hidden).toBe(true);
});

it('collapses Stats to display by default without losing saved selections', () => {
  const s = setup({ 'wildstat-stat-tracker-hidden-stats': '["armor"]' });
  const disclosure = s.settings.querySelector<HTMLDetailsElement>('.stat-tracker-show-options:not(.stat-tracker-compact-disclosure)')!;
  expect(disclosure.hasAttribute('open')).toBe(false);
  expect(disclosure.querySelector('summary')!.textContent).toBe('Stats to display');
  const armor = disclosure.querySelector<HTMLInputElement>('input[data-stat="armor"]')!;
  expect(armor.checked).toBe(false);
  s.change(armor, false);
  disclosure.setAttribute('open', ''); disclosure.removeAttribute('open');
  expect(armor.checked).toBe(false);
  expect(s.panel.querySelector<HTMLElement>('tr[data-stat="armor"]')!.hidden).toBe(true);
});

it('defaults to full mode and hides compact options until enabled, retaining timer and reset', () => {
  const s = setup();
  expect(s.compact.checked).toBe(false);
  expect(s.settings.querySelector<HTMLElement>('.stat-tracker-compact-options')!.hidden).toBe(true);
  s.change(s.compact, true);
  expect(s.panel.classList.contains('is-compact')).toBe(true);
  expect(s.values.get('wildstat-stat-tracker-compact')).toBe('true');
  expect(s.settings.querySelector<HTMLElement>('.stat-tracker-compact-options')!.hidden).toBe(false);
  expect(s.panel.querySelector<HTMLElement>('tr > :nth-child(2)')!.hidden).toBe(false);
  expect(s.panel.querySelector<HTMLElement>('tr > :nth-child(3)')!.hidden).toBe(true);
  vi.advanceTimersByTime(2000);
  expect(s.panel.querySelector('.stat-tracker-time')!.textContent).toBe('00:00:02');
  s.panel.querySelector<HTMLButtonElement>('.stat-tracker-reset')!.click();
  expect(s.panel.querySelector('.stat-tracker-time')!.textContent).toBe('00:00:00');
});

it('collapses Compact display by default and retains columns and icons across disclosure changes', () => {
  const s = setup({ 'wildstat-stat-tracker-compact': 'true', 'wildstat-stat-tracker-compact-icons': 'true',
    'wildstat-stat-tracker-compact-current': 'false' });
  const disclosure = s.settings.querySelector<HTMLDetailsElement>('.stat-tracker-compact-disclosure')!;
  expect(disclosure.hasAttribute('open')).toBe(false);
  expect(disclosure.hidden).toBe(false);
  expect(disclosure.querySelector('summary')!.textContent).toBe('Compact display');
  disclosure.setAttribute('open', '');
  expect(s.columns[0].checked).toBe(true);
  expect(s.columns[1].checked).toBe(false);
  s.change(s.columns[2], true);
  disclosure.removeAttribute('open'); disclosure.setAttribute('open', '');
  expect(s.columns[2].checked).toBe(true);
  expect(s.values.get('wildstat-stat-tracker-compact-gain')).toBe('true');
  s.change(s.compact, false);
  expect(disclosure.hidden).toBe(true);
  s.change(s.compact, true);
  expect(disclosure.hidden).toBe(false);
  expect(s.columns[0].checked).toBe(true);
  expect(s.columns[2].checked).toBe(true);
});

it('locks the stat tracker without changing collapse state and restores the saved lock', () => {
  const s = setup();
  const handle = s.panel.querySelector<HTMLButtonElement>('.stat-tracker-handle')!;
  const fire = (detail: number) => handle.dispatchEvent(Object.assign(new s.window.Event('click'), { detail }));
  const expanded = handle.getAttribute('aria-expanded');
  fire(1); fire(2);
  vi.advanceTimersByTime(400);
  expect(handle.getAttribute('aria-expanded')).toBe(expanded);
  expect(s.panel.classList.contains('is-position-locked')).toBe(true);
  expect(s.values.get('wildstat-stat-tracker-position-locked')).toBe('true');
  const restored = setup({ 'wildstat-stat-tracker-position-locked': 'true' });
  expect(restored.panel.classList.contains('is-position-locked')).toBe(true);
});

it('persists columns and icons, retains accessible labels, and restores full columns', () => {
  const s = setup({ 'wildstat-stat-tracker-compact': 'true', 'wildstat-stat-tracker-compact-icons': 'true' });
  expect(s.panel.querySelector('[data-stat="kills"] th svg')).not.toBeNull();
  expect(s.panel.querySelector('[data-stat="kills"] th')!.getAttribute('aria-label')).toBe('Kills');
  s.change(s.columns[0], false);
  expect(s.values.get('wildstat-stat-tracker-compact-icons')).toBe('false');
  expect(s.panel.querySelector('svg.stat-tracker-stat-icon')).toBeNull();
  s.change(s.columns[0], true);
  expect(s.values.get('wildstat-stat-tracker-compact-icons')).toBe('true');
  s.change(s.columns[1], false); // Current
  expect(s.values.get('wildstat-stat-tracker-compact-current')).toBe('false');
  expect(s.columns[3].disabled).toBe(true); // Last numeric column remains enabled for display.
  s.change(s.columns[2], true); // Session gain
  expect(s.panel.querySelector<HTMLElement>('tr > :nth-child(3)')!.hidden).toBe(false);
  expect(s.columns[3].disabled).toBe(false);
  s.change(s.compact, false);
  expect(s.panel.querySelector('svg.stat-tracker-stat-icon')).toBeNull();
  expect(s.panel.querySelector<HTMLElement>('tr > :nth-child(2)')!.hidden).toBe(false);
  expect(s.panel.querySelector<HTMLElement>('tr > :nth-child(3)')!.hidden).toBe(false);
});

it('recovers saved all-hidden columns and respects existing stat-row filters', () => {
  const s = setup({ 'wildstat-stat-tracker-compact': 'true', 'wildstat-stat-tracker-compact-current': 'false',
    'wildstat-stat-tracker-compact-gain': 'false', 'wildstat-stat-tracker-compact-hour': 'false',
    'wildstat-stat-tracker-hidden-stats': '["armor"]' });
  expect(s.columns[3].checked).toBe(true);
  expect(s.panel.querySelector<HTMLElement>('[data-stat="armor"]')!.hidden).toBe(true);
});

it.each([false, true])('updates capped display and restores ratings when caps increase (compact=%s)', compact => {
  const s = setup({ 'wildstat-stat-tracker-compact': String(compact) });
  expect(s.current('attackSpeed')).toBe('3.00/s Max');
  expect(s.current('critDamage')).toBe('5.00× Max');
  s.setCap(2, 3); // A perk/card raises the active attack cap above current speed.
  s.setCrit({ rating: 0, capRank: 5, card: .15, researchRank: 10 });
  vi.advanceTimersByTime(1000);
  expect(s.current('attackSpeed')).not.toContain('Max');
  expect(s.current('critDamage')).not.toContain('Max');
  s.setCap(2, 5);
  s.setCrit({ rating: 1e300, capRank: 5, card: .15, researchRank: 10 });
  vi.advanceTimersByTime(1000);
  expect(s.current('attackSpeed')).toBe('5.00/s Max');
  expect(s.current('critDamage')).toBe('11.50× Max');
});
