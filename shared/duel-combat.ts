import { damageAfterArmor } from "./combat";
import { duelAttackDelays, type DuelWeapons } from "./duel-approach";
import { regularEnemySeededUnit } from "./regular-enemy-simulation";
import { RIPOSTE_REFLECT_SHARE } from "./prestige-perks";
import { marbleBagHit } from "./marble-bag";
import { ARROW_STORM_ARROWS, ARROW_STORM_DAMAGE_SHARE, DUEL_RICOCHET_REHITS, RICOCHET_DAMAGE_SHARE, type BowSkillId } from "./bow-skills";
import { SHOCKWAVE_DAMAGE_SHARE, WHIRLWIND_DAMAGE_SHARE, WHIRLWIND_TICKS, type SwordSkillId } from "./sword-skills";
import { itemDefinition } from "./items";
import {
  DUEL_CARDS_VERSION, duelCardAfterHit, duelCardAttack, duelCardDamageOverTime, duelCardDefend, initialDuelCardState,
  type DuelCardFields, type DuelCardState, type DuelSide,
} from "./duel-cards";

export type DuelFighter = { maxHp: number; damage: number; armor: number; regen: number; attackRate: number };
/**
 * 4: bow skills (Arrow Storm, Ricochet, Piercing Shot) roll in the fight.
 * 5: Riposte (Reflect) draws from a marble bag instead of a coin per hit.
 * 6: Riposte throws back half the hit before the defender's armor, not after.
 * 7: a thrown-back hit is capped at the reflecting player's max health (0.867).
 * 8: sword skills; projectile Deflect blocks and returns the ranged attack through its sender's armor.
 * 9: cards (duel-cards.ts).
 */
export const DUEL_COMBAT_VERSION = 9;
export const DUEL_SWORD_SKILLS_VERSION = 8;
export const DUEL_BOW_SKILLS_VERSION = 4;
export const DUEL_RIPOSTE_BAG_VERSION = 5;
export const DUEL_RIPOSTE_PRE_ARMOR_VERSION = 6;
export const DUEL_RIPOSTE_MAX_HP_VERSION = 7;
/** Half the hit, and since version 7 never more than the reflecting player's own max health. */
function riposteThrown(duel: DuelCombat, base: number, reflectorMaxHp: number) {
  const half = base * RIPOSTE_REFLECT_SHARE;
  return (duel.combatVersion ?? 0) >= DUEL_RIPOSTE_MAX_HP_VERSION ? Math.min(half, Math.max(0, reflectorMaxHp)) : half;
}
/** What Riposte throws back from one attack: the hit as it arrived since version 6, what got through before. */
function riposteBase(duel: DuelCombat, hit: { dealt: number; blocked: number }, taken: number) {
  return (duel.combatVersion ?? 0) >= DUEL_RIPOSTE_PRE_ARMOR_VERSION ? hit.dealt + hit.blocked : taken;
}
export function duelHitMultiplier(seconds: number, version = 0) {
  return version >= 1 ? 1 + Math.min(4, Math.max(0, seconds - 10) / 5) : 1;
}

export type DuelCombat = DuelWeapons & DuelCardFields & {
  combatVersion?: number;
  challengerMaxHp: number; challengerDamage: number; challengerArmor: number; challengerRegen: number; challengerAttackRate: number;
  opponentMaxHp: number; opponentDamage: number; opponentArmor: number; opponentRegen: number; opponentAttackRate: number;
  // Riposte chances and the seed their rolls come from. The seed is stored with
  // the duel so a replay rolls exactly what the server rolled.
  challengerRiposte?: number; opponentRiposte?: number; riposteSeed?: number | bigint;
  // Each duellist's equipped bow skills, as stored percentages (0 = none).
  // They roll from the same stored seed as Riposte, under their own salt.
  challengerArrowStorm?: number; challengerRicochet?: number; challengerPiercingShot?: number;
  opponentArrowStorm?: number; opponentRicochet?: number; opponentPiercingShot?: number;
  challengerWhirlwind?: number; challengerDeflect?: number; challengerShockwave?: number;
  opponentWhirlwind?: number; opponentDeflect?: number; opponentShockwave?: number;
};

const DUEL_SKILL_FIELDS = {
  challenger: { arrowStorm: "challengerArrowStorm", ricochet: "challengerRicochet", piercingShot: "challengerPiercingShot" },
  opponent: { arrowStorm: "opponentArrowStorm", ricochet: "opponentRicochet", piercingShot: "opponentPiercingShot" },
} as const;

