// Regular-enemy report validation. Boss combat runs on the client and clears
// only unlock gates (boss-gates.ts); the retained IDs below serve old migrations.
import { upgradeSlotForItem } from "../../shared/slot-upgrades";
import { preparePlayerPowerStats, playerPowerForStats, legacyU32Power } from "../../shared/player-power";
import { equipmentDamageMultiplierBonus, itemDefinition, type ItemLevel } from "../../shared/items";
import { createEnemyRewardAccumulator, type EnemyStatReward } from "../../shared/enemy-reward-accumulator";
import { attackCapInPlay, statRewardMultiplierFor, prestigePerkRanks } from "./prestige";
import { WORLD_REFLECT_SHARE, preArmorFactor, prestigePerkValue, prestigeReachMultiplier, prestigeSwingMultiplier } from "../../shared/prestige-perks";
import { armorDamageReduction } from "../../shared/combat";
import { criticalDamageMultiplier } from "../../shared/critical-damage";
import { cardStatFactors, cardTotalsForLevels } from "../../shared/card-effects";
import { soulStatsFor, withSoulStats } from "./soul-dimension";
import { bowSkillRollFor } from "./bow-skills";
import { bowSkillReachMultiplier, isSkillBow } from "../../shared/bow-skills";
import { CARD_SPLASH_MAX_TARGETS, bowSkillsWithCards, cardGuardFactor, cardOffenseBound, cardSustainBound } from "../../shared/card-bounds";
import { cardValue } from "../../shared/card-effects";
import { swordSkillChance, swordSkillReachMultiplier } from "../../shared/sword-skills";
import { swordSkillRollFor } from "./sword-skills";
import type { ModuleReducerCtx as GameReducerContext } from "./index";
import { readPlayerProgress } from "./wide-stats";

// Primary key of the single row in each retained shared-boss table. The
// one-time migrations still read the old result rows by it.
export const MAGMALISK_ID = 1;
export const TEMPEST_KIRIN_ID = 1;
export const MIREMAW_ID = 1;
export const PRISMSHELL_ID = 1;
export const DREADREAPER_ID = 1;
export const VOLTWARDEN_ID = 1;
export const GRAVEBLOOM_ID = 1;

// Everything the bodies still borrow from index.ts. Passing these in keeps
// the module free of runtime imports from ./index.
export type CombatReportDeps = {
  attackIntervalForProgress: (progress: any) => number;
  /** The slot tier and refine of a worn item (progress-helpers itemLevelFor). */
  itemUpgradeLevelFor: (ctx: any, identity: any, itemId: unknown) => ItemLevel;
  // The equipped* helpers take an already parsed inventory, so one parse serves all four.
  equippedRightHandForProgress: (progress: any, inventory?: string[]) => string;
  equippedLeftHandForProgress: (progress: any, inventory?: string[]) => string;
  equippedHeadForProgress: (progress: any, inventory?: string[]) => string;
  equippedChestForProgress: (progress: any, inventory?: string[]) => string;
  inventoryForProgress: (progress: any) => string[];
};

/** The death screen's 3-second countdown and a second more: shorter than any real death and walk back. */
export const REFLECT_ONLY_LIFE_SECONDS = 4;
/** Reflect lands whenever a hit does, with no swing to round kills to; a short tick keeps the bound continuous. */
export const REFLECT_ONLY_TICK_SECONDS = .1;
/** More kills a second than any map respawns (about 3.3 on Endless): Second Wind heals once per kill. */
export const SECOND_WIND_KILLS_PER_SECOND = 4;

