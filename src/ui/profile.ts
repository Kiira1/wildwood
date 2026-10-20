import type { PlayerProfileData, PlayerResearch } from "../wildstat-coop";
import { createEmptyResearchRanks } from "../../shared/research";
import { PRESTIGE_PERKS, playerAttackCap, prestigePerkValue, type PrestigePerkRanks } from "../../shared/prestige-perks";
import { CRITICAL_DAMAGE_BASE, criticalDamageMultiplier } from "../../shared/critical-damage";
import { effectivePlayerPower } from "../../shared/player-power";
import { computePlayerStats, type PlayerStatInputs } from "../../shared/player-stats";
import { itemLevelFor, slotTierFor } from "../../shared/item-level";
import { formatCompactNumber, formatRate } from "./number-format";
import { attackSpeedLabel, attackSpeedRatingForInterval, critDamageLabel, type AttackCapArg } from "../../shared/stat-rating";
import { formatRating } from "./rating-text";
import { cleanSoulStats, withSoulStats, type SoulStats } from "../../shared/soul-dimension";
import { challengeMinimumInterval } from "../../shared/prestige-challenge";
import { cardStatFactors, cardTotals } from "../../shared/card-effects";
import { BASE_CARD_SLOTS, NO_ACTIVE_CARDS, activeCardSlots, activeCardsInPlay } from "../../shared/active-cards";
import { STAT_NAMES } from "../../shared/card-text";

