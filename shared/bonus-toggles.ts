/**
 * Bonus toggles: each player can switch whole groups of bonuses off, to play
 * (and test a change) as an account without them, without making a new one.
 * Players asked for it (Jasmean, Foxy, Oct 2026); Ryan put it in the profile.
 *
 * Off plays as if the player did not have the bonus: combat, kill rewards,
 * duels and power all leave it out, the server's as well as the client's.
 * Nothing is spent or lost: switching it back on brings it all back, and what
 * was earned meanwhile is kept. Toggles cannot change during a challenge or a
 * duel. Gear and guild bonuses are not toggles.
 *
 * - prestige: every prestige perk and the prestige stat gain.
 * - challenge: Reflect Only wins' attack speed cap, and Aggro wins' Pull camps.
 *   (The attacks a second a Reflect Only win added to the run stay, under the
 *   base cap.)
 * - research: the tech tree's combat and farming research (damage, health,
 *   armor, regen, crit, range, move speed, respawns, stat gain). Timers that
 *   only save waiting (offline window, upgrade speed) stay on.
 * - soul: every Soul Dimension stat.
 */
export const BONUS_TOGGLE_IDS = ["prestige", "challenge", "research", "soul"] as const;
export type BonusToggleId = typeof BONUS_TOGGLE_IDS[number];
/** true: the group is in play. */
export type BonusToggles = Record<BonusToggleId, boolean>;

export const ALL_BONUSES_ON: Readonly<BonusToggles> = Object.freeze({ prestige: true, challenge: true, research: true, soul: true });

export const BONUS_TOGGLE_DETAILS: Readonly<Record<BonusToggleId, { label: string; detail: string }>> = {
  prestige: { label: "Prestige", detail: "Every prestige perk and the prestige stat gain" },
  challenge: { label: "Challenge Rewards", detail: "Reflect Only's attack speed cap and Aggro's Pull camps" },
  research: { label: "Research", detail: "Tech tree combat and farming bonuses; timers stay on" },
  soul: { label: "Soul Stats", detail: "Everything from the Soul Dimension" },
};

/** The server row stores what is off, so a missing row (or a missing column) means everything is on. */
export type BonusToggleRow = { prestigeOff?: boolean; challengeOff?: boolean; researchOff?: boolean; soulOff?: boolean };

export function bonusTogglesFromRow(row: BonusToggleRow | null | undefined): BonusToggles {
  return { prestige: !row?.prestigeOff, challenge: !row?.challengeOff, research: !row?.researchOff, soul: !row?.soulOff };
}

export function bonusToggleRow(toggles: BonusToggles): Required<BonusToggleRow> {
  return { prestigeOff: !toggles.prestige, challengeOff: !toggles.challenge, researchOff: !toggles.research, soulOff: !toggles.soul };
}

export const allBonusesOn = (toggles: BonusToggles) => BONUS_TOGGLE_IDS.every(id => toggles[id]);