const DUEL_SWORD_FIELDS = {
  challenger: { whirlwind: "challengerWhirlwind", deflect: "challengerDeflect", shockwave: "challengerShockwave" },
  opponent: { whirlwind: "opponentWhirlwind", deflect: "opponentDeflect", shockwave: "opponentShockwave" },
} as const;

export function duelSwordSkillProc(duel: DuelCombat, side: "challenger" | "opponent", attack: number, skill: SwordSkillId) {
  if ((duel.combatVersion ?? 0) < DUEL_SWORD_SKILLS_VERSION) return false;
  const percent = Number(duel[DUEL_SWORD_FIELDS[side][skill]] ?? 0);
  const chance = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) / 100 : 0;
  return chance > 0 && regularEnemySeededUnit("duel-sword-skill", String(duel.riposteSeed ?? 0), side, attack, skill) < chance;
}

/** Melee attacks cannot be deflected. Use the attacker count for each incoming projectile. */
export function duelDeflected(duel: DuelCombat, defender: "challenger" | "opponent", attack: number) {
  const attacker = defender === "challenger" ? "opponent" : "challenger";
  const weapon = duel[`${attacker}WeaponItem`] || duel[`${attacker}RightHandItem`] || duel[`${attacker}LeftHandItem`];
  return itemDefinition(weapon)?.weapon?.mode === "RANGED" && duelSwordSkillProc(duel, defender, attack, "deflect");
}

/**
 * Whether a duellist's bow skill fires on one of their attacks. Deterministic
 * like Riposte: the same duel, side, attack and skill always answer the same.
 * Fights recorded before bow skills existed never roll them.
 */
export function duelBowSkillProc(duel: DuelCombat, side: "challenger" | "opponent", attack: number, skill: BowSkillId) {
  if ((duel.combatVersion ?? 0) < DUEL_BOW_SKILLS_VERSION) return false;
  const percent = Number(duel[DUEL_SKILL_FIELDS[side][skill]] ?? 0);
  const chance = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) / 100 : 0;
  if (chance <= 0) return false;
  return regularEnemySeededUnit("duel-bow-skill", String(duel.riposteSeed ?? 0), side, attack, skill) < chance;
}

/**
 * One attack's damage against the defender's armor, with the attacker's bow
 * skills. One opponent means: Arrow Storm's extra arrows all hit them, each
 * through armor; Ricochet comes back off them for one more hit at its share;
 * Piercing Shot passes through their armor, so the arrow itself ignores it.
 */
function duelAttackDamage(duel: DuelCombat, side: "challenger" | "opponent", attack: number, raw: number, armor: number) {
  const arrowArmor = duelBowSkillProc(duel, side, attack, "piercingShot") ? 0 : armor;
  let dealt = damageAfterArmor(raw, arrowArmor), incoming = raw;
  if (duelBowSkillProc(duel, side, attack, "arrowStorm")) {
    const storm = raw * ARROW_STORM_DAMAGE_SHARE;
    dealt += ARROW_STORM_ARROWS * damageAfterArmor(storm, armor);
    incoming += ARROW_STORM_ARROWS * storm;
  }
  if (duelBowSkillProc(duel, side, attack, "ricochet")) {
    const bounce = raw * RICOCHET_DAMAGE_SHARE;
    dealt += DUEL_RICOCHET_REHITS * damageAfterArmor(bounce, arrowArmor);
    incoming += DUEL_RICOCHET_REHITS * bounce;
  }
  if (duelSwordSkillProc(duel, side, attack, "whirlwind")) {
    dealt += WHIRLWIND_TICKS * damageAfterArmor(raw * WHIRLWIND_DAMAGE_SHARE, armor);
    incoming += WHIRLWIND_TICKS * raw * WHIRLWIND_DAMAGE_SHARE;
  }
  if (duelSwordSkillProc(duel, side, attack, "shockwave")) {
    dealt += damageAfterArmor(raw * SHOCKWAVE_DAMAGE_SHARE, armor);
    incoming += raw * SHOCKWAVE_DAMAGE_SHARE;
  }
  return { dealt, blocked: Math.max(0, incoming - dealt) };
}

/**
 * Whether a hit is thrown back. Deterministic: the same duel, side and attack
 * always answer the same, so the server and every replay agree without either
 * carrying a list of rolls. Since version 5 the attack number is a draw from a
 * marble bag shuffled by the stored seed, so a duellist's Reflect lands at its
 * rate over any twenty hits rather than whenever a coin allows; fights
 * recorded earlier keep the coin, so their replays still agree.
 */
