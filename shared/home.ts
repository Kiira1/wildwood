export const HOME_EXTERIOR_MAP_ID = "home_exterior";
export const HOME_WORLD_WIDTH = 1_200;
export const HOME_WORLD_HEIGHT = 1_500;
// Preserve the original courtyard proportions while centering it in the larger lawn.
export const HOME_ART_OFFSET = { x: (HOME_WORLD_WIDTH - 1_000) / 2, y: (HOME_WORLD_HEIGHT - 1_000) / 2 };
export const HOME_EXTERIOR_SPAWN = { x: 500 + HOME_ART_OFFSET.x, y: 700 + HOME_ART_OFFSET.y };
export const HOME_BENCH_POSITION = { x: 380 + HOME_ART_OFFSET.x, y: 450 + HOME_ART_OFFSET.y };
export const HOME_RESEARCH_POSITION = { x: 620 + HOME_ART_OFFSET.x, y: 450 + HOME_ART_OFFSET.y };
