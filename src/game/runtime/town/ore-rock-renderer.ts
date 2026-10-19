import { MINING_NODES, miningNodeName, type RockOreId } from "../../../../shared/mining";
import { MINING_PLATE } from "../../town-world";
import type { WorldDecor } from "../../world";
import type { Camera } from "../render/camera";
import { cameraZoomPreference } from "../render/camera-zoom-preference";
import { drawScreenSpaceAt, snapWorldRenderCoordinate } from "../render/render-space";
import { soulFrame, type SoulPropDecor } from "../soul/soul-prop-renderer";
import { miningScene } from "./mining-scene";

export type OreRockDecor = Extract<WorldDecor, { type: "oreRock" }>;

/** Each ore's crystals: a lit face, a shaded face and a dark rim, flat like the pack's own art. */
export const ORE_COLORS: Readonly<Record<RockOreId, { light: string; dark: string; rim: string }>> = {
  copper_ore: { light: "#ffb36b", dark: "#d06f2f", rim: "#4a2410" },
  iron_ore: { light: "#c3d0dc", dark: "#5d6b7a", rim: "#222a33" },
  mithril_ore: { light: "#a6ecff", dark: "#3ba3dd", rim: "#123a52" },
  adamant_ore: { light: "#d1a8ff", dark: "#7d45d8", rim: "#2b1452" },
  arcane_crystal: { light: "#ffa8e4", dark: "#d23f9f", rim: "#4d1038" },
};

/**
 * Where each stone's crystals grow, from its foot in world units at scale 1: a cluster on the lit top face, and
 * on the two big stones a smaller one on the lit side face, [x, y, the middle crystal's height]. Measured on the
 * pack's own art, inside its outline; mirrored with the stone.
 */
export const CRYSTAL_CLUSTERS: Readonly<Record<string, readonly (readonly [number, number, number])[]>> = {
  Stone_01_Gray: [[-8, -26, 23]],
  Stone_04_Gray: [[-6, -34, 23]],
  Stone_02_Gray: [[6, -51, 28], [-24, -24, 16]],
  Stone_07_Gray: [[6, -30, 26], [-38, -21, 16]],
};
/** A Mysterious rock's sparkles, from its foot: they twinkle in turn. */
const SPARKLES: readonly (readonly [number, number])[] = [[-34, -66], [30, -78], [2, -92]];

/** How far a rock reaches from its foot, for culling: its crystals and sparkles above, its plate below (generously: the plate keeps its screen size). */
export function oreRockExtent(rock: OreRockDecor) {
  const frame = soulFrame(rock.frame);
  if (!frame) return { left: 0, right: 0, up: 0, down: 0 };
  const side = Math.max(frame.ax, frame.w - frame.ax, MINING_PLATE.width) * rock.s;
  return { left: side, right: side, up: frame.ay * rock.s + 40, down: Math.max((frame.h - frame.ay) * rock.s, MINING_PLATE.drop + MINING_PLATE.height * 2) };
}

type OreColors = { light: string; dark: string; rim: string };

/** One crystal, standing `h` tall from its base at the origin, as the pack draws: a lit face, a shaded face, a dark rim, a glint. */
function drawShard(ctx: CanvasRenderingContext2D, h: number, colors: OreColors) {
  const w = h * .48;
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h * .62); ctx.lineTo(0, -h); ctx.lineTo(w / 2, -h * .62); ctx.lineTo(w / 2, 0); ctx.closePath();
  };
  outline();
  ctx.fillStyle = colors.dark; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h * .62); ctx.lineTo(0, -h); ctx.lineTo(0, 0); ctx.closePath();
  ctx.fillStyle = colors.light; ctx.fill();
  outline();
  ctx.lineJoin = "round"; ctx.lineWidth = 2; ctx.strokeStyle = colors.rim; ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.fillRect(-w * .3, -h * .66, Math.max(1.5, w * .17), h * .36);
}

/**
 * A cluster of three crystals growing out of a hollow in the stone at (x, y): a tall one in the middle and a
 * shorter one leaning out each side. `mirror` (-1) turns it, light and all, with a mirrored stone.
 */
function drawCrystalCluster(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, mirror: number, colors: OreColors) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(mirror, 1);
  ctx.fillStyle = "rgba(34, 40, 46, .38)";
  ctx.beginPath();
  ctx.ellipse(0, 1, size * .6, size * .19, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const [dx, dy, scale, lean] of [[-.3, 1, .62, -.42], [.32, 2, .54, .5], [0, 2, 1, 0]] as const) {
    ctx.save();
    ctx.translate(dx * size, dy);
    ctx.rotate(lean);
    drawShard(ctx, size * scale, colors);
    ctx.restore();
  }
  ctx.restore();
}

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = "#fff6ff";
  ctx.beginPath();
  ctx.moveTo(x, y - size); ctx.quadraticCurveTo(x, y, x + size, y); ctx.quadraticCurveTo(x, y, x, y + size);
  ctx.quadraticCurveTo(x, y, x - size, y); ctx.quadraticCurveTo(x, y, x, y - size); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draws the Copper Hills' ore rocks: the pack's stone with its vein's crystals in it, a Mysterious rock glowing and
 * sparkling, a bare rock faded with nothing in it, and under the rock being mined a plate with its name and how far
 * along. Their shadows are baked into the ground with the countryside's (town-world.ts).
 */
