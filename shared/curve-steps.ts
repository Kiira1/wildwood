/**
 * The balance curve: how much each map's enemies grow over the map before, from Tutorial Forest through the
 * campaign and on through Endless, the same every map. Health and hits grow alike, about as fast as players get
 * tougher; pay grows slower, so each map takes a little longer than the last.
 */
export const CURVE_STEPS = Object.freeze({ health: 2.2, damage: 2.2, reward: 1.8 });
/**
 * Enemy hits from map 2 on stand this far above the Forest's line: players get about 20x tougher from the Forest
 * to the Desert (their first gear and upgrades), so hits on the Forest's line would barely scratch them there.
 */
export const CURVE_HIT_LEVEL = 5;
