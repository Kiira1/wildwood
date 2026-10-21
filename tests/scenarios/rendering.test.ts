import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { bootGame, gameWorld, playAs } from "./harness/game";
import { imageSize, LoadingImage } from "./harness/browser";
import { fileURLToPath } from "node:url";
import { fakeGpu, playWithGpu, watchArt } from "./harness/render";
import { stubGameBootEnvironment } from "../helpers/game-boot-environment";
import { createGameBootstrapAssets } from "../../src/game/runtime/game-bootstrap";
import { BOSSES, BOSS_KINDS, type BossArtSource } from "../../src/game/runtime/boss/boss-registry";
import { MAP_ASSET_GROUPS } from "../../src/game/runtime/render/map-asset-groups";
import { ENEMY_SPRITE_LAYOUTS } from "../../src/game/enemy-sprite-layouts.mjs";
import { enemySpriteAssetSources, type EnemySpriteSource } from "../../src/game/enemies";
import { ITEM_PRESENTATIONS } from "../../src/game/item-presentation";
import { hatchetArtSource } from "../../src/game/runtime/town/hatchet-sprite";
import { PORTAL_SWIRL_SOURCE } from "../../src/game/portal-presentation";
import { DUEL_PLATFORM_ART_SOURCE, DUEL_SPACE_BACKGROUND_SOURCE } from "../../src/game/duel";
import { generatedBossArt, generatedMapContent } from "../../src/game/procedural-maps";
import { createSpawnSites, TUTORIAL_FOREST_MAP_ID, type MapId } from "../../src/game/world";
import { GENERATED_ENEMY_ART } from "../../shared/procedural-enemy-art";
import { CAMPAIGN_MAPS } from "../../shared/campaign-registry";
import { TOOL_MAX_LEVEL } from "../../shared/tools";

const fileOf = (path: string) => fileURLToPath(new URL(`../../public/${path}`, import.meta.url));
const shipped = (path: string) => existsSync(new URL(`../../public/${path.replace(/^\//, "")}`, import.meta.url));
const enemyArt = (kind: string) => enemySpriteAssetSources(ENEMY_SPRITE_LAYOUTS[kind as keyof typeof ENEMY_SPRITE_LAYOUTS] as EnemySpriteSource);
const bossArt = (art: BossArtSource) => "sheet" in art ? [art.sheet] : art.used.map(page => art.pages[page]);
const CAMPAIGN = CAMPAIGN_MAPS.map(map => map.id as MapId);

