import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createAutoFarmPanel } from './auto-farm-panel';
import { createAutoFarmController } from '../game/runtime/auto-farm/auto-farm-controller';
import { AUTO_MINE_ORES_KEY, miningStandSpot } from '../game/runtime/auto-farm/auto-mine';
import { AUTO_CHOP_TREES_KEY, choppingStandSpot } from '../game/runtime/auto-farm/auto-chop';
import { createGameBootstrap } from '../game/runtime/game-bootstrap';
import { MINING_NODES, MINING_VEINS } from '../../shared/mining';
import { TOWN_ARRIVAL, TOWN_FEET_OFFSET } from '../../shared/town';
import { WOOD_TREE_NODES } from '../../shared/woodcutting';

let destroy: (() => void) | undefined;
afterEach(() => { destroy?.(); destroy = undefined; vi.unstubAllGlobals(); });
/** Standing by the first copper rock, and by the first pine. */
const spot = (feet: { x: number; y: number }) => ({ x: feet.x, y: feet.y - TOWN_FEET_OFFSET });
const HILLS = spot(miningStandSpot(MINING_NODES[0])!), GROVE = spot(choppingStandSpot(WOOD_TREE_NODES[0])!);
function memoryStorage(values = new Map<string, string>()) {
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

/** The Auto Farm button and window, on the Town (in the hills unless `at` says) or a combat map, with the gathering session behind them. */
function setup(map: { id: string }, options: { mining?: number; woodcutting?: number; at?: { x: number; y: number } } = {}) {
  const { document, window } = parseHTML('<html><body><div id="hud"><div id="chatPanel"></div></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('HTMLElement', window.HTMLElement);
  const state = createGameBootstrap();
  state.enemies.length = 0; state.spawnSites.length = 0;
  if (map.id !== 'town') state.spawnSites.push({ id: 1, type: 'Bramble', x: 1200, y: 500, campName: 'Test', leashRange: 500, alive: false, respawnAt: 50 });
  Object.assign(state.player, options.at ?? HILLS);
  const storage = memoryStorage();
  const source = { mining: () => options.mining ?? 0, woodcutting: () => options.woodcutting ?? 0, minedNodeAt: () => null, choppedTreeAt: () => null,
    serverNowMs: () => 5_000_000 };
  const farm = createAutoFarmController({ ...state, mapId: () => map.id, unavailable: () => null, paused: () => false, speed: () => 300, obstacles: () => [],
    mining: () => source, priorityStorage: () => storage as unknown as Storage });
  const panel = createAutoFarmPanel({ farm, mapName: () => map.id, visible: () => true, unavailable: () => null, setPaused: () => {}, clearInput: () => {},
    rewardMultiplier: () => 1, showBaseStatRewards: () => false, storage: () => storage });
  destroy = panel.destroy;
  const click = (selector: string) => document.querySelector(selector)!.dispatchEvent(new window.Event('click', { bubbles: true }));
  const text = (selector: string) => document.querySelector(selector)!.textContent;
  const ore = (id: string) => document.querySelector<HTMLButtonElement>(`[data-ore="${id}"]`)!;
  const shown = (selector: string) => !document.querySelector<HTMLElement>(selector)!.hidden;
  return { farm, panel, document, window, state, storage, click, text, ore, shown };
}

it('in the Copper Hills the Auto Farm button is Auto Mine, with a switch per ore instead of stats', () => {
  const s = setup({ id: 'town' });
  expect(s.text('.farm-badge')).toBe('Auto Mine: Off');
  s.click('.farm-toggle');
  expect(s.text('#autoFarmTitle')).toBe('Auto Mine');
  expect(s.shown('.farm-mine-body')).toBe(true);
  expect(s.shown('.farm-body:not(.farm-mine-body)')).toBe(false);
  const switches = [...s.document.querySelectorAll<HTMLButtonElement>('.farm-mine-ores [data-ore]')];
  expect(switches.map(button => button.querySelector('.farm-switch-label')!.textContent)).toEqual(['Copper Ore', 'Iron Ore', 'Mithril Ore', 'Adamant Ore', 'Arcane Crystal']);
  expect(switches.map(button => button.getAttribute('role'))).toEqual(['switch', 'switch', 'switch', 'switch', 'switch']);
  // Copper picked to start with, its rocks all standing; the deeper veins locked, each with the Mining that opens it.
  expect(s.ore('copper_ore').getAttribute('aria-checked')).toBe('true');
  expect(s.ore('copper_ore').textContent).toContain('34 of 34 Rocks Ready');
  // Crystal rocks wait for Mining.
  expect(s.ore('arcane_crystal').disabled).toBe(true);
  expect(s.ore('arcane_crystal').textContent).toContain('Opens at Mining 25');
  for (const vein of MINING_VEINS.slice(1)) {
    expect(s.ore(vein.ore).disabled).toBe(true);
    expect(s.ore(vein.ore).getAttribute('aria-checked')).toBe('false');
    expect(s.ore(vein.ore).textContent).toContain(`Opens at Mining ${vein.mining}`);
  }
  // The "?" page is Auto Mine's.
  expect(s.text('.farm-help-list')).toContain('Copper Hills');
  expect(s.text('.farm-mine-status')).toBe('Off');
});

it('starts and stops Auto Mine from the window, showing what it is doing, and remembers the ores picked', () => {
  const s = setup({ id: 'town' }, { mining: 50 });
  s.click('.farm-toggle');
  expect(s.ore('iron_ore').disabled).toBe(false);
  s.click('[data-ore="iron_ore"]');
  s.click('[data-ore="copper_ore"]');
  s.click('[data-ore="arcane_crystal"]');
  expect(JSON.parse(s.storage.values.get(AUTO_MINE_ORES_KEY)!)).toEqual(['iron_ore']);
  expect(s.ore('copper_ore').getAttribute('aria-checked')).toBe('false');
  expect(s.ore('iron_ore').getAttribute('aria-checked')).toBe('true');
  s.click('.farm-start');
  expect(s.farm.mine!.state().active).toBe(true);
  expect(s.text('.farm-badge')).toBe('Auto Mine: On');
  s.farm.movement({ x: 0, y: 0, source: 'none' }, 1 / 30);
  s.click('.farm-toggle');
  expect(s.text('.farm-mine-status')).toMatch(/^Walking to .*Iron Ore$/);
  expect(s.text('.farm-close')).toBe('Stop');
  expect(s.text('.farm-start')).toBe('Go');
  s.click('.farm-close');
  expect(s.farm.mine!.state().active).toBe(false);
  expect(s.text('.farm-badge')).toBe('Auto Mine: Off');
});

it('says why it cannot start: no ore picked; a new player holds a pickaxe already', () => {
  const s = setup({ id: 'town' });
  s.click('.farm-toggle');
  expect(s.document.querySelector<HTMLButtonElement>('.farm-start')!.disabled).toBe(false);
  const picked = setup({ id: 'town' });
  picked.click('.farm-toggle');
  picked.click('[data-ore="copper_ore"]');
  expect(picked.text('.farm-selection')).toBe('Pick an Ore to Mine');
  expect(picked.document.querySelector<HTMLButtonElement>('.farm-start')!.disabled).toBe(true);
});

it('on a combat map stays Auto Farm, and turns back into it on leaving the hills', () => {
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

it('in Timberwood the button is Auto Chop, with a switch per tree', () => {
  const s = setup({ id: 'town' }, { at: GROVE });
  expect(s.text('.farm-badge')).toBe('Auto Chop: Off');
  s.click('.farm-toggle');
  expect(s.text('#autoFarmTitle')).toBe('Auto Chop');
  expect(s.shown('.farm-chop-body')).toBe(true);
  expect(s.shown('.farm-mine-body:not(.farm-chop-body)')).toBe(false);
  const switches = [...s.document.querySelectorAll<HTMLButtonElement>('.farm-chop-body [data-tree]')];
  expect(switches.map(button => button.querySelector('.farm-switch-label')!.textContent)).toEqual(['Pine Trees', 'Oak Trees', 'Yew Trees', 'Elder Trees']);
  const tree = (kind: string) => s.document.querySelector<HTMLButtonElement>(`[data-tree="${kind}"]`)!;
  expect(tree('pine').getAttribute('aria-checked')).toBe('true');
  const pines = WOOD_TREE_NODES.filter(node => node.kind === 'pine').length;
  expect(tree('pine').textContent).toContain(`${pines} of ${pines} Trees Ready`);
  expect(tree('oak').disabled).toBe(true);
  expect(tree('oak').textContent).toContain('Opens at Woodcutting 50');
  expect(s.text('.farm-help-list')).toContain('Timberwood');
  // Start, Stop, and the picks remembered.
  s.click('[data-tree="pine"]');
  expect(JSON.parse(s.storage.values.get(AUTO_CHOP_TREES_KEY)!)).toEqual([]);
  expect(s.text('.farm-selection')).toBe('Pick a Tree to Chop');
  s.click('[data-tree="pine"]');
  s.click('.farm-start');
  expect(s.farm.chop!.state().active).toBe(true);
  expect(s.text('.farm-badge')).toBe('Auto Chop: On');
  s.farm.movement({ x: 0, y: 0, source: 'none' }, 1 / 30);
  s.click('.farm-toggle');
  expect(s.text('.farm-chop-body .farm-mine-status')).toMatch(/^Chopping Pine Tree|Walking to Pine Tree$/);
  s.click('.farm-close');
  expect(s.farm.chop!.state().active).toBe(false);
  expect(s.text('.farm-badge')).toBe('Auto Chop: Off');
});

it('opens Oak Trees to Auto Chop at Woodcutting 50, a new player chopping pines from the start', () => {
  const fresh = setup({ id: 'town' }, { at: GROVE });
  fresh.click('.farm-toggle');
  expect(fresh.document.querySelector<HTMLButtonElement>('.farm-start')!.disabled).toBe(false);
  const s = setup({ id: 'town' }, { at: GROVE, woodcutting: 50 });
  s.click('.farm-toggle');
  expect(s.document.querySelector<HTMLButtonElement>('[data-tree="oak"]')!.disabled).toBe(false);
});

it('shows no button elsewhere in the Town, and folds the window away on walking out of an area', () => {
  const s = setup({ id: 'town' }, { at: TOWN_ARRIVAL });
  const sheet = s.document.querySelector<HTMLElement>('#autoFarmSheet')!;
  expect(sheet.hidden).toBe(true);
  // The Auto Farm key does nothing there either; in the hills it starts and stops Auto Mine.
  const pressF = () => s.document.body.dispatchEvent(Object.assign(new s.window.Event('keydown', { bubbles: true, cancelable: true }), { code: 'KeyF' }));
  pressF();
  expect(s.farm.mine!.state().active).toBe(false);
  expect(s.farm.chop!.state().active).toBe(false);
  Object.assign(s.state.player, HILLS);
  s.panel.refresh();
  expect(sheet.hidden).toBe(false);
  pressF();
  expect(s.farm.mine!.state().active).toBe(true);
  pressF();
  expect(s.farm.mine!.state().active).toBe(false);
  expect(s.text('.farm-badge')).toBe('Auto Mine: Off');
  s.click('.farm-toggle');
  expect(s.document.querySelector<HTMLElement>('.farm-card-content')!.hidden).toBe(false);
  Object.assign(s.state.player, TOWN_ARRIVAL);
  s.panel.refresh();
  expect(sheet.hidden).toBe(true);
  expect(s.document.querySelector<HTMLElement>('.farm-card-content')!.hidden).toBe(true);
  Object.assign(s.state.player, GROVE);
  s.panel.refresh();
  expect(sheet.hidden).toBe(false);
  expect(s.text('.farm-badge')).toBe('Auto Chop: Off');
});
