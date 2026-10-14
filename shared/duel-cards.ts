import { CARD_EFFECT_DEFAULTS, cardChance, cardValue, cardTotals, type CardTotals } from "./card-effects";
import { regularEnemySeededUnit } from "./regular-enemy-simulation";
import { itemDefinition } from "./items";

/** Duels since this combat version play the worn cards (duel-combat.ts). */
export const DUEL_CARDS_VERSION = 9;

export type DuelSide = "challenger" | "opponent";

/** What a duel snapshot freezes of each side's cards: the card ids worn, and the first hit's factor for Iaido. */
export type DuelCardFields = {
  challengerCards?: readonly string[]; opponentCards?: readonly string[];
  /** A first hit's damage over an average one: the crit multiplier over the averaged crit, with Iaido; one without. */
  challengerFirstHit?: number; opponentFirstHit?: number;
};

type DamageOverTime = { dps: number; until: number };
export type DuelSideCards = {
  /** One burn and one poison at a time: a new one keeps the stronger damage and the later end, as in the world. */
  shield: number; lastHitAt: number; lastStandUsed: boolean; dots: { burn?: DamageOverTime; poison?: DamageOverTime };
  /** What this side's own attacks are lowered by, and until when: stunned, slowed and weakened by the other side. */
  stunUntil: number; slow: { share: number; until: number }; weaken: { share: number; until: number };
};
export type DuelCardState = Record<DuelSide, DuelSideCards>;

const other = (side: DuelSide): DuelSide => side === "challenger" ? "opponent" : "challenger";
const roll = (seed: string, side: DuelSide, attack: number, key: string) => regularEnemySeededUnit("duel-card", seed, side, attack, key);

export function duelCardTotals(duel: DuelCardFields, side: DuelSide): CardTotals {
  return cardTotals((side === "challenger" ? duel.challengerCards : duel.opponentCards) ?? []);
}

const shieldMax = (totals: CardTotals, maxHp: number) => Math.max(0, cardValue(totals, "shield")) / 100 * maxHp;

export function initialDuelCardState(duel: DuelCardFields & { challengerMaxHp: number; opponentMaxHp: number }): DuelCardState {
  const side = (who: DuelSide): DuelSideCards => ({
    shield: shieldMax(duelCardTotals(duel, who), who === "challenger" ? duel.challengerMaxHp : duel.opponentMaxHp),
    lastHitAt: -Infinity, lastStandUsed: false, dots: {}, stunUntil: -Infinity,
    slow: { share: 0, until: -Infinity }, weaken: { share: 0, until: -Infinity },
  });
  return { challenger: side("challenger"), opponent: side("opponent") };
}

/** A weapon's mode, for the guards a hit from it meets. */
const ranged = (weapon: string | undefined) => itemDefinition(weapon)?.weapon?.mode === "RANGED";

/**
 * One duel attack with cards in: the attacker's raw hit before the defender's armor, and whether it lands at all.
 * Execute, opener and berserk read health as the fight stands; Iaido makes the first hit a full critical; a
 * stunned attacker's hit does nothing, and a slowed or weakened one is that much softer.
 */
export function duelCardAttack(duel: DuelCardFields & { riposteSeed?: number | bigint }, cards: DuelCardState, attacker: DuelSide, attack: number,
  raw: number, now: number, health: { attacker: number; attackerMax: number; defender: number; defenderMax: number }) {
  const totals = duelCardTotals(duel, attacker), self = cards[attacker];
  if (now < self.stunUntil) return 0;
  let bonus = 0;
  if (health.defender < health.defenderMax * CARD_EFFECT_DEFAULTS.execute.below) bonus += cardValue(totals, "execute");
  if (health.defender >= health.defenderMax * .999) bonus += cardValue(totals, "opener");
  if (health.attacker < health.attackerMax * CARD_EFFECT_DEFAULTS.berserk.below) bonus += cardValue(totals, "berserk");
  let hit = raw * (1 + Math.max(0, bonus) / 100);
  if (attack === 1) hit *= Math.max(1, (attacker === "challenger" ? duel.challengerFirstHit : duel.opponentFirstHit) ?? 1);
  if (now < self.slow.until) hit *= 1 - self.slow.share;
  if (now < self.weaken.until) hit *= 1 - self.weaken.share;
  return hit;
}

/**
 * The defender's cards against a hit through armor: a dodge (null), then the guard for the attacker's weapon, then
 * the shield, which refills a quiet spell after the last hit. Returns what reaches health and what the cards took.
 */