describe("map art lifecycle", () => {
  it("a new session asks only for the core art and its own map's; other maps and the duel arena wait", async () => {
    const art = watchArt();
    const tab = await playAs(gameWorld(), "Ann");
    expect(tab.coop.localState()?.mapId).toBe(TUTORIAL_FOREST_MAP_ID);
    const asked = new Set(art.requests);
    // The Forest's boss and every camp it spawns.
    for (const source of bossArt(BOSSES.dragon.art)) expect(asked, source).toContain(source);
    for (const kind of MAP_ASSET_GROUPS[TUTORIAL_FOREST_MAP_ID].enemies) for (const source of enemyArt(kind)) expect(asked, source).toContain(source);
    // Nothing that belongs only to another map, and no duel arena.
    const forest = new Set(MAP_ASSET_GROUPS[TUTORIAL_FOREST_MAP_ID].enemies.flatMap(enemyArt));
    for (const mapId of CAMPAIGN.filter(id => id !== TUTORIAL_FOREST_MAP_ID)) {
      const boss = BOSS_KINDS.map(kind => BOSSES[kind]).find(entry => entry.mapId === mapId);
      for (const source of [...(boss ? bossArt(boss.art) : []), ...MAP_ASSET_GROUPS[mapId].enemies.flatMap(enemyArt)]) {
        if (!forest.has(source)) expect(asked, `${mapId}: ${source}`).not.toContain(source);
      }
    }
    expect(asked).not.toContain(DUEL_SPACE_BACKGROUND_SOURCE);
    expect(asked).not.toContain(DUEL_PLATFORM_ART_SOURCE);
    // The loading screen waited only for the bare body and this player's own outfit; other gear follows entry.
    const gearAtEntry = art.asked("player-parts/").length;
    expect(gearAtEntry).toBeLessThan(10);
    await tab.play(3_000);
    expect(art.asked("player-parts/").length).toBeGreaterThan(100);
  }, 30_000);

  it("a download that fails is asked for again down the ladder; one that never arrives stops holding the world once the ladder runs out", async () => {
    const art = watchArt();
    const dragon = bossArt(BOSSES.dragon.art)[0];
    let dragonTries = 0;
    art.failWhen(url =>
      // The Forest's boss fails twice, then arrives; one slime's sheet never does; a leg fails once.
      (url.startsWith(dragon) && ++dragonTries <= 2)
      || url.startsWith("assets/wildstat/enemies/slime-green-stone.webp")
      || (url.includes("basic-leg-front.webp") && !url.includes("asset-retry")));
    const world = gameWorld();
    world.join("Ann").disconnect();
    const tab = await bootGame(world, { name: "Ann" });
    expect(await tab.until(tab.playing, 60_000, 250)).toBe(true);
    expect(art.asked(dragon)).toEqual([dragon, `${dragon}?asset-retry=1`, `${dragon}?asset-retry=2`]);
    // Retried with growing waits until it gives up, without blocking the map.
    const slime = art.asked("slime-green-stone.webp");
    expect(slime.length).toBeGreaterThan(3);
    expect(slime.slice(1).every((url, index) => url.endsWith(`?asset-retry=${index + 1}`))).toBe(true);
    expect(art.asked("basic-leg-front.webp")).toContain("assets/wildstat/player-parts/basic-leg-front.webp?asset-retry=1");
  }, 60_000);

  it("leaving a map lets go of its art and coming back loads it again; Endless maps load their generated art", async () => {
    vi.useFakeTimers();
    const env = stubGameBootEnvironment();
    vi.stubGlobal("Image", LoadingImage);
    (env.window as unknown as { Image: unknown }).Image = LoadingImage;
    const art = watchArt();
    const { assets } = createGameBootstrapAssets({
      profileCharacterCanvas: env.document.createElement("canvas") as unknown as HTMLCanvasElement,
      inventoryCharacterCanvas: env.document.createElement("canvas") as unknown as HTMLCanvasElement,
      onWorldArtReady: () => {}, onPlayerAppearanceAssetReady: () => {}, localOutfit: () => [],
    });
    const load = async (mapId: MapId) => {
      const ready = assets.ensureMapAssets(mapId);
      await vi.advanceTimersByTimeAsync(100);
      await ready;
      return assets.mapAssetsReady(mapId);
    };
    expect(await load(TUTORIAL_FOREST_MAP_ID)).toBe(true);
    expect(await load("beginner_desert" as MapId)).toBe(true);
    const dragon = bossArt(BOSSES.dragon.art)[0];
    assets.releaseMapAssetsExcept(["beginner_desert" as MapId]);
    expect(assets.mapAssetsReady(TUTORIAL_FOREST_MAP_ID)).toBe(false);
    expect(assets.mapAssetsReady("beginner_desert" as MapId)).toBe(true);
    const asked = art.asked(dragon).length;
    expect(await load(TUTORIAL_FOREST_MAP_ID)).toBe(true);
    expect(art.asked(dragon).length).toBe(asked + 1);
    for (const mapId of ["endless_1", "endless_2", "endless_40"] as const) {
      expect(await load(mapId as MapId), mapId).toBe(true);
      for (const kind of [...generatedMapContent(mapId).kinds, generatedBossArt(mapId)]) {
        for (const source of enemyArt(kind)) expect(art.requests, `${mapId}: ${source}`).toContain(source);
      }
    }
  });

  it("every image the game draws ships, each map's art is only what it shows, and sheets stay within budget", () => {
    const sources = new Set<string>([
      ...Object.keys(ENEMY_SPRITE_LAYOUTS).flatMap(enemyArt),
      ...BOSS_KINDS.flatMap(kind => bossArt(BOSSES[kind].art)),
      ...Object.values(ITEM_PRESENTATIONS).flatMap(presentation => [presentation.inventory.source, presentation.world && "source" in presentation.world ? presentation.world.source : undefined,
        presentation.world && "frontSource" in presentation.world ? presentation.world.frontSource : undefined]),
      ...Array.from({ length: TOOL_MAX_LEVEL + 1 }, (_, level) => hatchetArtSource(level)),
      PORTAL_SWIRL_SOURCE,
    ].filter((source): source is string => Boolean(source) && !source!.startsWith("data:")));
    for (const source of sources) expect(shipped(source), source).toBe(true);
    // A map's enemy art is exactly the camps it spawns; Endless never draws a slime.
    for (const mapId of CAMPAIGN) {
      expect(new Set(MAP_ASSET_GROUPS[mapId].enemies), mapId).toEqual(new Set(createSpawnSites({ x: 4_050, y: 4_050 }, mapId).map(site => site.type)));
    }
    for (const kind of GENERATED_ENEMY_ART) expect(ENEMY_SPRITE_LAYOUTS[kind].family, kind).not.toMatch(/^slime/);
    // Animation sheets: WebP at most 2048 across. Boss pages: WebP, each boss within its download and memory budget.
    const pageBytes = (src: string) => statSync(new URL(`../../public/${src}`, import.meta.url)).size;
    const webp = (src: string) => readFileSync(new URL(`../../public/${src}`, import.meta.url)).subarray(8, 12).toString() === "WEBP";
    for (const layout of Object.values(ENEMY_SPRITE_LAYOUTS)) {
      const animation = layout.animation;
      if (!animation) continue;
      for (const page of animation.pages) {
        expect(webp(page.src), page.src).toBe(true);
        expect(imageSize(fileOf(page.src)), page.src).toEqual({ width: page.width, height: page.height });
        expect(Math.max(page.width, page.height), page.src).toBeLessThanOrEqual(2_048);
      }
      // Every frame inside its page.
      for (const clip of Object.values(animation.animations)) for (const frame of clip.frames) {
        const page = animation.pages[frame.page];
        expect(frame.x >= 0 && frame.y >= 0 && frame.x + frame.w <= page.width && frame.y + frame.h <= page.height, page.src).toBe(true);
      }
    }
    for (const kind of BOSS_KINDS) {
      const art = BOSSES[kind].art;
      if (!("pages" in art)) continue;
      const pages = art.used.map(page => art.pages[page]);
      for (const page of pages) {
        expect(webp(page), page).toBe(true);
        const size = imageSize(fileOf(page))!;
        expect(size.width * size.height * 4, page).toBeLessThan(32 * 1024 * 1024);
      }
      expect(pages.reduce((sum, page) => sum + pageBytes(page), 0), kind).toBeLessThan(512 * 1024);
    }
  });
});

