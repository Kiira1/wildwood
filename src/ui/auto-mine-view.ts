import type { AutoMine } from '../game/runtime/auto-farm/auto-mine';

/** The "?" page in the Town. */
export const AUTO_MINE_HELP_LINES: readonly [term: string, line: string][] = [
  ['Ores', 'Switch on the ores to mine. Every rock of that ore counts, Small, Large and Mysterious.'],
  ['Walking', 'Start it anywhere in the Town: it walks out to the Copper Hills and mines the nearest rock, then the next.'],
  ['Bare Rocks', 'With every rock of your ores mined, it waits by the one that grows back first.'],
  ['Moving', 'Move yourself any time; it carries on when you let go.'],
  ['Leaving', 'Leaving the Town stops it.'],
];

/**
 * The Auto Farm window's body in the Town: what Auto Mine is doing, and one switch per ore, the Move On switch's
 * look. A shut vein's switch is locked, with the map that opens it under its name.
 */
export function createAutoMineView(mine: AutoMine, changed: () => void) {
  const body = document.createElement('div');
  body.className = 'farm-body farm-mine-body';
  body.hidden = true;
  body.innerHTML = '<p class="farm-mine-status" aria-live="polite"></p>'
    + '<div class="farm-setting"><span id="autoMineOresLabel" class="farm-setting-label">Ores</span></div>'
    + '<div class="farm-mine-ores" role="group" aria-labelledby="autoMineOresLabel"></div>';
  const statusLine = body.querySelector<HTMLElement>('.farm-mine-status')!;
  const list = body.querySelector<HTMLElement>('.farm-mine-ores')!;
  for (const vein of mine.veins()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'farm-switch farm-ore';
    button.setAttribute('role', 'switch');
    button.dataset.ore = vein.ore;
    button.innerHTML = '<span class="farm-switch-copy"><span class="farm-switch-label"></span><small class="farm-boss-status"></small></span><span class="farm-knob" aria-hidden="true"></span>';
    button.querySelector('.farm-switch-label')!.textContent = vein.name;
    button.addEventListener('click', () => {
      if (button.disabled) return;
      mine.setPicked(vein.ore, !mine.picked(vein.ore));
      changed();
    });
    list.append(button);
  }

  /** Brings the switches and the status line up to date. */
  function render() {
    const state = mine.state();
    const text = state.active ? state.status : 'Off';
    if (statusLine.textContent !== text) statusLine.textContent = text;
    statusLine.classList.toggle('is-idle', !state.active);
    for (const vein of mine.veins()) {
      const button = list.querySelector<HTMLButtonElement>(`[data-ore="${vein.ore}"]`)!;
      const on = vein.open && vein.picked;
      button.disabled = !vein.open;
      button.setAttribute('aria-checked', String(on));
      const line = vein.open ? `${vein.standing} of ${vein.rocks} Rocks Ready` : `Opens with ${vein.opensWith}`;
      const sub = button.querySelector<HTMLElement>('.farm-boss-status')!;
      if (sub.textContent !== line) sub.textContent = line;
      sub.classList.toggle('is-idle', !on);
    }
  }
  return { body, render };
}
