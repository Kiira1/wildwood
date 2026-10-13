import { formatCompactNumber } from './number-format';
import { installMovableHudCard } from './movable-hud-card';
import { renderBooleanSetting } from './settings';
import { createStatTrackerModel, TRACKED_STATS, type TrackedStat, type TrackerBuild, type TrackerValues } from './stat-tracker-model';

const LABELS = { power: 'Power', hp: 'Max HP', damage: 'Damage', armor: 'Armor', regen: 'Regen', attackSpeed: 'Atk Speed', critDamage: 'Crit Dmg', kills: 'Kills' };
const ENABLED_KEY = 'wildstat-native-stat-tracker-enabled';
const POSITION_KEY = 'wildstat-native-stat-tracker-position';
const COLLAPSED_KEY = 'wildstat-native-stat-tracker-collapsed';
const HIDDEN_KEY = 'wildstat-stat-tracker-hidden-stats';
const PRESTIGE_RESET_KEY = 'wildstat-stat-tracker-reset-on-prestige';

/** Default slider position; reproduces the panel exactly as it looked before the slider existed. */
export const DEFAULT_TRACKER_OPACITY = 60;

/**
 * Backdrop alpha follows the slider all the way to nothing. Text and frame
 * follow it too but bottom out at a quarter and reach full a little past
 * halfway, so a fully transparent tracker still reads and the default look
 * (60) is solid ink over the profile HUD's translucency.
 */
export function trackerOpacityStyle(percent: number) {
  const p = Math.min(100, Math.max(0, percent)) / 100;
  return { background: p, ink: Math.min(1, 0.25 + p * 1.5) };
}