export function formatPlayedTime(seconds: number) {
  const wholeMinutes = Math.max(0, Math.floor(seconds / 60));
  const days = Math.floor(wholeMinutes / 1440);
  const hours = Math.floor(wholeMinutes % 1440 / 60);
  const minutes = wholeMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function profilePresenceText(online: boolean, lastSeenAtMs: number) {
  if (online) return "Online";
  if (!Number.isFinite(lastSeenAtMs) || lastSeenAtMs <= 0) return "LAST SEEN —";
  const lastSeen = new Date(lastSeenAtMs);
  const options: Intl.DateTimeFormatOptions = lastSeen.getFullYear() === new Date().getFullYear()
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric" };
  return `LAST SEEN ${lastSeen.toLocaleString([], options).toUpperCase()}`;
}

/**
 * A profile's stats as shared/player-stats.ts takes them: the saved run, its worn gear at each slot's tier
 * and the item's refine, and the active cards. `extra` adds the soul, perks, cap and stat gain parts.
 */
export function profileStatInputs(
  progress: PlayerProfileData["progress"],
  research: PlayerResearch = createEmptyResearchRanks(),
  itemUpgradeLevels: Record<string, number> = {},
  itemRefines: Record<string, number> = {},
  activeCards: readonly string[] = [],
  extra: Partial<PlayerStatInputs> = {},
): PlayerStatInputs {
  return {
    base: { maxHp: progress.maxHp, damage: progress.damage, armor: progress.armor, regen: progress.regen, attackInterval: progress.attackRate,
      attackRange: progress.attackRange, moveSpeed: progress.speedOverride > 0 ? progress.speedOverride : progress.speed, critRating: progress.critRating },
    loadout: { head: progress.equippedHead, chest: progress.equippedChest, feet: progress.equippedFeet ?? "",
      rightHand: progress.equippedRightHand, leftHand: progress.equippedLeftHand },
    // Tiers are keyed by slot, not by item: a lookup by item id missed every time and the panel showed bare gear.
    itemLevel: itemId => itemLevelFor(itemUpgradeLevels, itemRefines, itemId),
    research, cards: cardTotals(activeCards),
    // The profile has never counted Black Boots' flat speed (docs/player-stats.md, known disagreements).
    countBlackBoots: false,
    ...extra,
  };
}

/** A tier is the slot's, so resolve the item to its slot before looking up. */
export const slotUpgradeLevelFor = (itemUpgradeLevels: Record<string, number>, itemId: string) => slotTierFor(itemUpgradeLevels, itemId);

/**
 * Another player's soul stats in play, as combat counts them: all of them in a normal run, none while
 * their challenge (Reflect Only or Aggro) is active. The local player uses the Soul Dimension runtime's own.
 */
export function profileSoulInPlay(profile: PlayerProfileData): SoulStats | null {
  return profile.prestigeChallenge?.active || profile.aggroChallenge?.active ? null : profile.soulStats ?? null;
}

/** A profile's active cards in play: one of each type during an Aggro run, more with Card Slots perks. */
export function profileActiveCardIds(profile: Pick<PlayerProfileData, "activeCards" | "prestigePerks" | "aggroChallenge">) {
  return activeCardsInPlay(profile.activeCards ?? NO_ACTIVE_CARDS, profile.aggroChallenge?.active ? BASE_CARD_SLOTS : activeCardSlots(profile.prestigePerks));
}

/** A profile's active cards, totalled as combat totals them. */
function profileCardTotals(profile: PlayerProfileData) {
  return cardTotals(profileActiveCardIds(profile));
}

/** Another player's attack speed cap: their Reflect Only wins and Quick Draw, and the Quick Draw cards they wear. */
export function profileAttackCap(profile: PlayerProfileData) {
  const cap = playerAttackCap(profile.prestigeChallenge, profile.prestigePerks);
  const cards = cardStatFactors(profileCardTotals(profile)).attackCapRaise;
  return cards > 0 ? { ...cap, raise: cap.raise + cards } : cap;
}

/** The profile's power, with the soul stats in play added as combat adds them, and crits counted (critPowerFactor). */
export function profilePower(profile: PlayerProfileData, soul: Partial<SoulStats> | null = null) {
  const clean = cleanSoulStats(soul);
  const level = (itemId: string) => itemLevelFor(profile.itemUpgradeLevels, profile.itemRefines, itemId);
  const activeCards = profileActiveCardIds(profile);
  const cards = cardStatFactors(cardTotals(activeCards));
  const critChance = (profile.research?.criticalChance ?? 0) * .01 + prestigePerkValue(profile.prestigePerks, "keenEdge") + cards.critChance;
  const critMultiplier = criticalDamageMultiplier({ researchRank: profile.research?.criticalDamage, perks: profile.prestigePerks,
    soul: clean.critDamage, rating: profile.progress.critRating, capRank: profile.research?.critCap, card: cards.critDamage });
  return effectivePlayerPower(
    { ...withSoulStats(profile.progress, clean, challengeMinimumInterval(profile.prestigeChallenge)), critChance, critMultiplier, activeCards },
    profile.research,
    level,
  );
}

export type ProfileStatDisplaySource = {
  label: "Tech" | "Equipment" | "Slot Upgrade" | "Refine" | "Cards" | "Prestige" | "Guild" | "Soul" | "Class Set" | "Armor" | "Boots";
  value: string;
};

export type ProfileStatDisplayRow = {
  kind: string;
  label: string;
  base: string;
  equationOperator?: "×" | "+";
  equationTotal?: string;
  hideEquation?: boolean;
  multiplier: string;
  expandedDetail?: string;
  total: string;
  sources: ProfileStatDisplaySource[];
};

/** A row's soul share, as a source line, once there is one. */
const soulSource = (amount: number, format: (value: number) => string): ProfileStatDisplaySource[] =>
  amount > 0 ? [{ label: "Soul", value: `+${format(amount)}` }] : [];

export function profileStatDisplayRows(
  profile: PlayerProfileData,
  armorReduction: (armor: number) => string,
  attackCap: AttackCapArg,
  research?: PlayerResearch,
  prestigeLevel = profile.prestigeLevel ?? 0,
  perks: Partial<PrestigePerkRanks> | null | undefined = profile.prestigePerks,
  guildBonus = 1,
  soulStats: Partial<SoulStats> | null = null,
) {
  // Soul stats add to the run's base before any multiplier, as combat adds them,
  // so each row's base includes them and its sources say how much was soul.
  const soul = cleanSoulStats(soulStats);
  const progress = withSoulStats(profile.progress, soul, attackCap);
  const ranks = research ?? profile.research ?? createEmptyResearchRanks();
  const statValue = (value: number) => Math.abs(value) >= 1_000_000 ? formatCompactNumber(value) : Math.round(value).toLocaleString();
  const inputs = profileStatInputs(progress, ranks, profile.itemUpgradeLevels, profile.itemRefines, profileActiveCardIds(profile), {
    soul, attackCap, prestigeLevel, guildBonus,
    // Long Shot and Fleet Foot pay outside an Aggro run, as the server pays them; the other perks show as given.
    perks: profile.aggroChallenge?.active ? { ...perks, longShot: 0, fleetFoot: 0 } : perks,
  });
  const stats = computePlayerStats(inputs);
  const from = stats.sources;
  // A card source: what the active cards multiply a stat by, as a percent, a cost included.
  const cardSource = (factor: number): ProfileStatDisplaySource[] => {
    const percent = Math.round((factor - 1) * 10000) / 100;
    return percent ? [{ label: "Cards", value: `${percent > 0 ? "+" : ""}${percent}%` }] : [];
  };
  const multiplierValue = (value: number) => value.toFixed(2);
  const equipmentBonusValue = (value: number) => `+${Math.round(value * 10000) / 100}%`;
  const multiplierSources = (researchPercent?: number, gear?: { equipment: number; slotUpgrade: number; refine: number }): ProfileStatDisplaySource[] => {
    const sources: ProfileStatDisplaySource[] = [];
    if (researchPercent) sources.push({ label: "Tech", value: `+${researchPercent}%` });
    if (gear && gear.equipment > 0) sources.push({ label: "Equipment", value: equipmentBonusValue(gear.equipment) });
    // What the bench has paid for, listed on its own. Folded into Equipment it
    // was impossible to tell a slot upgrade had done anything at all.
    if (gear && gear.slotUpgrade > 0) sources.push({ label: "Slot Upgrade", value: equipmentBonusValue(gear.slotUpgrade) });
    // What the Smith's refines added on top, the same way.
    if (gear && gear.refine > 0) sources.push({ label: "Refine", value: equipmentBonusValue(gear.refine) });
    return sources;
  };
  const minAttackInterval = stats.capInterval, baseAttackInterval = stats.attackInterval;
  // Attack Speed is a rating on a curve that only closes in on the cap (shared/stat-rating.ts): the
  // expanded line names the rating behind the rate, as Armor names its Block, and "(Max)" shows once
  // the rate reads the same as the cap.
  const speedRating = attackSpeedRatingForInterval(baseAttackInterval, attackCap);
  // Attack speed and crit damage read like armor: their number, and what it gives in brackets. No "rating".
  const ratingText = formatRating;
  const bracket = (label: string) => `(${label.replace(" (Max)", " Max")})`;
  const baseAttackSpeed = attackSpeedLabel(1 / baseAttackInterval, 1 / minAttackInterval);
  const attackSpeed = `${stats.attackRate.toFixed(2)}/s`;
  // A sword reaches its own range, with the same Tech and Long Shot on top (weaponAttackRange); both are in the saved range.
  const reach = stats.range, baseRange = Math.max(1, reach - from.range.tech - from.range.prestige);
  const speed = from.moveSpeed;
  // Light armor walks faster and Heavy slower, a piece at a time (armor-class-perks.ts).
  const armorSource = (factor: number) =>
    factor !== 1 ? [{ label: "Armor" as const, value: `${factor > 1 ? "+" : ""}${Math.round((factor - 1) * 1000) / 10}%` }] : [];
  const bootsSource = (factor: number) => factor !== 1 ? [{ label: "Boots" as const, value: `+${Math.round((factor - 1) * 1000) / 10}%` }] : [];
  const rows: ProfileStatDisplayRow[] = [
    {
      kind: "health", label: "Max Hp:",
      // Saved health is the base: Vitality multiplies it live (0.883), it is not baked in.
      base: statValue(progress.maxHp),
      equationOperator: "×",
      multiplier: multiplierValue(stats.multipliers.maxHp),
      total: statValue(stats.maxHp),
      sources: [...soulSource(from.maxHp.soul, statValue), ...multiplierSources(from.maxHp.techPercent, from.maxHp), ...cardSource(from.maxHp.cards)],
    },
    {
      kind: "damage", label: "Damage:", base: statValue(progress.damage),
      equationOperator: "×",
      multiplier: multiplierValue(stats.multipliers.damage), total: statValue(stats.damage),
      sources: [...soulSource(from.damage.soul, statValue), ...multiplierSources(from.damage.techPercent, from.damage),
        ...(from.damage.classSet > 1 ? [{ label: "Class Set" as const, value: `+${Math.round((from.damage.classSet - 1) * 100)}%` }] : []), ...cardSource(from.damage.cards)],
    },
    {
      kind: "armor", label: "Armor:", base: statValue(progress.armor),
      equationOperator: "×",
      multiplier: multiplierValue(stats.multipliers.armor),
      expandedDetail: `(${armorReduction(stats.armor)} Block)`,
      total: statValue(stats.armor),
      sources: [...soulSource(from.armor.soul, statValue), ...multiplierSources(from.armor.techPercent), ...bootsSource(from.armor.boots), ...cardSource(from.armor.cards)],
    },
    {
      kind: "attack", label: "Attack Speed:", base: baseAttackSpeed,
      equationOperator: "×",
      multiplier: multiplierValue(1), total: ratingText(speedRating), equationTotal: attackSpeed,
      // The cap beside the rate, as critical damage shows its own: how close the player is to the fastest.
      expandedDetail: `${bracket(attackSpeedLabel(stats.attackRate, 1 / minAttackInterval))} · ${(1 / minAttackInterval).toFixed(2)}/s Cap`,
      // The soul's own share, which adds to the run's and is kept through prestige.
      // The soul adds attacks a second flat (soulAttackSpeedBonus), so its line is that, not a rating.
      sources: soulSource(from.attackSpeed.soul, value => Number.isFinite(value) ? `${value.toFixed(3)}/s` : "Max"),
    },
    {
      kind: "range", label: "Attack Range:", base: statValue(baseRange),
      equationOperator: "×",
      multiplier: multiplierValue(reach / baseRange), total: statValue(reach),
      sources: [...(from.range.tech ? [{ label: "Tech" as const, value: `+${from.range.tech} range` }] : []),
        ...(from.range.prestige ? [{ label: "Prestige" as const, value: `+${from.range.prestige} range` }] : [])],
    },
    {
      kind: "regen", label: "Regen:",
      base: `${formatRate(progress.regen)}/s`,
      equationOperator: "×",
      multiplier: multiplierValue(stats.multipliers.regen), total: `${formatRate(stats.regenPerSecond)}/s`,
      sources: [...soulSource(from.regen.soul, value => `${formatRate(value)}/s`), ...multiplierSources(from.regen.techPercent, from.regen),
        ...cardSource(from.regen.cards)],
    },
    {
      kind: "speed", label: "Move Speed:", base: statValue(inputs.base.moveSpeed),
      equationOperator: "×",
      multiplier: multiplierValue(stats.multipliers.moveSpeed),
      total: statValue(stats.moveSpeed),
      sources: [...multiplierSources(speed.techPercent), ...(speed.techFlat > 0 ? [{ label: "Tech" as const, value: `+${speed.techFlat} speed` }] : []),
        ...(speed.prestige ? [{ label: "Prestige" as const, value: `+${Math.round(speed.prestige * 1000) / 10}%` }] : []),
        ...(speed.cards ? [{ label: "Cards" as const, value: `+${Math.round(speed.cards * 1000) / 10}%` }] : []),
        ...armorSource(speed.armor), ...bootsSource(speed.boots)],
    },
  ];
  // Tech and prestige multiply each other, exactly as the server pays them, so
  // the total is the product rather than the two percentages added together.
  const { tech: techGain, prestige: prestigeGain, guild: guildGain, cards: cardGain, singleStat } = from.statGain;
  const percentPoints = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;
  // Both factors have whole-percent precision. Round their integer product
  // once so half-percent ties and the expanded/collapsed totals agree.
  const gainPercent = Math.round(Math.round(techGain * 100) * Math.round(prestigeGain * 100) / 100 * Math.round(guildGain * 100) / 100 * Math.round(cardGain * 100) / 100) - 100;
  rows.push({
    kind: "stat-gain", label: "Stat Gain:", base: techGain.toFixed(2),
    equationOperator: "×", multiplier: (prestigeGain * guildGain * cardGain).toFixed(2), total: `+${gainPercent}%`,
    equationTotal: `${((gainPercent + 100) / 100).toFixed(2)}×`,
    hideEquation: techGain <= 1 || prestigeGain * guildGain * cardGain <= 1,
    sources: [
      ...(techGain > 1 ? [{ label: "Tech" as const, value: `${techGain.toFixed(2)}×` }] : []),
      ...(prestigeGain > 1 ? [{ label: "Prestige" as const, value: `${prestigeGain.toFixed(2)}×` }] : []),
      ...(guildGain > 1 ? [{ label: "Guild" as const, value: `${guildGain.toFixed(2)}×` }] : []),
      // Active cards multiply on top: all-stat ones (Gravebloom) every reward, Bounty ones a single stat's.
      ...(cardGain > 1 ? [{ label: "Cards" as const, value: `${cardGain.toFixed(2)}×` }] : []),
      ...singleStat.map(([stat, value]) => ({ label: "Cards" as const, value: `+${Math.round(value * 10) / 10}% ${STAT_NAMES[stat as keyof typeof STAT_NAMES]}` })),
    ],
  });
  // Keen Edge pays critical chance and critical damage on top of research, so
  // both rows read as combat rolls them rather than showing research alone.
  const critChance = from.critChance;
  rows.push({
    kind: "critical", label: "Critical Chance:", base: "0%", equationOperator: "+", multiplier: percentPoints(stats.critChance), total: percentPoints(stats.critChance),
    sources: [
      ...(critChance.techPercent ? [{ label: "Tech" as const, value: `+${critChance.techPercent}%` }] : []),
      ...(critChance.prestige ? [{ label: "Prestige" as const, value: `+${percentPoints(critChance.prestige)}` }] : []),
      ...(critChance.cards ? [{ label: "Cards" as const, value: `+${percentPoints(critChance.cards)}` }] : []),
    ],
  });
  // A rating on a curve toward 100× (shared/stat-rating.ts): crit camps' rating, the soul's on top, then
  // research and Keen Edge, each a share closer. Combat stops at the cap (5×, 1× more a Crit Cap rank),
  // so the row does too, and says (Max) once it reads the same as the cap.
  const crit = from.critDamage;
  const shown = (value: number) => `+${value.toFixed(2)}×`;
  const bonusShare = (part: number) => crit.research + crit.perk > 0 ? crit.fromBonuses * part / (crit.research + crit.perk) : 0;
  rows.push({
    kind: "critical-damage", label: "Critical Damage:", base: `${CRITICAL_DAMAGE_BASE.toFixed(2)}×`, equationOperator: "+",
    multiplier: `${(crit.multiplier - CRITICAL_DAMAGE_BASE).toFixed(2)}×`, total: ratingText(crit.rating + crit.soul),
    equationTotal: `${crit.multiplier.toFixed(2)}×`, expandedDetail: `${bracket(critDamageLabel(crit.multiplier, crit.cap))} · ${crit.cap}× Cap`,
    sources: [
      ...(crit.research ? [{ label: "Tech" as const, value: shown(bonusShare(crit.research)) }] : []),
      ...(crit.perk ? [{ label: "Prestige" as const, value: shown(bonusShare(crit.perk)) }] : []),
      // The soul adds a flat multiplier (critical-damage.ts), so its line is that, not a rating.
      ...(crit.fromSoul > 0 ? [{ label: "Soul" as const, value: shown(crit.fromSoul) }] : []),
      ...(crit.fromCards > 0 ? [{ label: "Cards" as const, value: shown(crit.fromCards) }] : []),
    ],
  });
  // The remaining perks have no research behind them, so a row only appears
  // once a point is spent or a worn card gives the chance, which combat adds to the perk's.
  const perkRow = (perk: keyof PrestigePerkRanks, kind: string, expandedDetail: string, chances: { prestige: number; cards: number }) => {
    const { prestige: chance, cards: card } = chances;
    if (!chance && !card) return;
    rows.push({
      kind, label: `${PRESTIGE_PERKS[perk].title}:`, base: "0%", equationOperator: "+", multiplier: percentPoints(chance + card),
      expandedDetail, total: percentPoints(chance + card),
      sources: [...(chance ? [{ label: "Prestige" as const, value: `+${percentPoints(chance)}` }] : []),
        ...(card ? [{ label: "Cards" as const, value: `+${percentPoints(card)}` }] : [])],
    });
  };
  perkRow("doubleStrike", "double-strike", "(Chance a hit lands twice)", from.doubleStrike);
  perkRow("splitShot", "split-shot", "(Chance to strike a second enemy)", from.splitShot);
  perkRow("riposte", "riposte", "(Reflects 100% of each hit before armor, up to half your max health; no cap in Reflect Only; half in duels)", from.reflect);
  return rows;
}

export function renderProfileStats(
  profile: PlayerProfileData,
  statGrid: HTMLElement,
  armorReduction: (armor: number) => string,
  attackCap: AttackCapArg,
  research?: PlayerResearch,
  prestigeLevel = profile.prestigeLevel ?? 0,
  perks: Partial<PrestigePerkRanks> | null | undefined = profile.prestigePerks,
  guildBonus = 1,
  soulStats: Partial<SoulStats> | null = null,
) {
  const stats = profileStatDisplayRows(profile, armorReduction, attackCap, research, prestigeLevel, perks, guildBonus, soulStats);
  const expandedKinds = statGrid.dataset.identity === profile.identity
    ? new Set([...statGrid.querySelectorAll<HTMLElement>('[aria-expanded="true"]')].map((row) => row.dataset.stat))
    : new Set<string>();
  statGrid.dataset.identity = profile.identity;
  statGrid.replaceChildren();
  const columns = [0, 1].map(() => {
    const column = document.createElement("dl");
    column.className = "profile-grid profile-stat-column";
    statGrid.append(column);
    return column;
  });
  for (const [index, stat] of stats.entries()) {
    const item = document.createElement("div");
    item.className = `profile-stat-row profile-stat-${stat.kind}`;
    item.dataset.stat = stat.kind;
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-expanded", "false");
    const term = document.createElement("dt");
    const summary = document.createElement("dd");
    const base = document.createElement("span");
    const multiplyOperator = document.createElement("span");
    const multiplier = document.createElement("span");
    const equalsOperator = document.createElement("span");
    const totalGroup = document.createElement("span");
    const total = document.createElement("span");
    const sources = document.createElement("dd");
    term.textContent = stat.label;
    summary.className = "profile-stat-summary";
    base.className = "profile-stat-base";
    multiplyOperator.className = "profile-stat-equation-operator profile-stat-multiply";
    multiplier.className = "profile-stat-multiplier";
    equalsOperator.className = "profile-stat-equation-operator profile-stat-equals";
    totalGroup.className = "profile-stat-total-group";
    total.className = "profile-stat-total";
    base.textContent = stat.base;
    multiplyOperator.textContent = stat.equationOperator ?? "";
    multiplyOperator.setAttribute("aria-hidden", "true");
    multiplier.textContent = stat.multiplier;
    equalsOperator.textContent = "=";
    equalsOperator.setAttribute("aria-hidden", "true");
    total.textContent = stat.total;
    totalGroup.append(total);
    summary.append(totalGroup);
    sources.className = "profile-stat-sources";
    sources.hidden = true;
    const equation = document.createElement("span");
    equation.className = "profile-stat-equation";
    const detailedTotal = document.createElement("span");
    detailedTotal.textContent = stat.equationTotal ?? stat.total;
    equation.append(base, multiplyOperator, multiplier, equalsOperator, detailedTotal);
    if (!stat.hideEquation) sources.append(equation);
    if (stat.sources.length === 0 && !stat.expandedDetail) {
      const empty = document.createElement("span");
      empty.className = "profile-stat-source-empty";
      empty.textContent = "No bonuses";
      sources.append(empty);
    } else {
      stat.sources.forEach((source, index) => {
        if (index > 0) {
          const operator = document.createElement("span");
          operator.className = "profile-stat-source-operator";
          operator.setAttribute("aria-hidden", "true");
          operator.textContent = "·";
          sources.append(operator);
        }
        const sourceElement = document.createElement("span");
        sourceElement.className = "profile-stat-source";
        const sourceLabel = document.createElement("strong");
        sourceLabel.textContent = `${source.label}:`;
        sourceElement.append(sourceLabel, ` ${source.value}`);
        sources.append(sourceElement);
      });
      if (stat.expandedDetail && stat.sources.length > 0) {
        const separator = document.createElement("span");
        separator.className = "profile-stat-source-operator";
        separator.setAttribute("aria-hidden", "true");
        separator.textContent = "·";
        sources.append(separator);
      }
    }
    if (stat.expandedDetail) {
      const detail = document.createElement("span");
      detail.className = "profile-stat-expanded-detail";
      detail.textContent = stat.expandedDetail;
      sources.append(detail);
    }
    const sourceText = stat.sources.length > 0
      ? stat.sources.map((source) => `${source.label}: ${source.value}`).join("; ")
      : "No bonuses";
    const breakdownText = [stat.sources.length > 0 ? sourceText : "", stat.expandedDetail ?? ""]
      .filter(Boolean)
      .join(". ") || sourceText;
    const summaryText = stat.hideEquation ? `${stat.label} ${stat.total}.` : `${stat.label} Base ${stat.base}. Calculation ${stat.base} ${stat.equationOperator ?? ""} ${stat.multiplier}. Total ${stat.equationTotal ?? stat.total}.`;
    const setExpanded = (expanded: boolean) => {
      item.classList.toggle("is-expanded", expanded);
      item.setAttribute("aria-expanded", String(expanded));
      item.setAttribute("aria-label", expanded
        ? `${summaryText} Breakdown: ${breakdownText}. Activate to collapse.`
        : `${stat.label} ${stat.total}. Activate to show detailed stats.`);
      sources.hidden = !expanded;
    };
    item.addEventListener("click", () => setExpanded(item.getAttribute("aria-expanded") !== "true"));
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setExpanded(item.getAttribute("aria-expanded") !== "true");
    });
    setExpanded(expandedKinds.has(stat.kind));
    item.append(term, summary, sources);
    columns[index % columns.length].append(item);
  }
}
