import { GUILD_HALL_FEET_OFFSET } from "../../../../shared/guild-hall";
import { guildEmblemCell } from "../../../ui/guild-emblems";
import {
  GUILD_HALL_FOREST_TILE, GUILD_HALL_GROUND, guildHallRoomPicture, guildHallSeatAt, guildHallShown, type GuildHallSeat,
} from "../../guild-hall";
import type { Camera } from "../render/camera";
import { snapWorldRenderCoordinate } from "../render/render-space";

/** The wood's floor, the tile's own colour: drawn alone until the tile has loaded. */
const GUILD_HALL_FOREST_FLOOR = "#4a6b35";
/** Sitting: the body drops this far onto the stool, and nothing of it below this far under its position is drawn. */
const SIT_DROP = 6, SIT_CLIP = 16;
/** Sitting faces the table: north seats look down at it, south seats up (an angle, y down). */
export const GUILD_HALL_SEAT_FACING: Readonly<Record<GuildHallSeat["side"], number>> = { north: Math.PI / 2, south: -Math.PI / 2 };

/** The seat someone standing still at this position is in, on a guild hall map. */
export const seatedAt = (x: number, y: number) => guildHallShown.seats.length ? guildHallSeatAt(x, y + GUILD_HALL_FEET_OFFSET) : null;

/**
 * Draws someone sitting at the great table: moved onto the seat, their legs
 * (under the table top or on the stool) cut away and the body lowered onto it.
 * `x`, `y` are their world position and `screenY` where that is on screen;
 * anyone not seated is drawn as they are.
 */
export function drawSeated(ctx: CanvasRenderingContext2D, x: number, y: number, screenY: number, seat: GuildHallSeat | null, draw: () => void) {
  if (!seat) { draw(); return; }
  const dx = seat.x - x, dy = seat.y - GUILD_HALL_FEET_OFFSET - y;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-1e5, -1e5, 2e5, 1e5 + screenY + dy + SIT_CLIP);
  ctx.clip();
  ctx.translate(dx, dy + SIT_DROP);
  draw();
  ctx.restore();
}

/**
 * Under the ground image: indoors, the dark over the whole view; outdoors, the wood's tile repeated over the
 * view, however wide the screen, so no dark ever shows outside. Plain image draws, which the WebGL sprite pass
 * records like any other (a canvas pattern would send the frame back to the 2D canvas).
 */
export function createGuildHallUnderDrawer(options: {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  forest: () => HTMLImageElement | undefined;
  devicePixelRatio: () => number;
}) {
  return (viewRight: number, viewBottom: number) => {
    const { ctx, camera } = options;
    const image = options.forest();
    if (guildHallShown.indoors || !image?.complete || image.naturalWidth <= 0) {
      ctx.fillStyle = guildHallShown.indoors ? "#000" : GUILD_HALL_FOREST_FLOOR;
      ctx.fillRect(0, 0, viewRight - camera.x, viewBottom - camera.y);
      return;
    }
    const { w, h } = GUILD_HALL_FOREST_TILE, ground = GUILD_HALL_GROUND;
    const snap = (value: number) => snapWorldRenderCoordinate(value, camera.zoom, options.devicePixelRatio());
    // Tiles from the world's origin; one wholly under the opaque courtyard ground is skipped. A unit's overlap hides seams.
    for (let y = Math.floor(camera.y / h) * h; y < viewBottom; y += h) {
      for (let x = Math.floor(camera.x / w) * w; x < viewRight; x += w) {
        if (x >= ground.x && y >= ground.y && x + w <= ground.x + ground.w && y + h <= ground.y + ground.h) continue;
        ctx.drawImage(image, snap(x - camera.x), snap(y - camera.y), w + 1, h + 1);
      }
    }
  };
}

/** The room for the hall's size, under its furniture, while the player is indoors. */
export function createGuildHallRoomsDrawer(options: {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  rooms: () => HTMLImageElement | undefined;
  devicePixelRatio: () => number;
}) {
  return () => {
    const { ctx, camera } = options;
    if (!guildHallShown.indoors) return;
    const image = options.rooms();
    if (!image?.complete || image.naturalWidth <= 0) return;
    const room = guildHallRoomPicture(guildHallShown.size);
    const snap = (value: number) => snapWorldRenderCoordinate(value, camera.zoom, options.devicePixelRatio());
    ctx.drawImage(image, room.sx, room.sy, room.w, room.h, snap(room.x - camera.x), snap(room.y - camera.y), room.w, room.h);
  };
}

/** Draws the hall's guild badge, `size` square, centred at a point on screen; nothing until the guild is known. */
export function createGuildCrestDrawer(sheets: () => readonly (HTMLImageElement | undefined)[] | undefined) {
  return (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
    if (guildHallShown.emblem < 0) return;
    const cell = guildEmblemCell(guildHallShown.emblem);
    const image = sheets()?.[cell.sheet];
    if (!image?.complete || image.naturalWidth <= 0) return;
    // The sheets are fitted at 1254px; a smaller export scales the frame with it.
    const scale = image.naturalWidth / 1254;
    ctx.drawImage(image, cell.x * scale, cell.y * scale, cell.size * scale, cell.size * scale, x - size / 2, y - size / 2, size, size);
  };
}