export function duelRiposted(duel: DuelCombat, side: "challenger" | "opponent", attack: number) {
  const chance = Math.max(0, Math.min(1, (side === "challenger" ? duel.challengerRiposte : duel.opponentRiposte) ?? 0));
  if (chance <= 0) return false;
  const seed = String(duel.riposteSeed ?? 0);
  if ((duel.combatVersion ?? 0) >= DUEL_RIPOSTE_BAG_VERSION) {
    // Attacks count from 1; the first one draws the first marble.
    return marbleBagHit(chance, attack - 1, (bag, slot) => regularEnemySeededUnit("duel-riposte-bag", seed, side, bag, slot));
  }
  return regularEnemySeededUnit("duel-riposte", seed, side, attack) < chance;
}
export type DuelCombatState = {
  challengerHp: number; opponentHp: number; challengerAttacks: number; opponentAttacks: number;
  challengerDamageDealt: number; opponentDamageDealt: number; challengerRegened: number; opponentRegened: number;
  challengerBlocked: number; opponentBlocked: number;
  /** The cards' running state (version 9): never stored, so a card duel is always resolved from its start. */
  cards?: DuelCardState;
};
export function initialDuelCombatState(duel: DuelCombat): DuelCombatState {
  return { challengerHp: duel.challengerMaxHp, opponentHp: duel.opponentMaxHp,
    challengerAttacks: 0, opponentAttacks: 0, challengerDamageDealt: 0, opponentDamageDealt: 0,
    challengerRegened: 0, opponentRegened: 0, challengerBlocked: 0, opponentBlocked: 0,
    // Only a fight with cards worn carries card state; one without plays exactly as version 8 did.
    ...((duel.combatVersion ?? 0) >= DUEL_CARDS_VERSION && (duel.challengerCards?.length || duel.opponentCards?.length)
      ? { cards: initialDuelCardState(duel) } : {}) };
}

const cloneSide = (side: DuelCardState["challenger"]) => ({ ...side, dots: { ...side.dots }, slow: { ...side.slow }, weaken: { ...side.weaken } });
const cloneCards = (cards: DuelCardState): DuelCardState => ({ challenger: cloneSide(cards.challenger), opponent: cloneSide(cards.opponent) });

/** One side's attack: its hit, the defender's Deflect, cards and Riposte, and what each side ends on. */
function resolveAttack(duel: DuelCombat, state: DuelCombatState, attacker: DuelSide, multiplier: number, now: number) {
  const defender: DuelSide = attacker === "challenger" ? "opponent" : "challenger";
  const attackKey = attacker === "challenger" ? "challengerAttacks" : "opponentAttacks";
  const attack = ++state[attackKey];
  const hp = (side: DuelSide) => side === "challenger" ? state.challengerHp : state.opponentHp;
  const setHp = (side: DuelSide, value: number) => { if (side === "challenger") state.challengerHp = value; else state.opponentHp = value; };
  const maxHp = (side: DuelSide) => side === "challenger" ? duel.challengerMaxHp : duel.opponentMaxHp;
  const dealtKey = (side: DuelSide) => side === "challenger" ? "challengerDamageDealt" as const : "opponentDamageDealt" as const;
  const blockedKey = defender === "challenger" ? "challengerBlocked" as const : "opponentBlocked" as const;
  const cards = state.cards;
  const health = () => ({ attacker: hp(attacker), attackerMax: maxHp(attacker), defender: hp(defender), defenderMax: maxHp(defender) });
  let raw = (attacker === "challenger" ? duel.challengerDamage : duel.opponentDamage) * multiplier;
  if (cards) raw = duelCardAttack(duel, cards, attacker, attack, raw, now, health());
  const hit = duelAttackDamage(duel, attacker, attack, raw, defender === "challenger" ? duel.challengerArmor : duel.opponentArmor);
  const deflected = duelDeflected(duel, defender, attack);
  const defended = cards && !deflected && hit.dealt > 0 ? duelCardDefend(duel, cards, defender, attack, hit.dealt, now, maxHp(defender)) : undefined;
  const landed = defended === null ? 0 : defended ? defended.taken : hit.dealt;
  const taken = deflected ? 0 : Math.min(hp(defender), landed);
  setHp(defender, hp(defender) - taken);
  state[dealtKey(attacker)] += taken;
  state[blockedKey] += hit.blocked + (deflected || defended === null ? hit.dealt : defended ? defended.blocked : 0);
  if (deflected) {
    const returned = Math.min(hp(attacker), damageAfterArmor(Math.min(hit.dealt + hit.blocked, maxHp(defender)),
      attacker === "challenger" ? duel.challengerArmor : duel.opponentArmor));
    setHp(attacker, hp(attacker) - returned);
    state[dealtKey(defender)] += returned;
  }
  if (cards && taken > 0) {
    const after = duelCardAfterHit(duel, cards, attacker, attack, raw, taken, now, health());
    setHp(attacker, after.attackerHp);
    setHp(defender, after.defenderHp);
  }
  if (taken > 0 && duelRiposted(duel, defender, attack)) {
    const thrown = Math.min(hp(attacker), riposteThrown(duel, riposteBase(duel, hit, taken), maxHp(defender)));
    setHp(attacker, hp(attacker) - thrown);
    state[dealtKey(defender)] += thrown;
  }
}

