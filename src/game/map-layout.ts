import { withPackMushrooms } from "./pack-mushrooms";
import { withPackForest } from "./pack-forest";
import { withStarterChest } from "./runtime/render/starter-chest-renderer";
import { createWorldLayout, type MapId } from "./world";

/** A map's paths and decor as laid for a player arriving at `spawn`: the world rebuild and the portal glimpse share it. */
export function mapWorldLayout(spawn: { x: number; y: number }, mapId: MapId) {
  const layout = createWorldLayout(spawn, mapId);
  return { paths: layout.paths, decor: withStarterChest(withPackForest(withPackMushrooms(layout.decor, mapId), mapId), mapId) };
}
