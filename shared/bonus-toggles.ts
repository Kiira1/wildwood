/**
 * Bonus toggles: each player can switch bonuses off, one at a time or a whole
 * group at once, to play (and test a change) as an account without them,
 * without making a new one. In the profile, as a dropdown a group.
 *
 * Off plays as if the player did not have the bonus: combat, kill rewards,
 * duels and power all leave it out, the server's as well as the client's.
 * Nothing is spent or lost: switching it back on brings it all back, and what
 * was earned meanwhile is kept. Toggles cannot change during a challenge or a
 * duel. Gear and guild bonuses are not toggles.
 *
 * What is off is stored as a set of item ids ("prestige.keenEdge",
 * "research.warcraft"…); anything not in it is on, so an item added later
 * starts on. Research that only saves waiting (offline time, slot speed,
 * research speed) is not a toggle. A Reflect Only win's attacks a second,
 * already added to the run, stay under the base cap with Reflect Only off.
 */
import type { PrestigePerkRanks } from "./prestige-perks";

export const BONUS_GROUP_IDS = ["prestige", "challenge", "research", "soul"] as const;
export type BonusGroupId = typeof BONUS_GROUP_IDS[number];
export type BonusItem = { id: string; label: string; detail: string };

const PERKS: readonly [keyof PrestigePerkRanks, string, string][] = [
  ["keenEdge", "Keen Edge", "Crit chance and crit damage"], ["doubleStrike", "Double Strike", "Hits that land twice"],
  ["splitShot", "Split Shot", "Hits that reach a second enemy"], ["riposte", "Reflect", "Damage thrown back"],
  ["bossSlayer", "Boss Slayer", "Damage to bosses"], ["secondWind", "Second Wind", "Heal on kills"],
  ["longShot", "Long Shot", "Attack range"], ["fleetFoot", "Fleet Foot", "Move speed"], ["quickDraw", "Quick Draw", "Attack speed cap"],
];
/** The research that changes combat or farming, by its player_research column. */
const RESEARCH: readonly [string, string, string][] = [
  ["foraging", "Foraging", "Stat gain"], ["prosperity", "Prosperity", "Stat gain"], ["warcraft", "Warcraft", "Damage"],
  ["vitality", "Vitality", "Max health"], ["precision", "Precision", "Armor"], ["regeneration", "Regeneration", "Regen"],
  ["criticalChance", "Critical Chance", "Crit chance"], ["criticalDamage", "Critical Damage", "Crit damage"], ["critCap", "Crit Cap", "Crit damage cap"],
  ["moveSpeed", "Move Speed", "Move speed"], ["utilityMoveSpeed", "Swiftness", "Move speed"], ["utilityAttackRange", "Attack Range", "Attack range"],
  ["enemyRespawn", "Enemy Respawn", "Enemies come back sooner"], ["bossRespawn", "Boss Respawn", "Bosses come back sooner"],
];
/** Soul stats, by their player_soul_stats column. */
const SOUL: readonly [string, string][] = [
  ["damage", "Damage"], ["maxHp", "Health"], ["armor", "Armor"], ["regen", "Regen"], ["attackSpeed", "Attack Speed"], ["critDamage", "Crit Damage"],
];

export const BONUS_GROUPS: Readonly<Record<BonusGroupId, { label: string; detail: string; items: readonly BonusItem[] }>> = {
  prestige: { label: "Prestige", detail: "Prestige stat gain and perks", items: [
    { id: "prestige.statGain", label: "Stat Gain", detail: "More stats a kill for each prestige level" },
    ...PERKS.map(([perk, label, detail]) => ({ id: `prestige.${perk}`, label, detail })),
  ] },
  challenge: { label: "Challenge Rewards", detail: "What challenge wins give", items: [
    { id: "challenge.reflect", label: "Reflect Only", detail: "The higher attack speed cap" },
    { id: "challenge.aggro", label: "Aggro", detail: "Pull camps for Auto Farm" },
  ] },
  research: { label: "Research", detail: "Tech tree bonuses; timers stay on", items: RESEARCH.map(([column, label, detail]) => ({ id: `research.${column}`, label, detail })) },
  soul: { label: "Soul Stats", detail: "Everything from the Soul Dimension", items: SOUL.map(([column, label]) => ({ id: `soul.${column}`, label, detail: `Soul ${label}` })) },
};
export const BONUS_ITEM_IDS: readonly string[] = BONUS_GROUP_IDS.flatMap(group => BONUS_GROUPS[group].items.map(item => item.id));
const KNOWN = new Set(BONUS_ITEM_IDS);

/** What is off, as stored: known item ids, comma separated, in a fixed order. "" is everything on. */
export function parseBonusOff(text: string | null | undefined): Set<string> {
  return new Set(String(text ?? "").split(",").map(id => id.trim()).filter(id => KNOWN.has(id)));
}
export function serializeBonusOff(off: Iterable<string>): string {
  const set = new Set(off);
  return BONUS_ITEM_IDS.filter(id => set.has(id)).join(",");
}

export type BonusOff = ReadonlySet<string>;
export const bonusOn = (off: BonusOff, id: string) => !off.has(id);
/** A group's switch: on with every item on, off with every item off, mixed between. */
export function bonusGroupState(off: BonusOff, group: BonusGroupId): "on" | "off" | "mixed" {
  const items = BONUS_GROUPS[group].items, count = items.filter(item => off.has(item.id)).length;
  return count === 0 ? "on" : count === items.length ? "off" : "mixed";
}
export function withBonus(off: BonusOff, ids: readonly string[], on: boolean): Set<string> {
  const next = new Set(off);
  for (const id of ids) if (on) next.delete(id); else next.add(id);
  return next;
}
export const bonusGroupIds = (group: BonusGroupId) => BONUS_GROUPS[group].items.map(item => item.id);

// ---- What each switch takes out ----

/** Prestige stat gain counts. */
export const prestigeStatGainOn = (off: BonusOff) => !off.has("prestige.statGain");
export const reflectRewardsOn = (off: BonusOff) => !off.has("challenge.reflect");
export const aggroPullOn = (off: BonusOff) => !off.has("challenge.aggro");

/** Perk ranks with every switched-off perk at zero. */
export function perksInPlayFor<T extends Partial<PrestigePerkRanks>>(ranks: T, off: BonusOff): T {
  if (!off.size) return ranks;
  const next: Record<string, unknown> = { ...ranks };
  for (const [perk] of PERKS) if (off.has(`prestige.${perk}`) && perk in next) next[perk] = 0;
  return next as T;
}
/** A research row with every switched-off research at rank zero; none stays none. */
export function researchInPlayFor<T extends object>(row: T | null | undefined, off: BonusOff): T | null | undefined {
  if (!row || !off.size) return row;
  const next = { ...row } as Record<string, unknown>;
  for (const [column] of RESEARCH) if (off.has(`research.${column}`) && column in next) next[column] = 0;
  return next as T;
}
/** Soul stats with every switched-off stat at zero. */
export function soulInPlayFor<T extends object>(soul: T, off: BonusOff): T {
  if (!off.size) return soul;
  const next = { ...soul } as Record<string, unknown>;
  for (const [column] of SOUL) if (off.has(`soul.${column}`) && column in next) next[column] = 0;
  return next as T;
}