/** Raw earned stats, with simultaneous hits and identical microsecond rounding
 * on server, live presentation, and replay. No matchmaking stat normalization. */
export function advanceDuelCombat(
  duel: DuelCombat, previous: DuelCombatState, fromMicros: number, toMicros: number,
  limits: { challengerAttacks?: number; opponentAttacks?: number } = {},
) {
  const state = { ...previous, ...(previous.cards ? { cards: cloneCards(previous.cards) } : {}) };
  let resolvedMicros = Math.max(0, Math.round(fromMicros));
  const end = Math.max(resolvedMicros, Math.round(toMicros));
  const challengerInterval = Math.max(1, Math.round(duel.challengerAttackRate * 1_000_000));
  const opponentInterval = Math.max(1, Math.round(duel.opponentAttackRate * 1_000_000));
  const delays = duelAttackDelays(duel);
  const challengerDelay = Math.round(delays.challenger * 1_000_000);
  const opponentDelay = Math.round(delays.opponent * 1_000_000);

  while (resolvedMicros < end && state.challengerHp > 0 && state.opponentHp > 0) {
    const challengerNext = state.challengerAttacks < (limits.challengerAttacks ?? Infinity)
      ? challengerDelay + (state.challengerAttacks + 1) * challengerInterval : Infinity;
    const opponentNext = state.opponentAttacks < (limits.opponentAttacks ?? Infinity)
      ? opponentDelay + (state.opponentAttacks + 1) * opponentInterval : Infinity;
    const next = Math.min(end, challengerNext, opponentNext);
    const delta = Math.max(0, next - resolvedMicros) / 1_000_000;
    const challengerRegen = Math.min(duel.challengerMaxHp - state.challengerHp, Math.max(0, duel.challengerRegen) * delta);
    const opponentRegen = Math.min(duel.opponentMaxHp - state.opponentHp, Math.max(0, duel.opponentRegen) * delta);
    state.challengerHp += challengerRegen; state.challengerRegened += challengerRegen;
    state.opponentHp += opponentRegen; state.opponentRegened += opponentRegen;
    // Burn and poison tick between attacks, and can finish a fight.
    if (state.cards) {
      const from = resolvedMicros / 1_000_000, to = next / 1_000_000;
      const onChallenger = Math.min(state.challengerHp, duelCardDamageOverTime(state.cards, "challenger", from, to));
      const onOpponent = Math.min(state.opponentHp, duelCardDamageOverTime(state.cards, "opponent", from, to));
      state.challengerHp -= onChallenger; state.opponentDamageDealt += onChallenger;
      state.opponentHp -= onOpponent; state.challengerDamageDealt += onOpponent;
    }
    resolvedMicros = next;
    const multiplier = duelHitMultiplier(next / 1_000_000, duel.combatVersion);
    // Resolve both scheduled attacks even if the first is lethal. Calculate
    // mitigation only for actual hits, not regeneration-only server pulses.
    if (state.cards) {
      // Card duels go through resolveAttack, the same rules on one side and the other.
      if (challengerNext === next) resolveAttack(duel, state, "challenger", multiplier, next / 1_000_000);
      if (opponentNext === next) resolveAttack(duel, state, "opponent", multiplier, next / 1_000_000);
      continue;
    }
    if (challengerNext === next) {
      const challengerDamage = duel.challengerDamage * multiplier;
      state.challengerAttacks++;
      const challengerHit = duelAttackDamage(duel, "challenger", state.challengerAttacks, challengerDamage, duel.opponentArmor);
      const deflected = duelDeflected(duel, "opponent", state.challengerAttacks);
      const taken = deflected ? 0 : Math.min(state.opponentHp, challengerHit.dealt);
      state.opponentHp -= taken; state.challengerDamageDealt += taken;
      state.opponentBlocked += challengerHit.blocked + (deflected ? challengerHit.dealt : 0);
      if (deflected) {
        const returned = Math.min(state.challengerHp, damageAfterArmor(Math.min(challengerHit.dealt + challengerHit.blocked, duel.opponentMaxHp), duel.challengerArmor));
        state.challengerHp -= returned; state.opponentDamageDealt += returned;
      }
      if (taken > 0 && duelRiposted(duel, "opponent", state.challengerAttacks)) {
        const thrown = Math.min(state.challengerHp, riposteThrown(duel, riposteBase(duel, challengerHit, taken), duel.opponentMaxHp));
        state.challengerHp -= thrown; state.opponentDamageDealt += thrown;
      }
    }
    if (opponentNext === next) {
      const opponentDamage = duel.opponentDamage * multiplier;
      state.opponentAttacks++;
      const opponentHit = duelAttackDamage(duel, "opponent", state.opponentAttacks, opponentDamage, duel.challengerArmor);
      const deflected = duelDeflected(duel, "challenger", state.opponentAttacks);
      const taken = deflected ? 0 : Math.min(state.challengerHp, opponentHit.dealt);
      state.challengerHp -= taken; state.opponentDamageDealt += taken;
      state.challengerBlocked += opponentHit.blocked + (deflected ? opponentHit.dealt : 0);
      if (deflected) {
        const returned = Math.min(state.opponentHp, damageAfterArmor(Math.min(opponentHit.dealt + opponentHit.blocked, duel.challengerMaxHp), duel.opponentArmor));
        state.opponentHp -= returned; state.challengerDamageDealt += returned;
      }
      if (taken > 0 && duelRiposted(duel, "challenger", state.opponentAttacks)) {
        const thrown = Math.min(state.opponentHp, riposteThrown(duel, riposteBase(duel, opponentHit, taken), duel.challengerMaxHp));
        state.opponentHp -= thrown; state.challengerDamageDealt += thrown;
      }
    }
  }
  return { ...state, resolvedMicros };
}