export function createOreRockRenderer(options: {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  devicePixelRatio: () => number;
  /** Seconds, for the glow and the sparkles. */
  time: () => number;
  drawSoulProp: (prop: SoulPropDecor) => void;
  outlinedText: (text: string, x: number, y: number, color: string, strokeWidth?: number) => void;
}) {
  /**
   * The plate under the rock being mined, as last drawn, and the part of the world it covers. Rocks are drawn
   * north to south, so only a rock drawn after it can reach over it: when one does, the plate is drawn again on
   * top of it. Opaque, so drawing it again changes nothing else.
   */
  let plate: { node: number; area: { left: number; top: number; right: number; bottom: number }; draw: () => void } | null = null;
  return function drawOreRock(rock: OreRockDecor) {
    const node = MINING_NODES[rock.node];
    const frame = soulFrame(rock.frame);
    if (!node || !frame) return;
    const { ctx, camera } = options;
    const dpr = options.devicePixelRatio();
    const x = snapWorldRenderCoordinate(rock.x - camera.x, camera.zoom, dpr);
    const y = snapWorldRenderCoordinate(rock.y - camera.y, camera.zoom, dpr);
    const bare = miningScene.bare.has(node.id), mysterious = node.kind === "mysterious";
    const width = frame.w * rock.s, time = options.time();
    if ((mysterious || node.kind === "crystal") && !bare) {
      // A slow pulse behind it, violet for a Mysterious rock and rose for crystal: something in this one is not like
      // the rest. Filled to exactly the gradient's own circle, so it fades out to nothing with no edge anywhere.
      const cy = y - frame.ay * rock.s * .55, radius = width * .85, tint = mysterious ? "226, 190, 255" : "255, 176, 228";
      const glow = ctx.createRadialGradient(x, cy, 4, x, cy, radius);
      const pulse = .32 + .14 * Math.sin(time * 2.4);
      glow.addColorStop(0, `rgba(${tint}, ${pulse})`);
      glow.addColorStop(.6, `rgba(${tint}, ${pulse * .35})`);
      glow.addColorStop(1, `rgba(${tint}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    if (bare) ctx.globalAlpha *= .5;
    options.drawSoulProp({ type: "soulProp", x: rock.x, y: rock.y, s: rock.s, frame: rock.frame, flip: rock.flip });
    ctx.restore();
    if (!bare) {
      const colors = ORE_COLORS[node.ore], mirror = rock.flip ? -1 : 1;
      for (const [dx, dy, size] of CRYSTAL_CLUSTERS[rock.frame] ?? []) drawCrystalCluster(ctx, x + dx * mirror * rock.s, y + dy * rock.s, size * rock.s, mirror, colors);
      if (mysterious) SPARKLES.forEach(([dx, dy], index) => drawSparkle(ctx, x + dx * rock.s, y + dy * rock.s, 6, Math.sin(time * 3.1 + index * 2.1)));
    }
    if (miningScene.target !== node.id) {
      if (plate && plate.node === miningScene.target) {
        const left = rock.x - (rock.flip ? frame.w - frame.ax : frame.ax) * rock.s, top = rock.y - frame.ay * rock.s;
        const { area } = plate;
        if (left < area.right && left + frame.w * rock.s > area.left && top < area.bottom && top + frame.h * rock.s > area.top) plate.draw();
      }
      return;
    }
    // The rock being mined: its name, as Morkyl named them, and the break's progress in its ore's colour, on a
    // plate below it that points up at it. Below the reach, so never on whoever mines it: their feet are within
    // MINING_REACH of the rock's, and nothing of them comes lower than their feet.
    const progress = Math.max(0, Math.min(1, miningScene.progress));
    const name = miningNodeName(node), colors = ORE_COLORS[node.ore];
    ctx.save();
    ctx.font = MINING_PLATE_FONT;
    const plateWidth = Math.min(MINING_PLATE.width, Math.max(76, ctx.measureText(name).width + 18));
    ctx.restore();
    const draw = () => drawScreenSpaceAt(ctx, camera.zoom, x, y + MINING_PLATE.drop, () => drawMiningPlate(ctx, name, plateWidth, colors, progress, options.outlinedText));
    draw();
    // The plate keeps its size on screen, as every label does: in the world it is this much bigger.
    const scale = cameraZoomPreference() / (camera.zoom > 0 ? camera.zoom : 1);
    plate = {
      node: node.id, draw,
      area: { left: rock.x - plateWidth / 2 * scale, right: rock.x + plateWidth / 2 * scale, top: rock.y + MINING_PLATE.drop, bottom: rock.y + MINING_PLATE.drop + MINING_PLATE.height * scale },
    };
  };
}

export const MINING_PLATE_FONT = '900 11px "Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif';

/** The plate under a rock or tree being worked: its name, and how far along in `colors.light`. */
export function drawMiningPlate(ctx: CanvasRenderingContext2D, name: string, width: number, colors: Pick<OreColors, "light">, progress: number,
  outlinedText: (text: string, x: number, y: number, color: string, strokeWidth?: number) => void) {
  ctx.font = MINING_PLATE_FONT;
  const half = width / 2, top = 6;
  ctx.fillStyle = "#151515";
  ctx.beginPath();
  // A pill with a little point on top, under the rock it names.
  ctx.moveTo(-6, top); ctx.lineTo(0, 0); ctx.lineTo(6, top);
  ctx.arcTo(half, top, half, MINING_PLATE.height, 9);
  ctx.arcTo(half, MINING_PLATE.height, -half, MINING_PLATE.height, 9);
  ctx.arcTo(-half, MINING_PLATE.height, -half, top, 9);
  ctx.arcTo(-half, top, 6, top, 9);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  outlinedText(name, 0, top + 10, colors.light, 3);
  const barWidth = width - 20;
  ctx.fillStyle = "#2b2b2b"; ctx.fillRect(-barWidth / 2, top + 19, barWidth, 5);
  ctx.fillStyle = colors.light; ctx.fillRect(-barWidth / 2, top + 19, barWidth * progress, 5);
}