describe("the renderer survives failures", () => {
  it("a lost GPU context hands the world to Canvas, the GPU layer comes back with the context, and running out of GPU memory is for good", async () => {
    const gpu = fakeGpu();
    const tab = await playWithGpu(gameWorld(), "Ann", { gpu });
    await tab.play(500);
    expect(tab.shown("gameGpu")).toBe(true);
    const drawn = tab.canvas().draws;
    gpu.lose();
    await tab.play(500);
    // The ground is drawn on the 2D canvas now, and the game goes on.
    expect(tab.shown("gameGpu")).toBe(false);
    expect(tab.canvas().draws).toBeGreaterThan(drawn);
    gpu.restore();
    tab.setHidden(true);
    await tab.play(4_000);
    tab.setHidden(false);
    await tab.play(500);
    expect(tab.shown("gameGpu")).toBe(true);
    // An upload the GPU has no memory for: back to Canvas, and it stays there.
    gpu.runOutOfMemory();
    tab.setHidden(true);
    await tab.play(4_000);
    tab.setHidden(false);
    await tab.play(1_000);
    expect(tab.shown("gameGpu")).toBe(false);
    tab.setHidden(true);
    await tab.play(4_000);
    tab.setHidden(false);
    await tab.play(1_000);
    expect(tab.shown("gameGpu")).toBe(false);
    expect(tab.playing()).toBe(true);
  }, 60_000);

  it("a draw that throws is cleared and the next frames draw at the screen's scale; High Resolution lifts a 3x phone from 2x to 3x pixels", async () => {
    const tab = await playWithGpu(gameWorld(), "Ann", { devicePixelRatio: 3 });
    await tab.play(300);
    expect(tab.canvas().element.width).toBe(390 * 2);
    expect(tab.canvas().transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(tab.canvas().depth).toBe(0);
    // Mid-frame, inside the world's saved and scaled drawing: nothing it set may leak into the next frame.
    tab.failNextDraw();
    await expect(tab.play(50)).rejects.toThrow("GPU draw failed");
    const drawn = tab.canvas().draws;
    await tab.play(500);
    expect(tab.canvas().draws).toBeGreaterThan(drawn);
    expect(tab.canvas().transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(tab.canvas().depth).toBe(0);
    // A canvas whose context the browser restored draws at the screen's scale again, at the same size.
    tab.canvas().element.dispatchEvent(new (tab.window as unknown as { Event: typeof Event }).Event("contextrestored"));
    await tab.play(100);
    expect(tab.canvas().transform).toEqual([2, 0, 0, 2, 0, 0]);
    tab.tap("highResolutionToggle");
    await tab.play(200);
    expect(tab.canvas().element.width).toBe(390 * 3);
    expect(tab.canvas().transform).toEqual([3, 0, 0, 3, 0, 0]);
    tab.tap("highResolutionToggle");
    await tab.play(200);
    expect(tab.canvas().element.width).toBe(390 * 2);
  }, 60_000);
});
