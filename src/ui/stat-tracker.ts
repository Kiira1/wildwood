import { formatCompactNumber } from './number-format';
import { renderBooleanSetting } from './settings';
import { createStatTrackerModel, TRACKED_STATS, type TrackerValues } from './stat-tracker-model';

const LABELS = { power: 'Power', hp: 'Max HP', damage: 'Damage', armor: 'Armor', regen: 'Regen', kills: 'Kills' };
const ENABLED_KEY = 'wildstat-native-stat-tracker-enabled';
const POSITION_KEY = 'wildstat-native-stat-tracker-position';

export function installStatTracker(options: {
  read: () => { identity: string; values: TrackerValues } | null;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
}) {
  const model = createStatTrackerModel(options.storage);
  const toggle = document.getElementById('statTrackerToggle')!;
  const panel = document.createElement('section');
  panel.className = 'stat-tracker';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Live stat tracker');
  panel.innerHTML = `<header><button type="button" class="stat-tracker-handle" aria-label="Move stat tracker. Use arrow keys to move; Home to reset position.">Stat tracker</button></header><table><thead><tr><th scope="col">Stat</th><th scope="col">Current</th><th scope="col">Gain</th><th scope="col">/ Hour</th></tr></thead><tbody>${TRACKED_STATS.map(key => `<tr data-stat="${key}"><th scope="row">${LABELS[key]}</th><td></td><td></td><td></td></tr>`).join('')}</tbody></table><footer><span class="stat-tracker-time"></span><button type="button" class="stat-tracker-reset">Reset session</button></footer><p>Includes time away and equipment changes.</p>`;
  document.getElementById('hud')!.append(panel);
  const handle = panel.querySelector<HTMLButtonElement>('.stat-tracker-handle')!;
  const reset = panel.querySelector<HTMLButtonElement>('.stat-tracker-reset')!;

  const clock = panel.querySelector<HTMLElement>('.stat-tracker-time')!;
  const cells = new Map(TRACKED_STATS.map(stat => [stat, panel.querySelectorAll<HTMLTableCellElement>(`[data-stat="${stat}"] td`)]));
  let enabled = false, lastSave = 0;
  let position: { x: number; y: number } | null = null;
  let drag: { id: number; x: number; y: number } | null = null;
  try {
    enabled = options.storage.getItem(ENABLED_KEY) === 'true';
    const saved = JSON.parse(options.storage.getItem(POSITION_KEY) || 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) position = saved;
  } catch {}
  function savePosition() {
    try { options.storage.setItem(POSITION_KEY, JSON.stringify(position)); } catch {}
  }
  function place() {
    if (panel.hidden || !position) return;
    position.x = Math.max(8, Math.min(position.x, window.innerWidth - panel.offsetWidth - 8));
    position.y = Math.max(8, Math.min(position.y, window.innerHeight - panel.offsetHeight - 8));
    panel.style.left = `${position.x}px`;
    panel.style.top = `${position.y}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }
  function home() { position = null; panel.removeAttribute('style'); savePosition(); }
  function refresh() {
    const snapshot = options.read();
    // Keep session tracking independent of visibility; hiding does not reset it.
    const result = snapshot ? model.update(snapshot.identity, snapshot.values) : null;
    const wasHidden = panel.hidden;
    panel.hidden = !enabled || !result;
    if (result && Date.now() - lastSave >= 10_000) { model.save(); lastSave = Date.now(); }
    if (panel.hidden || !result) return;
    if (wasHidden) place();
    const seconds = Math.floor(result.elapsedMs / 1000);
    clock.textContent = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    for (const row of result.rows) {
      const rowCells = cells.get(row.stat)!;
      const format = (value: number) => row.stat === 'kills' ? Math.round(value).toLocaleString()
        : Math.abs(value) < 1000 ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : formatCompactNumber(value);
      rowCells[0].textContent = format(row.current);
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
  // UI gestures must never become world movement or combat input.
  for (const event of ['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'keydown', 'keyup']) {
    panel.addEventListener(event, e => e.stopPropagation());
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const bounds = panel.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    position = { x: event.clientX - drag.x, y: event.clientY - drag.y };
    place();
  });
  const finishDrag = () => { drag = null; savePosition(); };
  handle.addEventListener('pointerup', finishDrag);
  handle.addEventListener('pointercancel', finishDrag);
  handle.addEventListener('lostpointercapture', finishDrag);
  handle.addEventListener('dblclick', home);
  handle.addEventListener('keydown', event => {
    if (event.key === 'Home') { event.preventDefault(); home(); return; }
    const delta = ({ ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] } as Record<string, number[]>)[event.key];
    if (!delta) return;
    event.preventDefault();
    const bounds = panel.getBoundingClientRect();
    position = { x: bounds.left + delta[0], y: bounds.top + delta[1] };
    place(); savePosition();
  });
  window.addEventListener('resize', place);
  window.addEventListener('pagehide', model.save);
  document.addEventListener('visibilitychange', () => { model.save(); if (!document.hidden) refresh(); });
  window.setInterval(() => { if (!document.hidden) refresh(); }, 1000);
  renderBooleanSetting(toggle, enabled);
  refresh();
}
