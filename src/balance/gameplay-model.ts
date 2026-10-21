import { BLACK_BOOTS_SPEED_BONUS } from "../../shared/items";
import { PLAYER_SPEED, MOVE_SPEED_RESEARCH_BONUS_PER_RANK } from "../../shared/rules";

/**
 * Black Boots are a flat bonus, so travel does not wait out a combat delay. `speedFactor` is what the rest
 * multiplies by, as the game's movement does: the armor classes worn (armor-class-perks.ts).
 */
export function simulationTravelSeconds(distance: number, moveSpeedRank: number, blackBoots: boolean, speedFactor = 1) {
  const base = PLAYER_SPEED * (1 + moveSpeedRank * MOVE_SPEED_RESEARCH_BONUS_PER_RANK);
  return Math.max(0, distance) / ((base + (blackBoots ? BLACK_BOOTS_SPEED_BONUS : 0)) * speedFactor);
}
