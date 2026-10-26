import { installMovableHudCard } from "../../ui/movable-hud-card";
import { formatCompactNumber } from "../../ui/number-format";
import { requiredElement } from "./dom";

/** The local player's damage per second over the last few seconds, for the on-screen DPS readout. */
export const DPS_WINDOW_MS = 20_000;

type BowSource = 'bow-hit' | 'bow-storm' | 'bow-rocochet';
type SwordSource = 'sword-spin' | 'sword-wave' | 'sword-deflect' | 'sword-hit' | 'sword-cleave' | 'sword-split-shot';
type StaffSource = 'staff-direct' | 'staff-splash' | 'staff-chain' | 'staff-meteor';
type CardSource = 'card-koi' | 'card-splash' | 'card-chain' | 'card-reap' | 'card-burn' | 'card-poison' | 'card-reflect-splash';
export type DamageSource = BowSource | SwordSource | StaffSource | CardSource | 'reflect';

const damageSourceNames: Record<DamageSource, string> = {}; // TODO: actually fill out all the names for all the damage types instead of exposing the internal names

export function createDpsMeter(now: () => number = () => performance.now()) {
  const hits: { at: number; amount: number; source: DamageSource; }[] = [];
  const prune = (at: number) => { while (hits.length && at - hits[0].at > DPS_WINDOW_MS) hits.shift(); };
  function damageBreakdown() {
    const results: { damage: number, source: DamageSource }[] = [];
    const at = now();
    prune(at);
    if (!hits.length) return results;
    for (const hit of hits) {
      const relevantResult = results.find(r => r.source === hit.source);
      if (relevantResult) {
        relevantResult.damage += hit.amount;
      } else {
        results.push({ damage: hit.amount, source: hit.source });
      }
    }
    const seconds = Math.min(DPS_WINDOW_MS, Math.max(1_000, at - hits[0].at)) / 1_000;
    results.forEach(r => r.damage /= seconds);
    results.sort((a, b) => b.damage - a.damage);
    return results;
  }

  return {
    record(amount: number, source: DamageSource) {
      if (!(amount > 0) || !Number.isFinite(amount)) return;
      const at = now();
      prune(at);
      hits.push({ at, amount, source });
    },
    /** Damage in the window over the time it covers, at least a second, so a fight's first hits read true. */
    perSecond() {
      const at = now();
      prune(at);
      if (!hits.length) return 0;
      const seconds = Math.min(DPS_WINDOW_MS, Math.max(1_000, at - hits[0].at)) / 1_000;
      return hits.reduce((sum, hit) => sum + hit.amount, 0) / seconds;
    },
    installBreakdown() {
      const sheet = document.createElement('section');
      sheet.id = 'dpsBreakdownSheet';
      const rows = document.createElement('section');
      rows.id = 'dpsBreakdownRows';
      sheet.appendChild(rows);
      const hud = requiredElement('hud');
      hud.appendChild(sheet);
    },
    updateBreakdown() {
      const rows = document.getElementById('dpsBreakdownRows');
      if (!rows) return;
      const damageValues = damageBreakdown();
      while (rows.hasChildNodes()) rows.childNodes[0].remove();
      for (const { damage, source } of damageValues) {
        if (damage === 0) continue;
        const textLine = document.createElement('div');
        textLine.innerHTML = `<div id="damageSourceName">${damageSourceNames[source] ?? source}</div><div id="damageSourceValue">${formatCompactNumber(damage)}</div>`;
        rows.appendChild(textLine);
        const bar = element("span", "damage-source-bar");
        const inner = element("span", "");
        inner.style.width = `${damage / damageValues[0].damage * 100}%`;
        bar.append(inner);
        rows.append(bar);
      }
    },
  };
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** The game's own meter: the combat wiring records each hit, the HUD readout reads it. */
export const playerDps = createDpsMeter();
