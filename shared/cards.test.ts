import { describe, expect, it } from "vitest";
import {
  CARDS, CARD_DROP_OUTCOMES, MAX_CARD_SLOTS, OWNED_GEAR_SLOTS, SLOT_ROLL_PER_THOUSAND, canHoldCards, cardDefinition,
  cardFitsItem, cardForBoss, cardForEnemy, rollGearSlots, type CardEffectId,
} from "./cards";
import { CAMPAIGN_MAPS } from "./campaign-registry";
import { ENEMY_TYPES } from "./enemy-definitions";
import { enemyDefeatDefinition } from "./enemy-defeats";

const KNOWN_EFFECTS: readonly CardEffectId[] = [
  "atk", "critChance", "critDamage", "doubleStrike", "splitShot", "bossSlayer", "eliteSlayer", "raceSlayer", "rangedSlayer",
  "execute", "opener", "berserk", "steady", "momentum", "burn", "poison", "chill", "stun", "weaken", "knockback", "splash",
  "chainLightning", "lifesteal", "quickDraw", "arrowStorm", "ricochet", "piercing", "iaido", "reap", "maxHealth", "armor",
  "regen", "reflect", "secondWind", "dodge", "rangedGuard", "meleeGuard", "bossGuard", "eliteGuard", "raceGuard", "shield",
  "panicHeal", "lastStand", "web", "prism", "fleetFoot", "longShot", "statGain", "allStatGain", "cardHunter", "treasure",
  "respawn", "miningSpeed", "oreFind", "starshardFind",
];

describe("the cards", () => {
  it("gives every campaign enemy and boss exactly one card, of its map and tier", () => {
    const kinds = Object.keys(ENEMY_TYPES);
    let enemies = 0;
    CAMPAIGN_MAPS.forEach((map, index) => {
      for (const kind of kinds.filter(kind => enemyDefeatDefinition(map.id, kind))) {
        const card = cardForEnemy(map.id, kind);
        expect(card, `${map.id} ${kind}`).toBeDefined();
        expect(card).toMatchObject({ mapId: map.id, tier: index + 1, rarity: ENEMY_TYPES[kind as keyof typeof ENEMY_TYPES].elite ? "elite" : "regular" });
        enemies++;
      }
      expect(cardForBoss(map.id), map.id).toMatchObject({ enemy: map.bossName, mapId: map.id, tier: index + 1, rarity: "boss" });
    });
    // Nothing else: no card for an enemy that is not on its map.
    expect(CARDS).toHaveLength(enemies + CAMPAIGN_MAPS.length);
    expect(new Set(CARDS.map(card => card.id)).size).toBe(CARDS.length);
    expect(CARDS.every(card => cardDefinition(card.id) === card)).toBe(true);
    expect(cardDefinition("not_a_card")).toBeUndefined();
  });

  it("gives every card known effects with real values, and map cards their own map", () => {
    for (const card of CARDS) {
      expect(["HAND", "HEAD", "CHEST"], card.id).toContain(card.slot);
      expect(card.effects.length, card.id).toBeGreaterThan(0);
      for (const effect of card.effects) {
        expect(KNOWN_EFFECTS, card.id).toContain(effect.effect);
        expect(Number.isFinite(effect.value) && effect.value !== 0, card.id).toBe(true);
        if (effect.effect === "raceSlayer" || effect.effect === "raceGuard") expect(effect.mapId, card.id).toBe(card.mapId);
        if (effect.effect === "statGain") expect(["damage", "health", "speed", "armor", "regen", "crit"], card.id).toContain(effect.stat);
      }
      // A card's only cost comes with a gain.
      expect(card.effects.some(effect => effect.value > 0), card.id).toBe(true);
    }
    // Every effect is on at least one card.
    expect(new Set(CARDS.flatMap(card => card.effects.map(effect => effect.effect)))).toEqual(new Set(KNOWN_EFFECTS));
  });

  it("grows with its map: a later map's card of the same effect is never weaker", () => {
    const strongest = new Map<string, number>();
    for (const card of [...CARDS].filter(card => card.rarity === "regular" && card.effects.length === 1).sort((a, b) => a.tier - b.tier)) {
      const [{ effect, value }] = card.effects;
      expect(value, card.id).toBeGreaterThanOrEqual(strongest.get(effect) ?? 0);
      strongest.set(effect, value);
    }
  });
});

describe("drops and slots", () => {
  it("drops a card once in 10,000 kills, an elite's in 20,000, a boss's in 1,000 boss kills", () => {
    expect(CARD_DROP_OUTCOMES).toEqual({ regular: 10_000, elite: 20_000, boss: 1_000 });
  });

  it("rolls 0 to 4 slots: 940, 30, 18, 9 and 3 in 1,000", () => {
    expect(SLOT_ROLL_PER_THOUSAND.reduce((sum, chance) => sum + chance, 0)).toBe(1_000);
    const counts = [0, 0, 0, 0, 0];
    for (let roll = 0; roll < 1_000; roll++) counts[rollGearSlots(roll)]++;
    expect(counts).toEqual([940, 30, 18, 9, 3]);
    expect(rollGearSlots(939.999)).toBe(0);
    expect(rollGearSlots(940)).toBe(1);
    expect(rollGearSlots(999.999)).toBe(MAX_CARD_SLOTS);
    expect(OWNED_GEAR_SLOTS).toBe(1);
  });

  it("puts a card only in gear of its kind that takes cards", () => {
    expect(cardFitsItem("needle_card", "iron_bow")).toBe(true);
    expect(cardFitsItem("needle_card", "iron_sword")).toBe(true);
    expect(cardFitsItem("needle_card", "snow_helmet")).toBe(false);
    expect(cardFitsItem("mossback_card", "desert_armor")).toBe(true);
    expect(cardFitsItem("brood_card", "forest_cap")).toBe(true);
    expect(cardFitsItem("brood_card", "desert_armor")).toBe(false);
    // No stat, no slots: the stone, looks and boots take no cards.
    for (const itemId of ["starter_stone", "galaxy_bow", "basic_paper_hat", "black_boots"]) expect(canHoldCards(itemId), itemId).toBe(false);
    expect(cardFitsItem("needle_card", "starter_stone")).toBe(false);
    expect(cardFitsItem("not_a_card", "iron_bow")).toBe(false);
  });
});
