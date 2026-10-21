// The world and town scenes: whole maps drawn by the game's world renderer at the game's own camera framing.
import { CAMPAIGN_MAPS } from "../../shared/campaign-registry";
import { SOUL_MAP_ID } from "../../shared/soul-dimension";
import { TOWN_CENTER, TOWN_MAP_ID, TOWN_WEST_BRIDGE } from "../../shared/town";
import { TOWN_OX_DECOR } from "../../src/game/town-world";
import { attackRangeWithResearch } from "../../shared/utility-research";
import { guildHallMapId } from "../../shared/guild-hall";
import { proceduralMapId } from "../../shared/procedural-maps";
import type { MapId } from "../../src/game/world";
import { createGameBootstrap } from "../../src/game/runtime/game-bootstrap";
import { BOSSES } from "../../src/game/runtime/boss/boss-registry";
import { mapView } from "./game-world";
import type { FakePlayer } from "./world";

const VISITOR = (id: string, x: number, y: number, extra: Partial<FakePlayer & { moving: boolean; facing: number }> = {}) => ({
  id, name: id, power: 840, hp: 1, maxHp: 1, chestItem: "rare_light_armor", rightHandItem: "rare_sword", x, y, ...extra,
});

/** A row of map views that wraps at the page width. */
function strip() {
  const element = document.createElement("div");
  element.style.cssText = "display:flex;flex-wrap:wrap;align-items:flex-start";
  document.body.append(element);
  return element;
}

const PHONE = { width: 390, height: 780 };
const DESKTOP = { width: 1280, height: 800 };

/** Every map where a player arrives, at the phone framing; the Forest and the Night Forest at the desktop framing too. */
export async function world() {
  const phones = strip();
  const maps = [...CAMPAIGN_MAPS.map(map => map.id), proceduralMapId(1), SOUL_MAP_ID, guildHallMapId(1)] as MapId[];
  const views = [];
  for (const mapId of maps) views.push(await mapView({ mapId, ...PHONE, parent: phones, title: `${mapId} · phone` }));
  // Depth order at a gate: one standing in the gateway is drawn over the swirl, one walking through it behind,
  // one beside a pillar and one above the arch in front of and behind the stone.
  const { mapConfig, bosses } = createGameBootstrap();
  const desert = "beginner_desert" as MapId;
  const gate = mapConfig[desert].portal!;
  const inGate = { x: gate.x, y: gate.y - gate.height / 3 };
  views.push(await mapView({
    mapId: desert, ...PHONE, parent: phones, title: "beginner_desert · players at a gate", at: { x: inGate.x + 40, y: inGate.y + 150 },
    others: [VISITOR("standing", inGate.x - 24, inGate.y), VISITOR("walking", inGate.x + 26, inGate.y + 4, { moving: true, facing: -Math.PI / 2 }),
      VISITOR("pillar", gate.x + gate.width * .62, inGate.y), VISITOR("above", gate.x, gate.y - gate.height - 20)],
  }));
  // Depth order at a boss: the player below it is drawn in front, a visitor above it behind.
  const boss = bosses.dragon, bossMap = BOSSES.dragon.mapId as MapId;
  views.push(await mapView({
    mapId: bossMap, ...PHONE, parent: phones, title: `${bossMap} · at its boss`, at: { x: boss.x + 60, y: boss.y + 140 },
    others: [VISITOR("behind", boss.x - 60, boss.y - 90)],
  }));
  for (const mapId of ["tutorial_forest", "infernal_depths"] as MapId[]) views.push(await mapView({ mapId, ...DESKTOP, title: `${mapId} · desktop` }));
  for (const view of views) await view.draw();
}


/**
 * The Town: its baked ground, the river by the west bridge, Ox, the countryside; the framing with attack-range
 * research, the player's zoom at 50% and 150%; and the desktop framing.
 */
export async function town() {
  const phones = strip();
  const mapId = TOWN_MAP_ID as MapId;
  const ox = TOWN_OX_DECOR;
  const views = [
    await mapView({ mapId, ...PHONE, parent: phones, title: "town · arrival" }),
    // Attack-range research reaches further without moving the camera: the same frame as the arrival.
    await mapView({ mapId, ...PHONE, parent: phones, title: "town · range research rank 5", arrange: state => { state.player.attackRange = attackRangeWithResearch(5); } }),
    await mapView({ mapId, ...PHONE, parent: phones, title: "town · zoom 50%", zoomSteps: -10 }),
    await mapView({ mapId, ...PHONE, parent: phones, title: "town · zoom 150%", zoomSteps: 10 }),
    await mapView({ mapId, ...PHONE, parent: phones, title: "town · the river at the west bridge", at: { x: TOWN_WEST_BRIDGE.x, y: TOWN_WEST_BRIDGE.y + 60 } }),
    await mapView({ mapId, ...PHONE, parent: phones, title: "town · Ox", at: { x: ox.x + 70, y: ox.y + 90 } }),
    await mapView({ mapId, ...PHONE, parent: phones, title: "town · countryside", at: { x: TOWN_CENTER.x + 3_000, y: TOWN_CENTER.y - 1_500 } }),
    await mapView({ mapId, ...DESKTOP, title: "town · desktop" }),
  ];
  for (const view of views) await view.draw();
}
