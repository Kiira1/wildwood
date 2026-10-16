import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createAutoFarmPanel } from './auto-farm-panel';
import { createAutoFarmController } from '../game/runtime/auto-farm/auto-farm-controller';
import { AUTO_MINE_ORES_KEY } from '../game/runtime/auto-farm/auto-mine';
import { createGameBootstrap } from '../game/runtime/game-bootstrap';
import { MINING_VEINS, miningVeinMap } from '../../shared/mining';
import { TOWN_ARRIVAL } from '../../shared/town';

let destroy: (() => void) | undefined;
afterEach(() => { destroy?.(); destroy = undefined; vi.unstubAllGlobals(); });
function memoryStorage(values = new Map<string, string>()) {
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

/** The Auto Farm button and window, on the Town or a combat map, with the mining session behind them. */
function setup(map: { id: string }, options: { pickaxe?: boolean; access?: Record<string, boolean> } = {}) {
  const { document, window } = parseHTML('<html><body><div id="hud"><div id="chatPanel"></div></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('HTMLElement', window.HTMLElement);
  const state = createGameBootstrap();
  state.enemies.length = 0; state.spawnSites.length = 0;
  if (map.id !== 'town') state.spawnSites.push({ id: 1, type: 'Bramble', x: 1200, y: 500, campName: 'Test', leashRange: 500, alive: false, respawnAt: 50 });
  Object.assign(state.player, TOWN_ARRIVAL);
  const storage = memoryStorage();
  const source = { hasPickaxe: () => options.pickaxe ?? true, minedNodeAt: () => null, serverNowMs: () => 5_000_000, savedProgress: () => options.access ?? {} };
  const farm = createAutoFarmController({ ...state, mapId: () => map.id, unavailable: () => null, paused: () => false, speed: () => 300, obstacles: () => [],
    mining: () => source, priorityStorage: () => storage as unknown as Storage });
  const panel = createAutoFarmPanel({ farm, mapName: () => map.id, visible: () => true, unavailable: () => null, setPaused: () => {}, clearInput: () => {},
    rewardMultiplier: () => 1, showBaseStatRewards: () => false, storage: () => storage });
  destroy = panel.destroy;
  const click = (selector: string) => document.querySelector(selector)!.dispatchEvent(new window.Event('click', { bubbles: true }));
  const text = (selector: string) => document.querySelector(selector)!.textContent;
  const ore = (id: string) => document.querySelector<HTMLButtonElement>(`[data-ore="${id}"]`)!;
  const shown = (selector: string) => !document.querySelector<HTMLElement>(selector)!.hidden;
  return { farm, panel, document, storage, click, text, ore, shown };
}

it('in the Town the Auto Farm button is Auto Mine, with a switch per ore instead of stats', () => {
  const s = setup({ id: 'town' });
  expect(s.text('.farm-badge')).toBe('Auto Mine: Off');
  s.click('.farm-toggle');
  expect(s.text('#autoFarmTitle')).toBe('Auto Mine');
  expect(s.shown('.farm-mine-body')).toBe(true);
  expect(s.shown('.farm-body:not(.farm-mine-body)')).toBe(false);
  const switches = [...s.document.querySelectorAll<HTMLButtonElement>('.farm-mine-ores [data-ore]')];
  expect(switches.map(button => button.querySelector('.farm-switch-label')!.textContent)).toEqual(['Copper Ore', 'Iron Ore', 'Mithril Ore', 'Adamant Ore']);
  expect(switches.map(button => button.getAttribute('role'))).toEqual(['switch', 'switch', 'switch', 'switch']);
  // Copper picked to start with, its rocks all standing; the deeper veins locked, each with the map that opens it.
  expect(s.ore('copper_ore').getAttribute('aria-checked')).toBe('true');
  expect(s.ore('copper_ore').textContent).toContain('34 of 34 Rocks Ready');
  for (const vein of MINING_VEINS.slice(1)) {
    expect(s.ore(vein.ore).disabled).toBe(true);
    expect(s.ore(vein.ore).getAttribute('aria-checked')).toBe('false');
    expect(s.ore(vein.ore).textContent).toContain(`Opens with ${miningVeinMap(vein)}`);
  }
  // The "?" page is Auto Mine's.
  expect(s.text('.farm-help-list')).toContain('Copper Hills');
  expect(s.text('.farm-mine-status')).toBe('Off');
});

it('starts and stops Auto Mine from the window, showing what it is doing, and remembers the ores picked', () => {
  const s = setup({ id: 'town' }, { access: { infernalUnlocked: true } });
  s.click('.farm-toggle');
  expect(s.ore('iron_ore').disabled).toBe(false);
  s.click('[data-ore="iron_ore"]');
  s.click('[data-ore="copper_ore"]');
  expect(JSON.parse(s.storage.values.get(AUTO_MINE_ORES_KEY)!)).toEqual(['iron_ore']);
  expect(s.ore('copper_ore').getAttribute('aria-checked')).toBe('false');
  expect(s.ore('iron_ore').getAttribute('aria-checked')).toBe('true');
  s.click('.farm-start');
  expect(s.farm.mine!.state().active).toBe(true);
  expect(s.text('.farm-badge')).toBe('Auto Mine: On');
  s.farm.movement({ x: 0, y: 0, source: 'none' }, 1 / 30);
  s.click('.farm-toggle');
  expect(s.text('.farm-mine-status')).toBe('Walking to the Copper Hills');
  expect(s.text('.farm-close')).toBe('Stop');
  expect(s.text('.farm-start')).toBe('Go');
  s.click('.farm-close');
  expect(s.farm.mine!.state().active).toBe(false);
  expect(s.text('.farm-badge')).toBe('Auto Mine: Off');
});

it('says why it cannot start: no pickaxe, or no ore picked', () => {
  const s = setup({ id: 'town' }, { pickaxe: false });
  s.click('.farm-toggle');
  expect(s.text('.farm-selection')).toBe('Get a Pickaxe from the Smith');
  expect(s.document.querySelector<HTMLButtonElement>('.farm-start')!.disabled).toBe(true);
  const picked = setup({ id: 'town' });
  picked.click('.farm-toggle');
  picked.click('[data-ore="copper_ore"]');
  expect(picked.text('.farm-selection')).toBe('Pick an Ore to Mine');
  expect(picked.document.querySelector<HTMLButtonElement>('.farm-start')!.disabled).toBe(true);
});

it('on a combat map stays Auto Farm, and turns back into it on leaving the Town', () => {
  const map = { id: 'forest' };
  const s = setup(map);
  expect(s.text('.farm-badge')).toBe('Autofarm: Off');
  s.click('.farm-toggle');
  expect(s.text('#autoFarmTitle')).toBe('Auto Farm');
  expect(s.shown('.farm-mine-body')).toBe(false);
  expect(s.document.querySelectorAll('.farm-weights [data-group]').length).toBe(1);
  expect(s.text('.farm-help-list')).toContain('Move On');
  map.id = 'town';
  s.panel.refresh();
  expect(s.text('#autoFarmTitle')).toBe('Auto Mine');
  expect(s.shown('.farm-mine-body')).toBe(true);
  map.id = 'forest';
  s.panel.refresh();
  expect(s.text('#autoFarmTitle')).toBe('Auto Farm');
  expect(s.shown('.farm-mine-body')).toBe(false);
  expect(s.text('.farm-badge')).toBe('Autofarm: Off');
});