export function installStatTracker(options: {
  read: () => { identity: string; prestigeLevel?: number; values: TrackerValues; build?: TrackerBuild; details?: Partial<Record<keyof TrackerValues, string>> } | null;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
}) {
  const model = createStatTrackerModel(options.storage);
  const toggle = document.getElementById('statTrackerToggle')!;
  const panel = document.createElement('section');
  panel.className = 'stat-tracker';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Live stat tracker');
  panel.innerHTML = `<header><button type="button" class="stat-tracker-handle" aria-label="Move stat tracker. Use arrow keys to move; Home to reset position.">Stat tracker</button><button type="button" class="stat-tracker-gear" aria-label="Stat tracker settings" aria-haspopup="dialog" aria-expanded="false"><img src="assets/wildstat/icons/Icon_Settings.webp" alt="" aria-hidden="true"></button></header><table><thead><tr><th scope="col">Stat</th><th scope="col">Current</th><th scope="col">Gain</th><th scope="col">/ Hour</th></tr></thead><tbody>${TRACKED_STATS.map(key => `<tr data-stat="${key}"><th scope="row">${LABELS[key]}</th><td></td><td></td><td></td></tr>`).join('')}</tbody></table><footer><span class="stat-tracker-time"></span><button type="button" class="stat-tracker-reset" aria-label="Reset session">Reset</button></footer>`;
  // The gear opens a second card in the same style: opacity, which stats show, and whether a prestige resets the timer.
  const settings = document.createElement('section');
  settings.className = 'stat-tracker stat-tracker-settings';
  settings.hidden = true;
  settings.setAttribute('role', 'dialog');
  settings.setAttribute('aria-label', 'Stat tracker settings');
  settings.innerHTML = `<header><span class="stat-tracker-settings-title">Tracker Settings</span><button type="button" class="stat-tracker-settings-close" aria-label="Close tracker settings">✕</button></header><label class="stat-tracker-opacity"><span>Opacity</span><input type="range" min="0" max="100" step="1" aria-label="Panel opacity"></label><fieldset class="stat-tracker-filters"><legend>Show</legend>${TRACKED_STATS.map(key => `<label><input type="checkbox" data-stat="${key}">${LABELS[key]}</label>`).join('')}</fieldset><label class="stat-tracker-prestige-reset"><input type="checkbox">Reset timer on prestige</label>`;
  document.getElementById('hud')!.append(panel, settings);
  const handle = panel.querySelector<HTMLButtonElement>('.stat-tracker-handle')!;
  const OPACITY_KEY = 'wildstat-stat-tracker-opacity';
  const opacity = settings.querySelector<HTMLInputElement>('.stat-tracker-opacity input')!;
  function applyOpacity(percent: number) {
    const style = trackerOpacityStyle(percent);
    panel.style.setProperty('--stat-tracker-bg', String(style.background));
    panel.style.setProperty('--stat-tracker-ink', String(style.ink));
  }
  const savedRaw = options.storage.getItem(OPACITY_KEY);
  const savedOpacity = savedRaw === null ? DEFAULT_TRACKER_OPACITY : Number(savedRaw);
  opacity.valueAsNumber = Number.isFinite(savedOpacity) ? Math.min(100, Math.max(0, savedOpacity)) : DEFAULT_TRACKER_OPACITY;
  applyOpacity(opacity.valueAsNumber);
  opacity.addEventListener('input', () => {
    applyOpacity(opacity.valueAsNumber);
    try { options.storage.setItem(OPACITY_KEY, String(opacity.valueAsNumber)); } catch {}
  });
  // Hand the keyboard back to the world once the thumb is released, so arrow
  // keys walk again. Tabbing to the slider still keeps focus for adjustment.
  opacity.addEventListener('pointerup', () => opacity.blur());
  const reset = panel.querySelector<HTMLButtonElement>('.stat-tracker-reset')!;
  const gear = panel.querySelector<HTMLButtonElement>('.stat-tracker-gear')!;

  // Which rows show. Saved as the hidden ones, so a stat added later shows by default.
  const hidden = new Set<TrackedStat>();
  try { for (const stat of JSON.parse(options.storage.getItem(HIDDEN_KEY) || '[]')) if ((TRACKED_STATS as readonly string[]).includes(stat)) hidden.add(stat); } catch {}
  function renderFilters() {
    for (const stat of TRACKED_STATS) {
      panel.querySelector<HTMLElement>(`tr[data-stat="${stat}"]`)!.hidden = hidden.has(stat);
      settings.querySelector<HTMLInputElement>(`input[data-stat="${stat}"]`)!.checked = !hidden.has(stat);
    }
  }
  settings.querySelector('.stat-tracker-filters')!.addEventListener('change', event => {
    const box = event.target as HTMLInputElement;
    const stat = box.dataset.stat as TrackedStat | undefined;
    if (!stat) return;
    if (box.checked) hidden.delete(stat); else hidden.add(stat);
    try { options.storage.setItem(HIDDEN_KEY, JSON.stringify([...hidden])); } catch {}
    renderFilters(); movable.place();
  });
  const prestigeReset = settings.querySelector<HTMLInputElement>('.stat-tracker-prestige-reset input')!;
  let resetOnPrestige = true;
  try { resetOnPrestige = options.storage.getItem(PRESTIGE_RESET_KEY) !== 'false'; } catch {}
  prestigeReset.checked = resetOnPrestige;
  model.setResetOnPrestige(resetOnPrestige);
  prestigeReset.addEventListener('change', () => {
    model.setResetOnPrestige(prestigeReset.checked);
    try { options.storage.setItem(PRESTIGE_RESET_KEY, String(prestigeReset.checked)); } catch {}
  });

  /** Opens the settings card beside the tracker: to its left, else its right, else above or below it. */
  function placeSettings() {
    const card = panel.getBoundingClientRect(), width = settings.offsetWidth, height = settings.offsetHeight, gap = 8;
    let left = card.left - width - gap, top = card.top;
    if (left < gap) left = card.right + gap;
    if (left + width > window.innerWidth - gap) {
      left = Math.min(Math.max(gap, card.left), window.innerWidth - width - gap);
      top = card.top - height - gap >= gap ? card.top - height - gap : card.bottom + gap;
    }
    settings.style.left = `${Math.max(gap, left)}px`;
    settings.style.top = `${Math.max(gap, Math.min(top, window.innerHeight - height - gap))}px`;
    settings.style.right = 'auto';
    settings.style.bottom = 'auto';
  }
  function showSettings(open: boolean) {
    settings.hidden = !open;
    gear.setAttribute('aria-expanded', String(open));
    if (open) placeSettings();
  }
  gear.addEventListener('click', () => showSettings(settings.hidden));
  settings.querySelector('.stat-tracker-settings-close')!.addEventListener('click', () => showSettings(false));
  for (const element of [gear, settings]) element.addEventListener('pointerdown', event => event.stopPropagation());

  const clock = panel.querySelector<HTMLElement>('.stat-tracker-time')!;
  const cells = new Map(TRACKED_STATS.map(stat => [stat, panel.querySelectorAll<HTMLTableCellElement>(`[data-stat="${stat}"] td`)]));
  let enabled = false, lastSave = 0, collapsed = false;
  try {
    enabled = options.storage.getItem(ENABLED_KEY) === 'true';
    collapsed = options.storage.getItem(COLLAPSED_KEY) === 'true';
  } catch {}
  function renderCollapsed() {
    panel.classList.toggle('is-collapsed', collapsed);
    handle.setAttribute('aria-expanded', String(!collapsed));
    handle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} stat tracker. Drag to move; Home to reset position.`);
    handle.textContent = `Stat tracker ${collapsed ? '▸' : '▾'}`;
    for (const element of panel.querySelectorAll<HTMLElement>('table, footer, .stat-tracker-gear')) element.hidden = collapsed;
    if (collapsed) showSettings(false);
    movable.place();
  }
  function refresh() {
    const snapshot = options.read();
    // Keep session tracking independent of visibility; hiding does not reset it.
    const result = snapshot ? model.update(snapshot.identity, snapshot.values, snapshot.prestigeLevel, snapshot.build) : null;
    const wasHidden = panel.hidden;
    panel.hidden = !enabled || !result;
    if (panel.hidden && !settings.hidden) showSettings(false);
    if (result && Date.now() - lastSave >= 10_000) { model.save(); lastSave = Date.now(); }
    if (panel.hidden || !result) return;
    if (wasHidden) movable.place();
    const seconds = Math.floor(result.elapsedMs / 1000);
    clock.textContent = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    for (const row of result.rows) {
      const rowCells = cells.get(row.stat)!;
      // Three significant digits throughout keeps every column narrow. Values
      // below one keep their decimals, so regeneration does not read as zero.
      const format = (value: number) => Math.abs(value) < 1
        ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : formatCompactNumber(value);
      const detail = snapshot?.details?.[row.stat];
      rowCells[0].textContent = detail ? `${format(row.current)} (${detail})` : format(row.current);
      [row.gain, row.perHour].forEach((value, index) => {
        rowCells[index + 1].textContent = `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}`;
        rowCells[index + 1].className = value > 0 ? 'positive' : value < 0 ? 'negative' : '';
      });
    }
  }
  function setEnabled(value: boolean) {
    enabled = value;
    try { options.storage.setItem(ENABLED_KEY, String(value)); } catch {}
    renderBooleanSetting(toggle, value);
    refresh();
  }
  toggle.addEventListener('click', () => setEnabled(!enabled));

  reset.addEventListener('click', () => { if (options.read()) { refresh(); model.reset(); refresh(); } });
  // Pointer activation should not move keyboard focus onto the reset button.
  reset.addEventListener('pointerdown', event => event.preventDefault());
  // Dragging, keyboard moves and keeping its touches out of the world: the shared HUD card.
  const movable = installMovableHudCard({ panel, handle, storage: () => options.storage, positionKey: POSITION_KEY, toggle: () => {
    collapsed = !collapsed;
    try { options.storage.setItem(COLLAPSED_KEY, String(collapsed)); } catch {}
    renderCollapsed();
  } });
  window.addEventListener('pagehide', model.save);
  document.addEventListener('visibilitychange', () => { model.save(); if (!document.hidden) refresh(); });
  window.setInterval(() => { if (!document.hidden) refresh(); }, 1000);
  renderBooleanSetting(toggle, enabled);
  renderFilters();
  renderCollapsed();
  refresh();
}