export function duelCardDefend(duel: DuelCardFields & { riposteSeed?: number | bigint; challengerWeaponItem?: string; opponentWeaponItem?: string },
  cards: DuelCardState, defender: DuelSide, attack: number, dealt: number, now: number, maxHp: number) {
  const totals = duelCardTotals(duel, defender), self = cards[defender];
  if (roll(String(duel.riposteSeed ?? 0), defender, attack, "dodge") * 100 < cardChance(totals, "dodge")) return null;
  const attackerWeapon = defender === "challenger" ? duel.opponentWeaponItem : duel.challengerWeaponItem;
  const guard = Math.min(60, Math.max(0, cardValue(totals, ranged(attackerWeapon) ? "rangedGuard" : "meleeGuard")));
  let left = dealt * (1 - guard / 100);
  if (now - self.lastHitAt >= totals.timing.shield) self.shield = shieldMax(totals, maxHp);
  self.lastHitAt = now;
  const soaked = Math.min(self.shield, left);
  self.shield -= soaked;
  left -= soaked;
  return { taken: left, blocked: dealt - left };
}

/**
 * After a hit lands: the attacker's lifesteal and procs, and the defender's Last Stand, Panic Heal and Web.
 * Returns the defender's and attacker's health after them.
 */
export function duelCardAfterHit(duel: DuelCardFields & { riposteSeed?: number | bigint }, cards: DuelCardState, attacker: DuelSide, attack: number,
  raw: number, taken: number, now: number, hp: { attacker: number; attackerMax: number; defender: number; defenderMax: number }) {
  const seed = String(duel.riposteSeed ?? 0), defender = other(attacker);
  const offense = duelCardTotals(duel, attacker), defense = duelCardTotals(duel, defender);
  let { attacker: attackerHp, defender: defenderHp } = hp;
  const steal = Math.max(0, cardValue(offense, "lifesteal"));
  if (steal > 0 && attackerHp > 0) attackerHp = Math.min(hp.attackerMax, attackerHp + taken * steal / 100);
  const lastStand = Math.max(0, cardValue(defense, "lastStand"));
  if (defenderHp <= 0 && lastStand > 0 && !cards[defender].lastStandUsed) {
    cards[defender].lastStandUsed = true;
    defenderHp = hp.defenderMax * Math.min(100, lastStand) / 100;
  }
  const panic = CARD_EFFECT_DEFAULTS.panicHeal;
  if (defenderHp > 0 && defenderHp < hp.defenderMax * panic.below && roll(seed, defender, attack, "panic") * 100 < cardChance(defense, "panicHeal")) {
    defenderHp = Math.min(hp.defenderMax, defenderHp + hp.defenderMax * panic.heal);
  }
  const web = Math.max(0, cardValue(defense, "web"));
  if (web > 0) cards[attacker].slow = { share: Math.max(cards[attacker].slow.share, Math.min(.9, web / 100)), until: Math.max(cards[attacker].slow.until, now + defense.timing.web) };
  const target = cards[defender], defaults = CARD_EFFECT_DEFAULTS;
  const overTime = (kind: "burn" | "poison", dps: number, seconds: number) => {
    const current = target.dots[kind];
    target.dots[kind] = { dps: Math.max(dps, current && current.until > now ? current.dps : 0), until: Math.max(now + seconds, current?.until ?? now) };
  };
  offense.procs.forEach((proc, index) => {
    if (roll(seed, attacker, attack, `proc:${index}`) * 100 >= proc.chance) return;
    if (proc.effect === "burn") {
      const seconds = proc.seconds ?? defaults.burn.seconds;
      overTime("burn", raw * (proc.share ?? defaults.burn.share) / seconds, seconds);
    } else if (proc.effect === "poison") {
      overTime("poison", raw * defaults.poison.share / defaults.poison.seconds, defaults.poison.seconds);
      target.weaken = { share: Math.max(target.weaken.share, defaults.poison.weaken), until: Math.max(target.weaken.until, now + defaults.poison.seconds) };
    } else if (proc.effect === "chill") {
      target.slow = { share: Math.max(target.slow.share, defaults.chill.slow), until: Math.max(target.slow.until, now + defaults.chill.seconds) };
    } else if (proc.effect === "stun") target.stunUntil = Math.max(target.stunUntil, now + (proc.seconds ?? defaults.stun.seconds));
    else if (proc.effect === "weaken") {
      target.weaken = { share: Math.max(target.weaken.share, defaults.weaken.weaken), until: Math.max(target.weaken.until, now + defaults.weaken.seconds) };
    }
  });
  return { attackerHp, defenderHp };
}

/** Burn and poison on one side over a stretch of the fight: what they deal from `from` to `to` seconds. */
export function duelCardDamageOverTime(cards: DuelCardState, side: DuelSide, from: number, to: number) {
  const self = cards[side];
  let dealt = 0;
  for (const kind of ["burn", "poison"] as const) {
    const dot = self.dots[kind];
    if (!dot) continue;
    dealt += dot.dps * Math.max(0, Math.min(to, dot.until) - from);
    if (dot.until <= to) delete self.dots[kind];
  }
  return dealt;
}
