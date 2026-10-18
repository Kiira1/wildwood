import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createAutoFarmPanel } from './auto-farm-panel';
import { createAutoFarmController } from '../game/runtime/auto-farm/auto-farm-controller';
import { createSpawnSites } from '../game/world';
// Four of an Endless map's six reward camps (0.901.47 added attack speed and crit), which these slider tests were written for.
const fourStatSites = (mapId: string) => createSpawnSites({ x: 580, y: 770 }, mapId as never).filter(site => !['speed', 'crit'].includes(site.definition?.reward.type ?? ''));
import { createGameBootstrap } from '../game/runtime/game-bootstrap';
import { ENEMY_TYPES, rewardAmountLabel } from '../game/enemies';
import { AUTO_FARM_CHOICE_KEY, AUTO_FARM_SHARES_KEY, AUTO_FARM_WEIGHTS_KEY } from '../game/runtime/auto-farm/auto-farm-plan';
import { soulCampName, SOUL_ENEMY_SPECIES } from '../game/soul-world';
import { SOUL_MAP_ID, SOUL_STAT_DETAILS, type SoulStatId } from '../../shared/soul-dimension';
import { researchStatRewardMultiplier } from '../../shared/research';
import { prestigeStatMultiplier } from '../../shared/prestige';
import { AGGRO_GROUPS, writeAggroPicks } from '../game/runtime/auto-farm/aggro-picks';

