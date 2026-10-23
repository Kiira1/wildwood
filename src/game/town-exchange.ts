import { TOWN_EXCHANGE_CENTER, TOWN_EXCHANGE_PLAZA, TOWN_EXCHANGE_POSITION, TOWN_EXCHANGE_ROAD, TOWN_EXCHANGE_SIGNPOST_POSITION } from "../../shared/town";
import type { SoulSolid } from "./town-village";
import type { WorldDecor } from "./world";

/**
 * The Trade Chrysanthemum's square south of the village (shared/town.ts places it): the clerk's booth of three
 * market stalls on its north side, a chrysanthemum bed in the middle, more stalls down either side, lamp posts,
 * banners at the road's mouth, and crates, barrels and a cart round the edges. The village's own props, its stalls
 * set up as its market's are; the bed and the banners are painted (exchange-props.ts).
 */
export const TOWN_EXCHANGE_LABEL = "Trade Chrysanthemum";

type Piece = readonly [frame: string, x: number, y: number, dy?: number];
const { left: L, top: T } = TOWN_EXCHANGE_PLAZA;
const MIDDLE = TOWN_EXCHANGE_POSITION.x;

/** A market stall as the village sets its own up: shadow, stall and awning at one depth. */
const stall = (body: string, awning: string, x: number, y: number): Piece[] =>
  [["160", x, y, 5], [body, x, y, 20], [awning, x, y, awning === "166" || awning === "187" ? -30 : -33]];
/** A stall's collider: its counter, as the village's are. */
const stallSolid = (x: number, y: number) => box(x - 45, y - 24, x + 45, y + 13);
const box = (left: number, top: number, right: number, bottom: number): SoulSolid =>
  ({ xs: [left, right, right, left], ys: [top, top, bottom, bottom], left, top, right, bottom });

/** The clerk's booth, the stalls down either side, and where each stands. */
const BOOTH_Y = T + 140;
const STALLS: readonly (readonly [body: string, awning: string, x: number, y: number])[] = [
  ["162", "165", MIDDLE - 98, BOOTH_Y], ["164", "166", MIDDLE, BOOTH_Y], ["163", "165", MIDDLE + 98, BOOTH_Y],
  ["161", "186", L + 92, T + 300], ["163", "166", L + 92, T + 475],
  ["162", "166", L + 768, T + 300], ["161", "186", L + 768, T + 475],
];
/** Lamp posts: either side of the booth, and round the bed. */
const LAMPS: readonly (readonly [number, number])[] = [
  [MIDDLE - 172, BOOTH_Y + 14], [MIDDLE + 172, BOOTH_Y + 14],
  [TOWN_EXCHANGE_CENTER.x - 150, TOWN_EXCHANGE_CENTER.y - 75], [TOWN_EXCHANGE_CENTER.x + 150, TOWN_EXCHANGE_CENTER.y - 75],
  [TOWN_EXCHANGE_CENTER.x - 150, TOWN_EXCHANGE_CENTER.y + 85], [TOWN_EXCHANGE_CENTER.x + 150, TOWN_EXCHANGE_CENTER.y + 85],
];
/** Goods stacked about: crates, barrels, sacks, a cart and hay, each with the half-width of its collider (0 for none). */
const GOODS: readonly (readonly [frame: string, x: number, y: number, half: number])[] = [
  // Beside the booth.
  ["185", MIDDLE - 214, BOOTH_Y - 4, 17], ["263", MIDDLE - 206, BOOTH_Y + 22, 0],
  ["193", MIDDLE + 212, BOOTH_Y - 6, 17], ["202", MIDDLE + 240, BOOTH_Y + 4, 15], ["231", MIDDLE + 222, BOOTH_Y + 26, 20],
  // By the side stalls.
  ["172", L + 162, T + 308, 16], ["261", L + 160, T + 488, 0], ["246", L + 26, T + 488, 20],
  ["185", L + 698, T + 310, 17], ["229", L + 836, T + 312, 20], ["49", L + 700, T + 490, 0],
  // The south corners: a cart and its load, hay and firewood.
  ["175", L + 104, T + 580, 38], ["177", L + 166, T + 576, 17], ["265", L + 212, T + 584, 28],
  ["126", L + 750, T + 582, 26], ["276", L + 806, T + 580, 0], ["193", L + 696, T + 578, 17],
];
/** The bed's foot, its front edge: everyone north of it is drawn behind its flowers. */
export const EXCHANGE_BED = Object.freeze({ x: TOWN_EXCHANGE_CENTER.x, y: TOWN_EXCHANGE_CENTER.y + 48, rx: 92, ry: 50 });
/** Banners either side of where the road comes in, and at the square's south corners. */
const ROAD_MOUTH = TOWN_EXCHANGE_ROAD[TOWN_EXCHANGE_ROAD.length - 1];
const BANNERS: readonly (readonly [number, number])[] = [
  [ROAD_MOUTH.x - 26, T + 30], [ROAD_MOUTH.x + ROAD_MOUTH.w + 26, T + 30], [L + 26, T + 600], [TOWN_EXCHANGE_PLAZA.right - 26, T + 600],
];

