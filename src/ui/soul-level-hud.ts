import { formatCompactNumber as compactNumber } from "../../shared/compact-number";

export type SoulLevelProgress = { level: number; xp: number; needed: number; multiplier: number; max: boolean };

/** The Soul Level's lines as the HUD and the portal's window show them. */
export function soulLevelText(progress: SoulLevelProgress) {
  const exact = (value: number) => Math.floor(value).toLocaleString("en-US");
  return {
    level: `Soul Lv ${progress.level}`,
    rewards: `${progress.multiplier}×`,
    xp: progress.max ? "Max Level" : `${exact(progress.xp)} / ${exact(progress.needed)} Soul XP`,
    shortXp: progress.max ? "Max Level" : `${compactNumber(progress.xp)} / ${compactNumber(progress.needed)}`,
    fill: progress.max ? 1 : progress.needed > 0 ? Math.max(0, Math.min(1, progress.xp / progress.needed)) : 0,
  };
}

/** An XP bar: a track and its fill. */
export function soulLevelBar(fill: number) {
  const bar = document.createElement("span");
  bar.className = "soul-level-bar";
  bar.setAttribute("aria-hidden", "true");
  const inner = document.createElement("span");
  inner.style.width = `${Math.round(fill * 1000) / 10}%`;
  bar.append(inner);
  return bar;
}

/**
 * The Soul Level in the column under the minimap while in the Soul Dimension, beside the
 * Tech and Slot timers: level, reward multiplier, and the XP bar toward the next level.
 */
export function createSoulLevelHud() {
  let chip: HTMLElement | null = null;
  let shown = "";

  function element() {
    if (chip?.isConnected) return chip;
    const column = document.querySelector(".hud-timer-column") ?? document.querySelector(".minimap-meta");
    if (!column) return null;
    chip = document.createElement("div");
    chip.className = "hud-progress-timer hud-soul-level";
    chip.setAttribute("role", "status");
    chip.hidden = true;
    column.prepend(chip);
    shown = "";
    return chip;
  }

  function render(progress: SoulLevelProgress | null) {
    const target = element();
    if (!target) return;
    const key = progress ? `${progress.level}:${progress.xp}:${progress.needed}:${progress.multiplier}` : "";
    if (key === shown) return;
    shown = key;
    target.hidden = !progress;
    if (!progress) return;
    const text = soulLevelText(progress);
    const head = document.createElement("span");
    head.className = "hud-soul-level-head";
    const level = document.createElement("span");
    level.textContent = text.level;
    const rewards = document.createElement("strong");
    rewards.textContent = text.rewards;
    head.append(level, rewards);
    const xp = document.createElement("span");
    xp.className = "hud-soul-level-xp";
    xp.textContent = text.shortXp;
    target.replaceChildren(head, soulLevelBar(text.fill), xp);
    target.setAttribute("aria-label", `${text.level}, rewards ${text.rewards}, ${text.xp}`);
  }

  return { render };
}