let destroy: (() => void) | undefined;
afterEach(() => { destroy?.(); destroy = undefined; vi.unstubAllGlobals(); });
/** The panel's view of a controller; tests swap in the members they steer. */
type FarmOverrides = Partial<{ moveStatus: () => string; moveReady: () => boolean; pullLimit: () => number; chasingGroupKeys: () => string[] }>;
function memoryStorage(values = new Map<string, string>()) {
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function setup(empty = false, map = "forest", overrides: FarmOverrides = {}, storage = memoryStorage(), extra: Partial<Parameters<typeof createAutoFarmPanel>[0]> = {}) {
  const { document, window } = parseHTML('<html><body><div id="hud"><div id="chatPanel"></div></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('HTMLElement', window.HTMLElement);
  const state = createGameBootstrap();
  state.enemies.length = 0;
  state.spawnSites.length = 0;
  if (!empty) state.spawnSites.push({ id: 1, type: 'Bramble', x: 1200, y: 500, campName: 'Test', leashRange: 500, alive: false, respawnAt: 50 });
  let unavailable: string | null = null, visible = true;
  let showBase = false;
  let rewardMultiplier = 1;
  let damageBonus = 1;
  const farm = Object.assign(createAutoFarmController({ ...state, mapId: () => map, unavailable: () => unavailable, paused: () => false, speed: () => 300, obstacles: () => [], pullCamps: overrides.pullLimit }), overrides);
  const pause = vi.fn(), clearInput = vi.fn();
  const panel = createAutoFarmPanel({ farm, mapName: () => 'Tutorial Forest', visible: () => visible,
    unavailable: () => unavailable, setPaused: pause, clearInput,
    rewardMultiplier: () => rewardMultiplier, showBaseStatRewards: () => showBase,
    rewardAmount: (type, amount) => showBase ? amount : amount * rewardMultiplier * (type === 'damage' ? damageBonus : 1),
    storage: () => storage, ...extra });
  destroy = panel.destroy;
  const sheet = document.querySelector<HTMLElement>('#autoFarmSheet')!;
  const content = sheet.querySelector<HTMLElement>('.farm-card-content')!;
  const click = (selector: string) => document.querySelector(selector)!.dispatchEvent(new window.Event('click', { bubbles: true }));
  return { ...state, farm, panel, document, window, sheet, content, pause, clearInput, click, storage,
    setUnavailable: (value: string | null) => { unavailable = value; }, setVisible: (value: boolean) => { visible = value; },
    setShowBase: (value: boolean) => { showBase = value; }, setRewardMultiplier: (value: number) => { rewardMultiplier = value; },
    setDamageBonus: (value: number) => { damageBonus = value; } };
}
type Mode = 'off' | 'farm' | 'aggro';
/** Each stat's mode as its Off · Farm · Aggro buttons show it. */
const modes = (s: ReturnType<typeof setup>) => Object.fromEntries([...s.document.querySelectorAll<HTMLElement>('.farm-weights [data-group]')]
  .map(row => [row.dataset.group!, row.querySelector('[data-mode][aria-checked="true"]')?.getAttribute('data-mode') as Mode]));
/** Taps a stat's mode button. */
const setMode = (s: ReturnType<typeof setup>, key: string, mode: Mode) => s.click(`[data-group="${key}"] [data-mode="${mode}"]`);
const modeButton = (s: ReturnType<typeof setup>, key: string, mode: Mode) => s.document.querySelector<HTMLButtonElement>(`[data-group="${key}"] [data-mode="${mode}"]`)!;
it('opens with every stat on Farm, sets each Off, Farm or Aggro with a tap, starts farming, and stops from the card', () => {
  const s = setup(true, 'endless_1');
  s.spawnSites.push(...fourStatSites('endless_1'));
  s.click('.farm-toggle');
  expect(!s.content.hidden).toBe(true);
  // No sliders and no percentages: three buttons a stat.
  expect(s.document.querySelector('.farm-weights input')).toBeNull();
  const keys = Object.keys(modes(s));
  expect(keys.length).toBe(4);
  expect(Object.values(modes(s))).toEqual(['farm', 'farm', 'farm', 'farm']);
  expect([...s.document.querySelectorAll(`[data-group="${keys[0]}"] [data-mode]`)].map(button => button.textContent)).toEqual(['Off', 'Farm', 'Aggro']);
  for (const key of [keys[0], keys[2], keys[3]]) setMode(s, key, 'off');
  expect(modes(s)).toEqual({ [keys[0]]: 'off', [keys[1]]: 'farm', [keys[2]]: 'off', [keys[3]]: 'off' });
  expect(s.document.querySelector(`[data-group="${keys[0]}"]`)!.classList.contains('is-off')).toBe(true);
  s.click('.farm-start');
  expect(!s.content.hidden).toBe(false);
  expect(s.farm.state()).toMatchObject({ active: true, selected: keys[1], shares: { [keys[1]]: 100 } });
  expect(s.document.querySelector('.farm-badge')!.textContent).toBe('Autofarm: On');
  expect(s.document.querySelector('.farm-toggle')!.getAttribute('aria-expanded')).toBe('false');
  // Tapped while farming it opens the window, farming on and unpaused; Stop ends it.
  s.pause.mockClear();
  s.click('.farm-toggle');
  expect(!s.content.hidden).toBe(true);
  expect(s.farm.state().active).toBe(true);
  expect(s.pause).not.toHaveBeenCalledWith(true);
  expect(s.document.querySelector('.farm-close')!.textContent).toBe('Stop');
  expect(s.document.querySelector('.farm-start')!.textContent).toBe('Go');
  s.click('.farm-close');
  expect(s.farm.state().active).toBe(false);
  expect(!s.content.hidden).toBe(false);
});
it('opened while farming, Go keeps farming, applying mode changes; the window shows the live switch lines', () => {
  const s = setup(true, 'endless_1');
  s.spawnSites.push(...fourStatSites('endless_1'));
  s.click('.farm-toggle');
  const keys = Object.keys(modes(s));
  s.click('.farm-start');
  expect(s.farm.state().active).toBe(true);
  s.pause.mockClear();
  s.click('.farm-toggle');
  expect(!s.content.hidden).toBe(true);
  expect(s.pause).not.toHaveBeenCalled();
  // Go with nothing changed: still farming, same shares.
  s.click('.farm-start');
  expect(!s.content.hidden).toBe(false);
  expect(s.farm.state()).toMatchObject({ active: true, shares: { [keys[0]]: 25 } });
  // Changed: farming goes on with the new modes.
  s.click('.farm-toggle');
  for (const key of keys.slice(1)) setMode(s, key, 'off');
  s.click('.farm-start');
  expect(s.farm.state()).toMatchObject({ active: true, shares: { [keys[0]]: 100 } });
  // Closed from outside (Escape): farming goes on.
  s.click('.farm-toggle');
  s.sheet.dispatchEvent(Object.assign(new s.window.Event('keydown'), { key: 'Escape' }));
  expect(!s.content.hidden).toBe(false);
  expect(s.farm.state().active).toBe(true);
});
it('draws one row per stat, in its colour; with every one Off there is nothing to start', () => {
  const s = setup(true, 'endless_1');
  s.spawnSites.push(...fourStatSites('endless_1'));
  s.click('.farm-toggle');
  const rows = [...s.document.querySelectorAll<HTMLElement>('.farm-weights [data-group]')];
  expect(rows.length).toBe(s.farm.choices().length);
  expect(rows.every(row => row.style.getPropertyValue('--farm-stat-color'))).toBe(true);
  for (const row of rows) setMode(s, row.dataset.group!, 'off');
  expect(s.document.querySelector<HTMLButtonElement>('.farm-start')!.disabled).toBe(true);
  expect(s.document.querySelector('.farm-selection')!.textContent).toBe('Set A Stat To Farm Or Aggro');
  setMode(s, rows[0].dataset.group!, 'farm');
  expect(s.document.querySelector<HTMLButtonElement>('.farm-start')!.disabled).toBe(false);
});
it('remembers the modes for the next window, reading the old sliders and 0-200% weights as Farm or Off', () => {
  const s = setup(true, 'endless_1');
  s.spawnSites.push(...fourStatSites('endless_1'));
  vi.stubGlobal('localStorage', s.storage);
  // The old 0-200% weights: Damage at 200%, one at 0%, the rest never set (100%): above 0 is Farm.
  const keys = s.farm.choices().map(choice => choice.key), zero = keys.find(key => key !== 'stat:damage')!;
  s.storage.setItem(AUTO_FARM_WEIGHTS_KEY, JSON.stringify({ auto: false, weights: { 'stat:damage': 200, [zero]: 0 } }));
  s.click('.farm-toggle');
  expect(modes(s)).toEqual(Object.fromEntries(keys.map(key => [key, key === zero ? 'off' : 'farm'])));
  setMode(s, zero, 'farm');
  setMode(s, 'stat:damage', 'off');
  s.click('.farm-start');
  const saved = JSON.parse(s.storage.values.get(AUTO_FARM_SHARES_KEY)!);
  expect(saved).toEqual(Object.fromEntries(keys.map(key => [key, key === 'stat:damage' ? 0 : 1])));
  s.click('.farm-toggle');
  expect(modes(s)).toEqual(Object.fromEntries(keys.map(key => [key, key === 'stat:damage' ? 'off' : 'farm'])));
  // A slider saved before 0.901.64 at 40% opens as Farm, one at 0% as Off.
  s.click('.farm-close');
  s.storage.setItem(AUTO_FARM_SHARES_KEY, JSON.stringify(Object.fromEntries(keys.map((key, index) => [key, index ? 0 : 40]))));
  s.farm.stop();
  s.click('.farm-toggle');
  expect(Object.values(modes(s))).toEqual(keys.map((_key, index) => index ? 'off' : 'farm'));
});
it('canceling the picker preserves the selected enemy without starting farming', () => {
  const s = setup(); s.farm.start('Bramble'); s.farm.stop();
  s.click('.farm-toggle');
  s.sheet.dispatchEvent(Object.assign(new s.window.Event('keydown', { cancelable: true }), { key: 'Escape' }));
  expect(!s.content.hidden).toBe(false);
  expect(s.pause).not.toHaveBeenCalled();
  expect(s.farm.state()).toMatchObject({ active: false, selected: 'stat:health' });
});
it('explains an empty map and disables starting when gameplay becomes unavailable', () => {
  const s = setup(true); s.click('.farm-toggle');
  expect(s.document.querySelector<HTMLElement>('.farm-empty')!.hidden).toBe(false);
  expect(s.document.querySelector('.farm-empty')!.textContent).toContain('No Enemies Here');
  expect(s.document.querySelector<HTMLButtonElement>('.farm-start')!.disabled).toBe(true);
  expect(s.document.querySelector<HTMLElement>('.farm-weights')!.hidden).toBe(true);
  expect(s.document.querySelector<HTMLElement>('.farm-stats-heading')!.hidden).toBe(true);
  s.setUnavailable('Equip a weapon to farm'); s.panel.refresh();
  expect(s.document.querySelector('.farm-selection')!.textContent).toBe('Equip a weapon to farm');
  s.setVisible(false); s.panel.refresh();
  expect(s.sheet.hidden).toBe(true);
  s.setVisible(true); s.panel.refresh();
  expect(s.sheet.hidden).toBe(false);
  expect(s.content.hidden).toBe(false);
  expect(s.pause).not.toHaveBeenCalled();
});

it('shows four reward stats for a generated map with one species, without enemy counts', () => {
  const s = setup(true, 'endless_1');
  s.spawnSites.push(...fourStatSites('endless_1'));
  s.click('.farm-toggle');
  const choices = [...s.document.querySelectorAll<HTMLElement>('[data-group]')];
  expect(choices).toHaveLength(4);
  const damage = choices.find(row => row.querySelector('.farm-weight-label')?.textContent === 'Damage')!;
  expect(damage.textContent).not.toContain('enemies');
  expect(damage.querySelector('.farm-weight-sub')!.textContent).toContain('–');
  expect(s.document.querySelector('.farm-weights')!.textContent).not.toContain('Attack Speed');
  for (const row of choices) if (row !== damage) setMode(s, row.dataset.group!, 'off');
  s.click('.farm-start');
  expect(s.farm.targetType()).toBe('stat:damage');
});
it('shows earned research and prestige rewards by default, then base rewards when selected', () => {
  const s = setup();
  const base = ENEMY_TYPES.Bramble.reward;
  const multiplier = researchStatRewardMultiplier({ foraging: 5, prosperity: 4 }) * prestigeStatMultiplier(2);
  s.setRewardMultiplier(multiplier);
  s.click('.farm-toggle');
  const displayedReward = () => s.document.querySelector('[data-group] .farm-weight-sub')!.textContent;
  expect(displayedReward()).toBe(rewardAmountLabel({ ...base, amount: base.amount * multiplier }));
  s.setShowBase(true);
  s.panel.refresh();
  expect(displayedReward()).toBe(rewardAmountLabel(base));
  s.setShowBase(false);
  s.panel.refresh();
  expect(displayedReward()).toBe(rewardAmountLabel({ ...base, amount: base.amount * multiplier }));
});

it('shows damage rewards after a 75% damage bonus when base rewards are off', () => {
  const s = setup();
  s.spawnSites[0].type = 'Spitter';
  s.setRewardMultiplier(1.2);
  s.setDamageBonus(1.75);
  s.click('.farm-toggle');
  const reward = ENEMY_TYPES.Spitter.reward;
  expect(s.document.querySelector('[data-group] .farm-weight-sub')!.textContent).toBe(rewardAmountLabel({ ...reward, amount: reward.amount * 1.2 * 1.75 }));
  s.setShowBase(true);
  s.panel.refresh();
  expect(s.document.querySelector('[data-group] .farm-weight-sub')!.textContent).toBe(rewardAmountLabel(reward));
});
it('switches the target priority from More and marks the chosen one', () => {
  const s = setup();
  s.click('.farm-toggle');
  expect(s.document.querySelector('[data-priority="closest"]')!.getAttribute('aria-checked')).toBe('true');
  s.click('[data-priority="strongest"]');
  expect(s.farm.priority()).toBe('strongest');
  expect(s.document.querySelector('[data-priority="strongest"]')!.getAttribute('aria-checked')).toBe('true');
  expect(s.document.querySelector('[data-priority="closest"]')!.getAttribute('aria-checked')).toBe('false');
});
it('leaves the map name and the long hint out, and names Move On', () => {
  const s = setup();
  s.click('.farm-toggle');
  expect(s.document.querySelector('.farm-map')).toBeNull();
  expect(s.sheet.textContent).not.toContain('Tutorial Forest');
  expect(s.sheet.textContent).not.toContain('Tap in order');
  expect(s.document.querySelector('[data-switch="advance"]')!.textContent).toContain('Move On');
  expect(s.sheet.textContent).not.toContain('Boss & Next Map');
  expect(s.document.querySelector('.farm-pull')).toBeNull();
  expect(s.document.querySelector('.farm-aggro-count')!.textContent).toBe('Aggro 0/1');
});
it('shows Move On with its status, the boss in the way included, lit only when the controller says it is going and the switch is on', () => {
  let move = 'Next Map At 1.20K', moveReady = false;
  const s = setup(false, 'forest', { moveStatus: () => move, moveReady: () => moveReady });
  s.farm.setAdvance(true);
  s.click('.farm-toggle');
  expect(s.document.querySelector('[data-switch="bosses"]')).toBeNull();
  const line = s.document.querySelector('[data-switch="advance"] .farm-boss-status')!;
  expect(s.document.querySelector('[data-switch="advance"]')!.getAttribute('aria-describedby')).toBe(line.id);
  expect(line.textContent).toBe('Next Map At 1.20K');
  expect(line.classList.contains('is-ready')).toBe(false);
  move = 'Fighting Boss'; moveReady = true; s.panel.refresh();
  expect(line.textContent).toBe('Fighting Boss');
  expect(line.classList.contains('is-ready')).toBe(true);
  move = 'Moving On'; s.panel.refresh();
  expect(line.textContent).toBe('Moving On');
  s.click('[data-switch="advance"]');
  expect(s.farm.advance()).toBe(false);
  expect(line.classList.contains('is-ready')).toBe(false);
  expect(line.classList.contains('is-idle')).toBe(true);
});
it('shows the Aggro buttons and Target in the window with no More to open, even when storage throws', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const s = setup(false, 'forest', {}, broken as unknown as ReturnType<typeof memoryStorage>);
  s.click('.farm-toggle');
  expect(s.document.querySelector('.farm-more-toggle')).toBeNull();
  expect(s.document.querySelector<HTMLElement>('.farm-more')!.hidden).toBe(false);
  expect(s.document.querySelector('[data-mode="aggro"]')).not.toBeNull();
  expect(s.document.querySelector('[data-priority]')).not.toBeNull();
  s.click('[data-mode="aggro"]');
  s.click('.farm-start');
  expect(s.farm.pulledGroupKeys()).toHaveLength(1);
});
it('puts any number of stats on Aggro, pulls up to its limit, counts them on top, and hides Aggro during an Aggro run', () => {
  let limit = 2;
  const s = setup(true, 'endless_1', { pullLimit: () => limit });
  s.spawnSites.push(...fourStatSites('endless_1'));
  s.click('.farm-toggle');
  const keys = Object.keys(modes(s));
  const count = () => s.document.querySelector<HTMLElement>('.farm-aggro-count')!;
  expect(count().textContent).toBe('Aggro 0/2');
  setMode(s, keys[2], 'aggro');
  setMode(s, keys[0], 'aggro');
  expect(count().textContent).toBe('Aggro 2/2');
  expect(modeButton(s, keys[0], 'aggro').getAttribute('aria-checked')).toBe('true');
  // Any number can be on; it still pulls two at once, the third waiting its turn (amber, said on screen).
  setMode(s, keys[1], 'aggro');
  expect(count().textContent).toBe('Aggro 2/2 · 1 Waiting');
  expect(keys.filter(key => modeButton(s, key, 'aggro').classList.contains('is-waiting'))).toHaveLength(1);
  s.click('.farm-start');
  expect(new Set(s.farm.aggroGroupKeys())).toEqual(new Set([keys[0], keys[1], keys[2]]));
  expect(s.farm.pulledGroupKeys()).toHaveLength(2);
  // Farm and Aggro together: it farms the Farm stat and fights what it pulls as it comes.
  expect(s.farm.state().shares).toMatchObject({ [keys[3]]: 100 / 4 });
  limit = 0; s.panel.refresh();
  s.click('.farm-toggle');
  expect(count().hidden).toBe(true);
  expect(modeButton(s, keys[0], 'aggro').hidden).toBe(true);
});
it('has no Push setting, and keeps Target under More', () => {
  const s = setup();
  s.click('.farm-toggle');
  expect(s.document.querySelector('.farm-push')).toBeNull();
  expect(s.document.querySelector('[data-push]')).toBeNull();
  const more = s.document.querySelector('.farm-more')!;
  expect(more.querySelector('.farm-target')).not.toBeNull();
  expect([...s.document.querySelectorAll('.farm-body > [data-switch]')].map(entry => entry.getAttribute('data-switch'))).toEqual(['advance']);
});
it('outside a run, with nothing on Farm and some on Aggro, it pulls those and stands still (Vis)', () => {
  const s = setup(true, 'endless_1', { pullLimit: () => 1 });
  s.spawnSites.push(...fourStatSites('endless_1'));
  vi.stubGlobal('localStorage', s.storage);
  s.click('.farm-toggle');
  const keys = Object.keys(modes(s));
  for (const key of keys) setMode(s, key, 'off');
  const start = s.document.querySelector<HTMLButtonElement>('.farm-start')!;
  expect(start.disabled).toBe(true);
  setMode(s, keys[1], 'aggro');
  expect(start.disabled).toBe(false);
  expect(s.document.querySelector('.farm-selection')!.textContent).toBe('Nothing On Farm: Pulls Your Aggro Stats And Stands Still');
  s.click('.farm-start');
  expect(s.farm.state().active).toBe(true);
  expect(s.farm.pulledGroupKeys()).toEqual([keys[1]]);
  // The modes stay for the next window (BillyBigBalls: "it always goes back up").
  s.farm.stop();
  s.click('.farm-toggle');
  expect(Object.values(modes(s))).toEqual(keys.map(key => key === keys[1] ? 'aggro' : 'off'));
});
it('keeps the modes as left when the window closes without starting', () => {
  const s = setup(true, 'endless_1');
  s.spawnSites.push(...fourStatSites('endless_1'));
  vi.stubGlobal('localStorage', s.storage);
  s.click('.farm-toggle');
  const keys = Object.keys(modes(s));
  for (const key of keys) setMode(s, key, 'off');
  s.click('.farm-close');
  s.click('.farm-toggle');
  expect(Object.values(modes(s))).toEqual(keys.map(() => 'off'));
  setMode(s, keys[0], 'farm');
  setMode(s, keys[1], 'aggro');
  s.click('.farm-close');
  s.click('.farm-toggle');
  expect(modes(s)).toMatchObject({ [keys[0]]: 'farm', [keys[1]]: 'aggro', [keys[2]]: 'off' });
});
it('in an Aggro run, with nothing on Farm it starts on the chasing groups alone', () => {
  const storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  writeAggroPicks('me', AGGRO_GROUPS);
  let chasing: string[] = [];
  const s = setup(false, 'forest', { chasingGroupKeys: () => chasing }, storage, { aggro: () => ({ active: true, completed: 0 }), identity: () => 'me' });
  s.click('.farm-toggle');
  const key = Object.keys(modes(s))[0];
  chasing = [key];
  setMode(s, key, 'off');
  const start = s.document.querySelector<HTMLButtonElement>('.farm-start')!;
  expect(start.disabled).toBe(false);
  expect(s.document.querySelector('.farm-selection')!.textContent).toBe('Nothing On Farm: Fights Only What Chases You');
  s.click('.farm-start');
  expect(s.farm.state().active).toBe(true);
  // With nothing chasing here, nothing on Farm still asks for a stat.
  s.farm.stop(); chasing = []; s.click('.farm-toggle'); setMode(s, key, 'off');
  expect(start.disabled).toBe(true);
});
it('during an Aggro run the button opens the farm window, with Stop, and Chasing Groups opens the picker', () => {
  let active = true;
  // Picks already made, so the picker does not open by itself.
  const storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  writeAggroPicks('me', AGGRO_GROUPS);
  const s = setup(false, 'forest', {}, storage, { aggro: () => ({ active, completed: 0 }), identity: () => 'me' });
  s.farm.start(s.farm.savedShares());
  s.click('.farm-toggle');
  expect(!s.content.hidden).toBe(true);
  expect(s.document.querySelector<HTMLElement>('.aggro-pick-overlay')?.hidden ?? true).toBe(true);
  expect(s.document.querySelector('.farm-close')!.textContent).toBe('Stop');
  expect(s.document.querySelector<HTMLElement>('.farm-aggro-row')!.hidden).toBe(false);
  // Chasing Groups trades the window for the picker, whose Target is the window's own.
  s.click('.farm-aggro-pick');
  expect(!s.content.hidden).toBe(false);
  expect(s.document.querySelector<HTMLElement>('.aggro-pick-overlay')!.hidden).toBe(false);
  s.click('.aggro-pick-target [data-priority="lowest"]');
  expect(s.farm.priority()).toBe('lowest');
  s.click('.aggro-pick-done');
  // Stop ends it in a run, as anywhere. (F's capture-phase listener is beyond linkedom.)
  s.click('.farm-toggle');
  s.click('.farm-close');
  expect(s.farm.state().active).toBe(false);
  // After the run, no Chasing Groups row.
  active = false;
  s.click('.farm-toggle');
  expect(s.document.querySelector<HTMLElement>('.farm-aggro-row')!.hidden).toBe(true);
  expect(s.document.querySelector('#autoFarmSheet .farm-target [data-priority="lowest"]')!.getAttribute('aria-checked')).toBe('true');
});
it('in the Soul Dimension draws a row per soul stat present, in its soul colour, with its flat reward', () => {
  const s = setup(true, SOUL_MAP_ID);
  const soul = (stat: SoulStatId, camp: number) => s.spawnSites.push({ id: s.spawnSites.length, type: SOUL_ENEMY_SPECIES[stat], x: 900, y: 500 + camp * 40,
    campName: soulCampName(stat, { key: `forest:${camp}` }), leashRange: 500, alive: false, respawnAt: 50,
    definition: { ...ENEMY_TYPES[SOUL_ENEMY_SPECIES[stat]], reward: { type: 'damage', amount: 0 } } });
  soul('damage', 0); soul('damage', 1); soul('attackSpeed', 2); soul('critDamage', 3);
  // Rewards shown grown would mislead: soul rewards are flat.
  s.setRewardMultiplier(7);
  // The controller keeps the player's choice in localStorage; this one is an old campaign route.
  vi.stubGlobal('localStorage', s.storage);
  s.storage.setItem(AUTO_FARM_CHOICE_KEY, JSON.stringify(['stat:speed', 'stat:health']));
  s.click('.farm-toggle');
  const row = (stat: SoulStatId) => s.document.querySelector<HTMLElement>(`[data-group="soul:${stat}"]`)!;
  expect([...s.document.querySelectorAll<HTMLElement>('.farm-weights [data-group]')].map(entry => entry.dataset.group))
    .toEqual(['soul:damage', 'soul:attackSpeed', 'soul:critDamage']);
  for (const stat of ['damage', 'attackSpeed', 'critDamage'] as const) {
    expect(row(stat).querySelector('.farm-weight-label')!.textContent).toBe(SOUL_STAT_DETAILS[stat].label);
    expect(row(stat).style.getPropertyValue('--farm-stat-color')).toBe(SOUL_STAT_DETAILS[stat].color);
  }
  expect(row('damage').querySelector('.farm-weight-sub')!.textContent).toBe('+1');
  expect(row('attackSpeed').querySelector('.farm-weight-sub')!.textContent).toBe('+0.001/s');
  expect(row('critDamage').querySelector('.farm-weight-sub')!.textContent).toBe('+0.002×');
  // The campaign's Attack Speed pick opens as Soul Attack Speed on Farm; what it left unpicked is Off.
  expect(modes(s)).toEqual({ 'soul:damage': 'off', 'soul:attackSpeed': 'farm', 'soul:critDamage': 'off' });
  setMode(s, 'soul:critDamage', 'farm');
  s.click('.farm-start');
  expect(s.farm.state()).toMatchObject({ active: true, shares: { 'soul:attackSpeed': 50, 'soul:critDamage': 50, 'soul:damage': 0 } });
});
it('the ? opens a page saying what each control does in place of the settings; Back returns to them, then closes', () => {
  const s = setup();
  s.click('.farm-toggle');
  const help = s.document.querySelector<HTMLElement>('.farm-help')!, body = s.document.querySelector<HTMLElement>('.farm-body')!;
  const toggle = s.document.querySelector('.farm-help-toggle')!;
  expect(help.hidden).toBe(true);
  s.click('.farm-help-toggle');
  expect(help.hidden).toBe(false);
  expect(body.hidden).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  // Every control in the window is explained.
  const terms = [...help.querySelectorAll('dt')].map(term => term.textContent);
  expect(terms).toEqual(['Stats', 'Move On', 'Deaths', 'Aggro', 'Target']);
  expect([...help.querySelectorAll('dd')].every(line => (line.textContent ?? '').length > 10)).toBe(true);
  s.click('.farm-close');
  expect(!s.content.hidden).toBe(true);
  expect(help.hidden).toBe(true);
  expect(body.hidden).toBe(false);
  s.click('.farm-close');
  expect(!s.content.hidden).toBe(false);
  // Reopened, it starts on the settings even if it was closed from the help page.
  s.click('.farm-toggle');
  s.click('.farm-help-toggle');
  s.panel.close();
  s.click('.farm-toggle');
  expect(help.hidden).toBe(true);
  expect(body.hidden).toBe(false);
});

it('Move At, the one slider, sits under Move On: 0.1x to 10x, 2x until set, lit with it on', () => {
  const s = setup();
  s.click('.farm-toggle');
  expect(s.document.querySelector('.farm-boss-power')).toBeNull();
  const row = s.document.querySelector<HTMLElement>('.farm-move-power')!, slider = row.querySelector('input')!;
  expect(row.previousElementSibling!.getAttribute('data-switch')).toBe('advance');
  expect(row.querySelector('output')!.textContent).toBe('2x');
  expect(slider.getAttribute('min')).toBe('0');
  expect(slider.getAttribute('max')).toBe('10');
  expect(slider.disabled).toBe(false);
  expect(row.classList.contains('is-off')).toBe(true);
  s.click('[data-switch="advance"]');
  expect(row.classList.contains('is-off')).toBe(false);
  slider.value = '8';
  slider.dispatchEvent(new s.window.Event('input', { bubbles: true }));
  expect(s.farm.movePower()).toBe(3);
  expect(row.querySelector('output')!.textContent).toBe('3x');
  slider.value = '0';
  slider.dispatchEvent(new s.window.Event('input', { bubbles: true }));
  expect(s.farm.movePower()).toBe(.1);
  expect(slider.getAttribute('aria-valuetext')).toBe('0.1x');
});


it('collapsed is a small "Autofarm: Off" card; opened it is a fixed window over a backdrop that closes it, never pausing the game', () => {
  const s = setup();
  expect(s.sheet.parentElement?.id).toBe('hud');
  expect(s.sheet.tagName).toBe('SECTION');
  const help = s.document.querySelector<HTMLElement>('.farm-help-toggle')!, backdrop = s.document.querySelector<HTMLElement>('.farm-window-backdrop')!;
  expect(s.content.hidden).toBe(true);
  expect(s.sheet.classList.contains('farm-card')).toBe(true);
  expect(s.document.querySelector('.farm-badge')!.textContent).toBe('Autofarm: Off');
  expect(s.document.querySelector('.farm-swords-icon')).toBeNull();
  // The "?" belongs to the window only.
  expect(help.hidden).toBe(true);
  expect(backdrop.hidden).toBe(true);
  s.click('.farm-toggle');
  expect(s.content.hidden).toBe(false);
  expect(s.sheet.classList.contains('is-window')).toBe(true);
  expect(s.sheet.classList.contains('farm-card')).toBe(false);
  expect(help.hidden).toBe(false);
  expect(backdrop.hidden).toBe(false);
  expect(s.pause).not.toHaveBeenCalled();
  backdrop.dispatchEvent(new s.window.Event('click', { bubbles: true }));
  expect(s.content.hidden).toBe(true);
  expect(s.sheet.classList.contains('farm-card')).toBe(true);
  expect(backdrop.hidden).toBe(true);
});

it('always starts collapsed, even if it was left open before', () => {
  const s = setup(false, 'forest', {}, memoryStorage(new Map([['wildstat:autofarm-expanded:v1', '1']])));
  expect(s.content.hidden).toBe(true);
});

it('collapsing the header preserves a running farm and keeps its status visible', () => {
  const s = setup();
  s.click('.farm-toggle'); s.click('.farm-start');
  s.click('.farm-toggle'); s.click('.farm-toggle');
  expect(s.content.hidden).toBe(true);
  expect(s.farm.state().active).toBe(true);
  expect(s.document.querySelector('.farm-badge')!.textContent).toBe('Autofarm: On');
});

it('F starts Auto Farm with the sliders last set and stops it, but not while typing', () => {
  const s = setup();
  const press = (target: EventTarget = s.document.body) => target.dispatchEvent(Object.assign(new s.window.Event('keydown', { bubbles: true, cancelable: true }), { code: 'KeyF' }));
  press();
  expect(s.farm.state().active).toBe(true);
  expect(s.document.querySelector('.farm-badge')!.textContent).toBe('Autofarm: On');
  press();
  expect(s.farm.state().active).toBe(false);
  const input = s.document.createElement('input'); s.document.body.append(input);
  press(input);
  expect(s.farm.state().active).toBe(false);
});

it('F on a map with nothing to farm opens the window instead', () => {
  const s = setup(true);
  s.document.body.dispatchEvent(Object.assign(new s.window.Event('keydown', { bubbles: true, cancelable: true }), { code: 'KeyF' }));
  expect(s.farm.state().active).toBe(false);
  expect(s.content.hidden).toBe(false);
});

it('keeps a slider while its reward grows behind the open window', () => {
  const s = setup();
  s.click('.farm-toggle');
  const before = s.document.querySelector('[data-group] input');
  s.setRewardMultiplier(5); s.panel.refresh();
  expect(s.document.querySelector('[data-group] input')).toBe(before);
});

it('the opened window takes its own touches: the HUD passes them through, and they fell to the backdrop and closed it', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync('public/assets/wildstat/auto-farm.css', 'utf8');
  const rule = css.slice(css.indexOf('#autoFarmSheet.is-window {'), css.indexOf('}', css.indexOf('#autoFarmSheet.is-window {')));
  expect(rule).toContain('pointer-events: auto');
});

it('shows On with Stop while it waits to carry on after a map change, and Stop cancels the carry-on', () => {
  const s = setup();
  // The controller's own test covers getting here; this is how the panel shows it.
  let waiting = true;
  const real = { state: s.farm.state, stop: s.farm.stop };
  s.farm.state = () => ({ ...real.state(), active: false, waiting });
  s.farm.stop = (...args) => { waiting = false; real.stop(...args); };
  s.panel.refresh();
  expect(s.document.querySelector('.farm-badge')!.textContent).toBe('Autofarm: On');
  s.click('.farm-toggle');
  expect(s.document.querySelector('.farm-close')!.textContent).toBe('Stop');
  s.click('.farm-close');
  expect(waiting).toBe(false);
  expect(s.document.querySelector('.farm-badge')!.textContent).toBe('Autofarm: Off');
});
