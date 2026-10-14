import { describe, expect, it } from "vitest";
import { CARDS, cardDefinition } from "./cards";
import { cardEffectText, cardName, cardOrigin } from "./card-text";

describe("card text", () => {
  it("writes every effect of every card as a sentence, never its id", () => {
    for (const card of CARDS) for (const effect of card.effects) {
      const text = cardEffectText(effect);
      expect(text, `${card.id} ${effect.effect}`).not.toBe(effect.effect);
      expect(text, card.id).not.toMatch(/undefined|NaN/);
    }
  });

  it("reads the way the review page did", () => {
    expect(cardEffectText({ effect: "atk", value: 2 })).toBe("Damage +2%");
    expect(cardEffectText({ effect: "maxHealth", value: -3.6 })).toBe("Max Health -3.6%");
    expect(cardEffectText({ effect: "raceSlayer", value: 9, mapId: "beginner_desert" })).toBe("Damage to Beginner Desert enemies +9%");
    expect(cardEffectText({ effect: "statGain", value: 4, stat: "health" })).toBe("Max Health from kills +4%");
    expect(cardEffectText({ effect: "burn", value: 100, share: .3 })).toBe("Every hit burns: 30% of the hit over 3s");
    expect(cardEffectText({ effect: "splash", value: 60, chance: 15 })).toBe("15% chance to strike every enemy near the target for 60%");
    expect(cardEffectText({ effect: "chainLightning", value: 20, targets: 3, share: .7 })).toBe("20% chance to arc to 3 more enemies for 70%");
  });

  it("names a card and where it comes from", () => {
    const needle = cardDefinition("needle_card")!, slime = cardDefinition("king_slime_card")!, dragon = cardDefinition("dragon_card")!;
    expect(cardName(needle)).toBe("Needle Card");
    expect([cardOrigin(needle), cardOrigin(slime), cardOrigin(dragon)]).toEqual(["Regular · Tutorial Forest", "Elite · Tutorial Forest", "Boss · Tutorial Forest"]);
  });
});
