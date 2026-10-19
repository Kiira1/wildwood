/**
 * The balance curve: how much each map's enemies grow over the map before, from Tutorial Forest through the
 * campaign and on through Endless, the same every map. Power (health and hits alike) grows about 2x a map, and
 * health outgrows reward, so each map takes about 1.22x longer than the last.
 */
export const CURVE_STEPS = Object.freeze({ health: 2.2, damage: 1.8, reward: 1.8 });
