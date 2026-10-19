import { STARTER_CHEST_MAP_ID, STARTER_CHEST_POSITION } from "../../../../shared/starter-chest";
import type { MapId, WorldDecor } from "../../world";
import type { Camera } from "./camera";
import { drawScreenSpaceAt, snapWorldRenderCoordinate } from "./render-space";

export type StarterChestDecor = Extract<WorldDecor, { type: "starterChest" }>;

/** The pack's closed chest (village-props frame 265) with its shadow, cut into its own small sheet. */
export const STARTER_CHEST_SOURCE = "assets/wildstat/starter-chest.webp";
const ART = { w: 62, h: 59, ax: 31, ay: 48 } as const;

/** Whether this player's chest still waits: the runtime sets it each frame (starter-chest-window.ts). */
export const starterChestScene = { waiting: false };

/** The forest's decor with the chest added at its spot; other maps' unchanged. */
export function withStarterChest(decor: WorldDecor[], mapId: MapId): WorldDecor[] {
  if (mapId !== STARTER_CHEST_MAP_ID) return decor;
  return [...decor, { type: "starterChest", x: STARTER_CHEST_POSITION.x, y: STARTER_CHEST_POSITION.y, s: 1 }];
}

/** How far the chest and its label reach from its foot, for culling. */
export function starterChestExtent(item: StarterChestDecor) {
  return { left: 70, right: 70, up: ART.ay * item.s + 50, down: (ART.h - ART.ay) * item.s };
}

/** Draws the chest and the name over it while it waits; once opened it is gone. The sheet loads on first draw. */
export function createStarterChestRenderer(options: {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  devicePixelRatio: () => number;
  time: () => number;
  outlinedText: (text: string, x: number, y: number, color: string, strokeWidth?: number) => void;
}) {
  let image: HTMLImageElement | null = null;
  return function drawStarterChest(item: StarterChestDecor) {
    if (!starterChestScene.waiting) return;
    if (!image) {
      image = new Image();
      image.decoding = "async";
      image.src = STARTER_CHEST_SOURCE;
    }
    const { ctx, camera } = options, dpr = options.devicePixelRatio();
    const x = snapWorldRenderCoordinate(item.x - camera.x, camera.zoom, dpr), y = snapWorldRenderCoordinate(item.y - camera.y, camera.zoom, dpr);
    if (image.complete && image.naturalWidth > 0) ctx.drawImage(image, x - ART.ax * item.s, y - ART.ay * item.s, ART.w * item.s, ART.h * item.s);
    // Named like the Town's stations, in plain white.
    drawScreenSpaceAt(ctx, camera.zoom, x, y - ART.ay * item.s - 4, () => {
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const bob = Math.sin(options.time() * 2.2) * 2;
      ctx.font = '900 15px "Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif';
      options.outlinedText("Starter Chest", 0, -18 + bob, "#ffffff", 4);
      ctx.font = '900 13px "Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif';
      options.outlinedText("Pick Your Weapon", 0, -2 + bob, "#d6d6d6", 4);
    });
  };
}