const prop = ([frame, x, y, dy = 0]: Piece): WorldDecor => ({ type: "soulProp", sheet: "village", frame, s: 1, x, y, dy, shadow: frame === "160" });

export const TOWN_EXCHANGE_DECOR: readonly WorldDecor[] = [
  ...STALLS.flatMap(([body, awning, x, y]) => stall(body, awning, x, y)).map(prop),
  ...LAMPS.map(([x, y]) => prop(["192", x, y])),
  ...GOODS.map(([frame, x, y]) => prop([frame, x, y])),
  { type: "soulProp", frame: "", s: 1, x: EXCHANGE_BED.x, y: EXCHANGE_BED.y, painted: "chrysanthemumBed" },
  ...BANNERS.map(([x, y]): WorldDecor => ({ type: "soulProp", frame: "", s: 1, x, y, painted: "exchangeBanner" })),
  { type: "soulProp", frame: "", s: 1, ...TOWN_EXCHANGE_SIGNPOST_POSITION, signpost: "Trade\nChrysanthemum", flip: true },
  { type: "station", x: TOWN_EXCHANGE_POSITION.x, y: TOWN_EXCHANGE_POSITION.y, s: 1, label: TOWN_EXCHANGE_LABEL },
];

/** The bed's kerb as a many-sided outline, a little inside its drawn edge. */
const bedSolid = (): SoulSolid => {
  const xs: number[] = [], ys: number[] = [], cy = EXCHANGE_BED.y - EXCHANGE_BED.ry + 4;
  for (let index = 0; index < 16; index++) {
    const angle = index / 16 * Math.PI * 2;
    xs.push(EXCHANGE_BED.x + Math.cos(angle) * (EXCHANGE_BED.rx - 6));
    ys.push(cy + Math.sin(angle) * (EXCHANGE_BED.ry - 10));
  }
  return { xs, ys, left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
};

/** What a player cannot walk through on the square: stalls' counters, lamp posts, goods, the bed, the poles. */
export const TOWN_EXCHANGE_SOLIDS: readonly SoulSolid[] = [
  ...STALLS.map(([, , x, y]) => stallSolid(x, y)),
  ...LAMPS.map(([x, y]) => box(x - 8, y - 8, x + 8, y + 4)),
  ...GOODS.filter(([, , , half]) => half > 0).map(([, x, y, half]) => box(x - half, y - 14, x + half, y + 4)),
  bedSolid(),
  ...BANNERS.map(([x, y]) => box(x - 7, y - 7, x + 7, y + 4)),
  box(TOWN_EXCHANGE_SIGNPOST_POSITION.x - 8, TOWN_EXCHANGE_SIGNPOST_POSITION.y - 8, TOWN_EXCHANGE_SIGNPOST_POSITION.x + 8, TOWN_EXCHANGE_SIGNPOST_POSITION.y + 4),
];
