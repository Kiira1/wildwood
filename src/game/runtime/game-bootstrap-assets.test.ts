import { afterEach, expect, it, vi } from "vitest";
import { createGameBootstrapAssets } from "./game-bootstrap";
import { generatedBossArt, generatedMapContent } from "../procedural-maps";
import { enemySpriteAssetSources } from "../enemies";
import { ENEMY_SPRITE_LAYOUTS } from "../enemy-sprite-layouts.mjs";

// Keep the production bootstrap and sprite loader connected; unrelated canvas
// renderers have no role in map sprite preparation.
vi.mock("./asset-preprocessor", () => ({ createAssetPreprocessor: () => ({
  ensureMapAssets: async () => {}, mapAssetsReady: () => true,
  mapAssetLoadFailed: () => false, worldArtReady: () => true,
}) }));
vi.mock("../player-appearance", () => ({ loadPlayerAppearanceAssets: () => ({}) }));
vi.mock("./profile-character-preview", () => ({ createProfileCharacterPreview: () => ({}) }));
vi.mock("./inventory-character-preview", () => ({ createInventoryCharacterPreview: () => ({}) }));
vi.mock("./leaderboard-podium-preview", () => ({ createLeaderboardPodiumPreview: () => ({}) }));
afterEach(() => vi.unstubAllGlobals());

it("prepares generated enemies and bosses through the actual startup asset wiring", async () => {
  const images: FakeImage[] = [];
  class FakeImage extends EventTarget {
    src = "";
    constructor() { super(); images.push(this); }
  }
  vi.stubGlobal("Image", FakeImage);
  const { assets } = createGameBootstrapAssets({
    profileCharacterCanvas: {} as HTMLCanvasElement,
    inventoryCharacterCanvas: {} as HTMLCanvasElement,
    onWorldArtReady: () => {}, onPlayerAppearanceAssetReady: () => {},
  });
  expect(assets.mapAssetsReady("endless_1")).toBe(false);
  for (const mapId of ["endless_1", "endless_2", "endless_40"] as const) {
    const prepared = assets.ensureMapAssets(mapId);
    const kinds = [...generatedMapContent(mapId).kinds, generatedBossArt(mapId)];
    const requested = new Set(images.map(image => image.src));
    for (const kind of kinds)
      for (const source of enemySpriteAssetSources(ENEMY_SPRITE_LAYOUTS[kind]))
        expect(requested.has(source), `${mapId}: ${source}`).toBe(true);
    for (const image of images.filter(image => image.src)) image.dispatchEvent(new Event("load"));
    await prepared;
    expect(assets.mapAssetsReady(mapId)).toBe(true);
    expect(assets.mapAssetLoadFailed(mapId)).toBe(false);
  }
});