/** Knockout wins; at the time limit compare health remaining as a fraction.
 * Absolute remaining HP would award a passive high-HP build a free timeout win. */
export function duelOutcome(duel: Pick<DuelCombat, "challengerMaxHp" | "opponentMaxHp">,
  state: Pick<DuelCombatState, "challengerHp" | "opponentHp">): "CHALLENGER_WIN" | "OPPONENT_WIN" | "DRAW" {
  if (state.challengerHp <= 0 || state.opponentHp <= 0) {
    if (state.challengerHp <= 0 && state.opponentHp <= 0) return "DRAW";
    return state.challengerHp > 0 ? "CHALLENGER_WIN" : "OPPONENT_WIN";
  }
  const difference = state.challengerHp / Math.max(1, duel.challengerMaxHp) - state.opponentHp / Math.max(1, duel.opponentMaxHp);
  return Math.abs(difference) <= 1e-9 ? "DRAW" : difference > 0 ? "CHALLENGER_WIN" : "OPPONENT_WIN";
}

/** Deterministic saved-lineup combat used by asynchronous guild battles. */
export function simulateDuelBattle(challenger: DuelFighter, opponent: DuelFighter) {
  const combat = { combatVersion: DUEL_COMBAT_VERSION,
    challengerMaxHp: challenger.maxHp, challengerDamage: challenger.damage, challengerArmor: challenger.armor, challengerRegen: challenger.regen, challengerAttackRate: challenger.attackRate,
    opponentMaxHp: opponent.maxHp, opponentDamage: opponent.damage, opponentArmor: opponent.armor, opponentRegen: opponent.regen, opponentAttackRate: opponent.attackRate };
  const result = advanceDuelCombat(combat, initialDuelCombatState(combat), 0, 30_000_000);
  return { combat, result, outcome: duelOutcome(combat, result), durationMicros: Math.max(3_000_000, result.resolvedMicros) };
}

export type DuelCombatModifiers = DuelCardFields & Pick<DuelCombat, "challengerRiposte" | "opponentRiposte" | "riposteSeed"
  | "challengerArrowStorm" | "challengerRicochet" | "challengerPiercingShot" | "opponentArrowStorm" | "opponentRicochet" | "opponentPiercingShot"
  | "challengerWhirlwind" | "challengerDeflect" | "challengerShockwave" | "opponentWhirlwind" | "opponentDeflect" | "opponentShockwave">;
