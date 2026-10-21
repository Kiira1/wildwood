import type { SimPlayer } from "./sim";
import type { GameTab } from "./game";
import type { ScenarioPlayer, ScenarioWorld } from "./server";

/** Helpers for the Auto Farm, Prestige, Research and Tutorial scenarios. */

/** Distance between two points. */
export const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** The sim player takes a hit that kills it, as an enemy's would. */
export function killSimPlayer(sim: SimPlayer) {
  sim.parts.player.hurtClock = 0;
  sim.parts.playerCombat().damagePlayer(sim.parts.player.maxHp * 100);
}

/** Seconds farmed per stat group on a map, from the sim's report ("stat:health" → seconds). */
export function farmedSeconds(sim: SimPlayer, mapId = sim.mapId()) {
  const out: Record<string, number> = {};
  for (const [key, seconds] of Object.entries(sim.report().groups)) {
    const [map, group] = key.split("|");
    if (map === mapId) out[group] = (out[group] ?? 0) + seconds;
  }
  return out;
}

/** The living enemies of a farm group ("stat:health"), as the farm groups them. */
export function groupEnemies(sim: SimPlayer, group: string) {
  const kinds = sim.parts.autoFarm().choices().find(choice => choice.key === group)?.kinds ?? [];
  return sim.parts.enemies.filter(enemy => !enemy.dead && kinds.includes(enemy.type));
}

/** The camp sites of a farm group: where its enemies stand and respawn. */
export function groupSites(sim: SimPlayer, group: string) {
  const kinds = sim.parts.autoFarm().choices().find(choice => choice.key === group)?.kinds ?? [];
  return sim.parts.spawnSites.filter(site => kinds.includes(site.type));
}

/** How far the player stands from the nearest camp site of a group. */
export function fromCamp(sim: SimPlayer, group: string) {
  return Math.min(...groupSites(sim, group).map(site => distance(site, sim.parts.player)));
}

/** Where the server has the player (what everyone else sees); null while the player is out of the world. */
export function serverPosition(world: ScenarioWorld, player: ScenarioPlayer) {
  const row = world.db.player.identity.find(player.identity);
  return row ? { x: row.x as number, y: row.y as number, mapId: row.mapId as string } : null;
}

/** A tap on the first element matching a selector, as the player's finger would land it. */
export function tapSelector(tab: GameTab, selector: string) {
  const target = tab.document.querySelector(selector) as HTMLElement | null;
  if (!target) throw new Error(`Nothing matches ${selector}`);
  if ((target as HTMLButtonElement).disabled) throw new Error(`${selector} is disabled`);
  for (const type of ["pointerdown", "pointerup", "click"]) target.dispatchEvent(new (tab.window as any).Event(type, { bubbles: true }));
}

/** Presses and releases a key on the page (the Auto Farm key is F). */
export function pressKey(tab: GameTab, code: string) {
  tab.key(code, "keydown", tab.document as unknown as EventTarget);
  tab.key(code, "keyup", tab.document as unknown as EventTarget);
}

/** A number as the HUD shows it ("+1.21k", "0.2", "58 (0.72/s)"): its value, sign kept. */
export function shownNumber(text: string | null | undefined) {
  const match = /([+\u2212-]?)([\d.,]+)\s*([kKmMbBtT]?)/.exec(text ?? "");
  if (!match) return NaN;
  const scale = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[match[3].toLowerCase() as "" | "k" | "m" | "b" | "t"];
  return (match[1] && match[1] !== "+" ? -1 : 1) * Number(match[2].replace(/,/g, "")) * scale;
}

/** The stat tracker card's rows: each stat's current value, gain and gain an hour, as shown; null while the card is hidden. */
export function statTracker(tab: GameTab) {
  const card = tab.document.querySelector<HTMLElement>(".stat-tracker:not(.stat-tracker-settings)");
  if (!card || card.hidden) return null;
  const rows = Object.fromEntries([...card.querySelectorAll<HTMLElement>("tr[data-stat]")].filter(row => !row.hidden).map(row => {
    const [current, gain, perHour] = [...row.querySelectorAll("td")].map(cell => shownNumber(cell.textContent));
    return [row.dataset.stat!, { current, gain, perHour }];
  }));
  const [hours, minutes, seconds] = (card.querySelector(".stat-tracker-time")?.textContent ?? "0:0:0").split(":").map(Number);
  return { rows, seconds: hours * 3600 + minutes * 60 + seconds };
}

/** Opens the Prestige window's Challenge tab from the player's profile. */
export async function openChallenges(tab: GameTab) {
  tab.tap("playerHudProfileIcon");
  await tab.play(300);
  tab.tap("prestigeBtn");
  await tab.play(300);
  tab.tap("prestigeChallengeTabBtn");
  await tab.play(300);
}

/** Answers the game's confirm dialog: Accept (true) or Cancel. */
export function answerConfirm(tab: GameTab, accept = true) {
  if (!tab.shown("gameConfirm")) throw new Error("No confirm dialog is open");
  tapSelector(tab, accept ? "#gameConfirm .game-confirm-accept" : "#gameConfirm .game-confirm-cancel");
}
