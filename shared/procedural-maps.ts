import {
  campaignEnemyRewardMultiplier,
  bossHeavyHitAt,
  desertBossHealthAt,
  desertLaneCombatValue,
  desertLaneRewardValue,
  type ForestProgressionLane,
  type RewardStat,
} from "./progression";

export type ProceduralMapId = `endless_${number}`;
export const PROCEDURAL_PREFIX = "endless_";
export const PROCEDURAL_MAP_VERSION = 2;
export const PROCEDURAL_ENTRY_MAP = "ion_citadel";
export const PROCEDURAL_ENTRY_BOSS = "aegisPrime";
export const PROCEDURAL_FIRST_TIER = 14; // Desert is tier zero; this follows Ion.
export const PROCEDURAL_WORLD = { width: 4800, height: 4800 };
export function proceduralMapNumber(id: string): number | null {
  if (!/^endless_[1-9]\d{0,15}$/.test(id)) return null;
  const number = Number(id.slice(PROCEDURAL_PREFIX.length));
  return Number.isSafeInteger(number) ? number : null;
}
export function isProceduralMap(id: string): id is ProceduralMapId {
  return proceduralMapNumber(id) !== null;
}
export function proceduralMapId(index: number): ProceduralMapId {
  if (!Number.isSafeInteger(index) || index < 1)
    throw new RangeError("Invalid generated map number");
  return `endless_${index}`;
}
/** Integer-only RNG: identical layouts in browser, server, and map shards. */
export function mapRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export type MapPoint = { x: number; y: number };
export type MapPath = MapPoint & { w: number; h: number };
export type GeneratedCamp = MapPoint & {
  name: string;
  lane: ForestProgressionLane;
  stat: RewardStat;
  count: number;
  radius: number;
};
export type GeneratedMap = {
  id: ProceduralMapId;
  number: number;
  name: string;
  tier: number;
  seed: number;
  arrival: MapPoint;
  boss: MapPoint;
  portals: Array<
    MapPoint & {
      destination: string;
      width: number;
      height: number;
      depth: number;
    }
  >;
  camps: GeneratedCamp[];
  paths: MapPath[];
  palette: { ground: string; path: string; pathDetail: string; accent: string };
};
function hslHex(hue: number, saturation: number, lightness: number) {
  const light = lightness / 100;
  const amplitude = (saturation / 100) * Math.min(light, 1 - light);
  const channel = (offset: number) => {
    const position = (offset + hue / 30) % 12;
    const value =
      light - amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
export function proceduralPalette(index: number) {
  const hue = ((index - 1) * 7) % 360;
  const saturation = Math.min(48, (index - 1) * 2.5);
  // Hex colors work in both the canvas tile painter and the WebGL backdrop.
  return {
    ground: hslHex(hue, saturation, 92),
    path: hslHex(hue, saturation * 0.6, 98),
    pathDetail: hslHex(hue, saturation, 80),
    accent: hslHex(hue, saturation, 65),
  };
}
export function proceduralMapCore(id: string) {
  const number = proceduralMapNumber(id);
  if (number === null) throw new RangeError("Invalid generated map");
  return { number, tier: Math.min(60, PROCEDURAL_FIRST_TIER + number - 1),
    arrival: { x: 580, y: 770 }, boss: { x: 4050, y: 4050 } };
}
export function generateMap(id: ProceduralMapId): GeneratedMap {
  const { number, tier, arrival, boss } = proceduralMapCore(id);
  const seed = Math.imul(number, 2654435761) ^ PROCEDURAL_MAP_VERSION;
  const random = mapRandom(seed);
  const slots = [
    { x: 1150, y: 1250 },
    { x: 3050, y: 1100 },
    { x: 1250, y: 2650 },
    { x: 3250, y: 2550 },
  ];
  const lanes: Array<[ForestProgressionLane, RewardStat]> = [
    ["Cindermaw", "damage"],
    ["Bramble", "health"],
    ["Mossback", "armor"],
    ["Brood", "regen"],
  ];
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  const camps = slots.map((slot, i) => ({
    x: slot.x + Math.round((random() - 0.5) * 260),
    y: slot.y + Math.round((random() - 0.5) * 260),
    name: `${["Damage", "Health", "Armor", "Regen"][["damage", "health", "armor", "regen"].indexOf(lanes[i][1])]} Camp`,
    lane: lanes[i][0],
    stat: lanes[i][1],
    count: lanes[i][1] === "damage" ? 13 : 6,
    radius: 330,
  }));
  const paths: MapPath[] = [];
  const connect = (a: MapPoint, b: MapPoint) => {
    paths.push({
      x: Math.min(a.x, b.x) - 90,
      y: a.y - 90,
      w: Math.abs(a.x - b.x) + 180,
      h: 180,
    });
    paths.push({
      x: b.x - 90,
      y: Math.min(a.y, b.y) - 90,
      w: 180,
      h: Math.abs(a.y - b.y) + 180,
    });
  };
  // A connected backbone plus camp branches; all spawn and boss clearings remain reachable.
  let previous = arrival;
  for (const camp of camps) {
    connect(previous, camp);
    previous = camp;
  }
  connect(previous, boss);
  return {
    id,
    number,
    name: `Endless - ${number}`,
    tier,
    seed,
    arrival,
    boss,
    camps,
    paths,
    palette: proceduralPalette(number),
    portals: [
      {
        x: 360,
        y: 680,
        width: 198,
        height: 198,
        depth: 680,
        destination:
          number === 1 ? PROCEDURAL_ENTRY_MAP : proceduralMapId(number - 1),
      },
      ...(number < Number.MAX_SAFE_INTEGER
        ? [
            {
              x: 580,
              y: 680,
              width: 198,
              height: 198,
              depth: 680,
              destination: proceduralMapId(number + 1),
            },
          ]
        : []),
    ],
  };
}
export function generatedEnemyStats(
  map: Pick<GeneratedMap, "tier">,
  lane: ForestProgressionLane,
) {
  const reward = desertLaneRewardValue(lane, map.tier);
  reward.amount *=
    campaignEnemyRewardMultiplier(PROCEDURAL_FIRST_TIER - 1) /
    campaignEnemyRewardMultiplier(map.tier);
  return { ...desertLaneCombatValue(lane, map.tier), reward };
}
export function generatedBossStats(map: Pick<GeneratedMap, "tier">) {
  return {
    hp: desertBossHealthAt(map.tier),
    damage: bossHeavyHitAt(map.tier),
    reward: generatedEnemyStats(map, "Brood").reward,
  };
}