export function createCombatReport(deps: CombatReportDeps) {
  const {
    attackIntervalForProgress, itemUpgradeLevelFor, inventoryForProgress,
    equippedRightHandForProgress, equippedLeftHandForProgress, equippedHeadForProgress, equippedChestForProgress,
  } = deps;

  /**
   * researchedDamage (index.ts) with the gear resolved once: the weapon, and
   * what it and the head and chest make of any base damage, with each slot's
   * upgrade level read at most once. The formula has to stay researchedDamage's.
   */
  function damageLoadout(ctx: GameReducerContext, progress: any, research: any) {
    const inventory = inventoryForProgress(progress);
    const weapon = equippedRightHandForProgress(progress, inventory) || equippedLeftHandForProgress(progress, inventory);
    const head = equippedHeadForProgress(progress, inventory), chest = equippedChestForProgress(progress, inventory);
    // Per item: the slot's tier and the item's own refine are both fixed for a report.
    const levels = new Map<string, ItemLevel>();
    const levelFor = (itemId: unknown): ItemLevel => {
      if (!upgradeSlotForItem(itemId)) return 0;
      const key = String(itemId);
      let level = levels.get(key);
      if (level === undefined) levels.set(key, level = itemUpgradeLevelFor(ctx, ctx.sender, itemId));
      return level;
    };
    const [weaponLevel, headLevel, chestLevel] = [levelFor(weapon), levelFor(head), levelFor(chest)];
    const warcraft = 1 + (research?.warcraft ?? 0) * .02;
    const equipment = 1 + equipmentDamageMultiplierBonus(weapon, head, chest, weaponLevel, headLevel, chestLevel);
    // The worn cards, carried by the levels: attack cards multiply damage as they do power.
    const cardTotals = cardTotalsForLevels(weaponLevel, headLevel, chestLevel);
    const cards = cardStatFactors(cardTotals);
    return { weapon, levelFor, cardTotals, cards, damage: (base: number) => base * equipment * warcraft * cards.damage };
  }

  /**
   * The most combat this player could have brought to each entry of one kill
   * report. Every row it reads is fixed for the length of a report: validation
   * writes only budget rows and the stream cursor, and the rewards a report
   * earns move stats, never gear, unlocks, perks, research or the bow's roll.
   * So the rows are read and the inventory parsed once, on first use, and each
   * entry after that is arithmetic on the saved stats plus what it earned.
   * This used to be rebuilt from scratch per species (nine reads and four
   * inventory parses each, thirty-one times on an Endless report), which was
   * most of what the kill reducer cost.
   */
  function combatBoundForReport(ctx: GameReducerContext) {
    let loaded: ReturnType<typeof load> | undefined;
    function load() {
      const saved = readPlayerProgress(ctx, ctx.sender);
      const research = ctx.db.playerResearch.identity.find(ctx.sender);
      const statMultiplier = statRewardMultiplierFor(ctx, ctx.sender);
      // Soul stats add to the run's in every fight; the saved row and the earned rewards stay the run's alone.
      const soul = soulStatsFor(ctx, ctx.sender);
      const loadout = saved ? damageLoadout(ctx, saved, research) : null;
      const challenge = ctx.db.playerPrestigeChallenge.identity.find(ctx.sender);
      // Reflect Only wins and Quick Draw set the attack speed cap, Aggro runs included (attackCapInPlay).
      // The bounds above keep stored research, the looser side.
      const ranks = prestigePerkRanks(ctx, ctx.sender);
      const minInterval = attackCapInPlay(ctx, ctx.sender);
      const earned = saved ? createEnemyRewardAccumulator(saved, statMultiplier, minInterval) : null;
      const statsFor = saved ? preparePlayerPowerStats(saved, research, loadout?.levelFor) : null;
      // Armor rewards can change the nonlinear reduction inside a report.
      // Calculate it once per distinct effective armor, never reuse a stale value.
      const armorFactors = new Map<number, { reduction: number; preArmor: number }>();
      const armorFor = (armor: number) => {
        let factors = armorFactors.get(armor);
        if (!factors) {
          const reduction = armorDamageReduction(armor);
          factors = { reduction, preArmor: preArmorFactor(reduction) };
          armorFactors.set(armor, factors);
        }
        return factors;
      };
      if (!saved || !loadout || !statsFor) return { saved, earned, statsFor, armorFor, soul, gear: null };
      // Empty hands still earn through Reflect (an unarmed Reflect run): the
      // bound must not read no weapon as no combat, which paid them nothing.
      const armed = Boolean(loadout.weapon);
      // Use the possible maximum so legitimate lucky streaks are never clipped,
      // and no more than the critical damage cap lets a hit deal.
      // Keen Edge grants crit on its own, so a player with no crit research can
      // still be critting; the bound has to know that or it clips them.
      // Crit kills inside the report raise the run's rating, so the multiplier is read per entry.
      // Card effects in combat (card-bounds.ts): more damage a hit and more enemies reached, all counted at once.
      const cardBound = cardOffenseBound(loadout.cardTotals);
      const crits = (research?.criticalChance ?? 0) > 0 || prestigePerkValue(ranks, "keenEdge") > 0 || loadout.cards.critChance > 0 || cardBound.crits;
      const critical = (rating = 0) => crits
        ? criticalDamageMultiplier({ researchRank: research?.criticalDamage, perks: ranks, soul: soul?.critDamage, rating, capRank: research?.critCap,
          card: loadout.cards.critDamage }) : 1;
      // Double Strike is more damage per swing; Split Shot and Riposte are more
      // enemies reached per swing. The first belongs in damage per second, the
      // second in how many kills per second that damage can finish. The bow's
      // skills are both. Every storm arrow, bounce and pierce can reach another
      // enemy, so they widen reach; the Split Shot arrow rolls the bow's skills
      // too, so the two reaches multiply.
      // Bow skill cards add to a bow's own roll.
      const bowSkills = isSkillBow(loadout.weapon) ? bowSkillsWithCards(bowSkillRollFor(ctx, ctx.sender, loadout.weapon), loadout.cardTotals) : null;
      const swordSkills = swordSkillRollFor(ctx, ctx.sender, loadout.weapon);
      const armorReduction = armorFor(statsFor(withSoulStats(saved, soul, minInterval)).armor).reduction;
      return { saved, earned, statsFor, armorFor, soul, minInterval, gear: {
        loadout, critical, swing: prestigeSwingMultiplier(ranks),
        // Projectile count is not a kill reward, so the saved row holds for the whole report.
        armed,
        projectiles: !armed || itemDefinition(loadout.weapon)?.weapon?.mode === "MELEE" ? 1 : Math.max(1, saved.projectileCount),
        // Reflect returns the hit before armor, so armor raises what it adds.
        reach: (prestigeReachMultiplier(ranks, armorReduction) + cardBound.reflect * WORLD_REFLECT_SHARE * preArmorFactor(armorReduction))
          * bowSkillReachMultiplier(bowSkills) * swordSkillReachMultiplier(swordSkills) * cardBound.reach,
        cardDamage: cardBound.damage,
        reflects: prestigePerkValue(ranks, "riposte") > 0 || cardBound.reflect > 0,
        // Prism: a reflected hit strikes the enemies near its attacker as well.
        reflectReach: cardBound.prism ? 1 + CARD_SPLASH_MAX_TARGETS : 1,
        deflects: swordSkillChance(swordSkills, "deflect") > 0,
        // Second Wind cards add to the perk.
        secondWind: prestigePerkValue(ranks, "secondWind") + Math.max(0, cardValue(loadout.cardTotals, "secondWind")) / 100,
        cardTotals: loadout.cardTotals,
        reflectOnly: Boolean(challenge?.active),
      } };
    }
    const report = () => (loaded ??= load());
    return {
      /** Preview this entry on top of previously accepted rewards. */
      preview(reward: EnemyStatReward) {
        const { saved, earned, gear, statsFor, armorFor, soul, minInterval } = report();
        if (!saved) return { dps: 0, attackInterval: 1 };
        const progress = withSoulStats(earned!.preview(reward), soul, minInterval);
        const attackInterval = attackIntervalForProgress(progress);
        if (!gear) return { dps: 0, attackInterval, projectiles: 1 };
        const dps = gear.armed
          ? gear.loadout.damage(progress.damage) * gear.critical(progress.critRating) * gear.swing * gear.cardDamage * gear.projectiles / attackInterval : 0;
        // Reflect throws a hit back as it arrived before armor
        // (capped at max health outside Reflect Only). What got through can
        // never total more than the player's health, what regen restores and
        // what Second Wind heals on kills before they fall, and a hit before
        // armor is what got through times preArmorFactor: so that, scaled, is
        // the most Reflect can deal, whatever its bag drew.
        const stats = gear.reflects || gear.deflects ? statsFor!(progress) : null;
        // Guard cards let less of a hit through, so a reflected hit is that much bigger than what was lost.
        const reflect = stats ? { maxHp: stats.maxHp, regen: stats.regen, preArmor: armorFor(stats.armor).preArmor * cardGuardFactor(gear.cardTotals) } : null;
        // Damage taken per second that Reflect can answer: regen, a health bar
        // per life (a life no shorter than REFLECT_ONLY_LIFE_SECONDS), and
        // Second Wind's heal at the most kills a second any map can respawn.
        const absorbed = reflect ? reflect.regen + reflect.maxHp / REFLECT_ONLY_LIFE_SECONDS + gear.secondWind * reflect.maxHp * SECOND_WIND_KILLS_PER_SECOND
          + cardSustainBound(gear.cardTotals, reflect.maxHp, dps, 1 / REFLECT_ONLY_TICK_SECONDS, REFLECT_ONLY_LIFE_SECONDS) : 0;
        // The perk's chance is left out, so the bound only ever errs towards paying.
        // Deflect prevents the hit, so health lost cannot bound it. Each return is capped at max health,
        // and shares the player's .1s hurt window. Leave its chance out, as for Reflect's lucky streaks.
        const reflectDps = (reflect && gear.reflects ? WORLD_REFLECT_SHARE * reflect.preArmor * absorbed * gear.reflectReach : 0)
          + (stats && gear.deflects ? stats.maxHp / REFLECT_ONLY_TICK_SECONDS : 0);
        // Reflect Only: the weapon counts for nothing, and every kill has to come from hits taken.
        if (gear.reflectOnly) {
          return { attackInterval: REFLECT_ONLY_TICK_SECONDS, projectiles: 1, reach: 1, dps: reflectDps, reflectDps: 0, reflectTick: REFLECT_ONLY_TICK_SECONDS };
        }
        // Outside it, Reflect is its own damage on top of the weapon's: a hit
        // as big as max health is no share of a weak bow's kills.
        return { attackInterval, projectiles: gear.projectiles, reach: gear.reach, dps, reflectDps, reflectTick: REFLECT_ONLY_TICK_SECONDS };
      },
      commit: (reward: EnemyStatReward) => report().earned?.commit(reward),
      rewardedProgress: () => report().earned?.current(),
      /** The saved progress row as the report found it; nothing in validation writes it. */
      savedProgress: () => report().saved,
      /**
       * powerFieldsForProgress for the rewarded row, from the research row and
       * slot levels this report already read. Loot adds to the bag but equips
       * nothing, and the levels are memoised by slot, so this is exact.
       */
      powerFields(progress: any) {
        const { statsFor, soul, minInterval } = report();
        const powerLevel = statsFor ? playerPowerForStats(statsFor(withSoulStats(progress, soul, minInterval))) : 0;
        return { power: legacyU32Power(powerLevel), powerLevel };
      },
    };
  }

  return { combatBoundForReport };
}
