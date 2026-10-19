import type { WoodId } from "../../../../shared/crafting";
import { WOOD_TREE_NODES, WOOD_TREES } from "../../../../shared/woodcutting";
import { MINING_PLATE } from "../../town-world";
import type { WorldDecor } from "../../world";
import type { Camera } from "../render/camera";
import { cameraZoomPreference } from "../render/camera-zoom-preference";
import { drawScreenSpaceAt, snapWorldRenderCoordinate } from "../render/render-space";
import { soulFrame, type SoulPropDecor } from "../soul/soul-prop-renderer";
import { drawMiningPlate, MINING_PLATE_FONT } from "./ore-rock-renderer";
import { woodcuttingScene } from "./woodcutting-scene";

export type WoodTreeDecor = Extract<WorldDecor, { type: "woodTree" }>;

/** Each wood's bark, its cut face and the rings on it: pale pine, brown oak, red yew, grey old elder. */
export const LOG_COLORS: Readonly<Record<WoodId, { bark: string; barkDark: string; face: string; ring: string }>> = {
  pine_log: { bark: "#9a6a3e", barkDark: "#6f4627", face: "#f0d39c", ring: "#c99d5e" },
  oak_log: { bark: "#73502f", barkDark: "#4e341d", face: "#dcab6c", ring: "#a97a43" },
  yew_log: { bark: "#84402f", barkDark: "#5a2a1e", face: "#e8a07a", ring: "#b5653f" },
  elder_log: { bark: "#5d5248", barkDark: "#3c342d", face: "#d8cfb2", ring: "#958b73" },
};

/** What a felled tree leaves for whoever felled it until it grows back: one of the pack's stumps. */
export const TREE_STUMPS = ["Tree_Stump_01", "Tree_Stump_02", "Tree_Stump_03"] as const;
export const stumpFrame = (treeId: number) => TREE_STUMPS[treeId % TREE_STUMPS.length];

/** How far a tree reaches from its foot, for culling: its crown above, its plate below (generously, as a rock's). */
export function woodTreeExtent(tree: WoodTreeDecor) {
  const frame = soulFrame(tree.frame);
  if (!frame) return { left: 0, right: 0, up: 0, down: 0 };
  const side = Math.max(frame.ax, frame.w - frame.ax, MINING_PLATE.width) * tree.s;
  return { left: side, right: side, up: frame.ay * tree.s + 20, down: Math.max((frame.h - frame.ay) * tree.s, MINING_PLATE.drop + MINING_PLATE.height * 2) };
}

/**
 * Draws Timberwood's trees: the pack's own tree, or for whoever felled it its stump until it grows back, and under
 * the tree being chopped a plate with its name and how far along, as a rock being mined has (ore-rock-renderer.ts).
 * The tree shakes a little on each hit.
 */
export function createWoodTreeRenderer(options: {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  devicePixelRatio: () => number;
  drawSoulProp: (prop: SoulPropDecor) => void;
  outlinedText: (text: string, x: number, y: number, color: string, strokeWidth?: number) => void;
}) {
  /** The plate under the tree being chopped, as last drawn: a tree drawn after it that reaches over it draws it again. */
  let plate: { node: number; area: { left: number; top: number; right: number; bottom: number }; draw: () => void } | null = null;
  return function drawWoodTree(item: WoodTreeDecor) {
    const tree = WOOD_TREE_NODES[item.node];
    const frame = soulFrame(item.frame);
    if (!tree || !frame) return;
    const { ctx, camera } = options;
    const felled = woodcuttingScene.felled.has(tree.id), chopping = woodcuttingScene.target === tree.id;
    if (felled) options.drawSoulProp({ type: "soulProp", x: item.x, y: item.y, s: 1, frame: stumpFrame(tree.id), flip: item.flip });
    else if (chopping && woodcuttingScene.swingClock > 0) {
      // A small sway as the hatchet bites, leaning from the foot.
      ctx.save();
      const x = snapWorldRenderCoordinate(item.x - camera.x, camera.zoom, options.devicePixelRatio()), y = snapWorldRenderCoordinate(item.y - camera.y, camera.zoom, options.devicePixelRatio());
      ctx.translate(x, y); ctx.rotate(Math.sin(woodcuttingScene.swingClock * 30) * .012); ctx.translate(-x, -y);
      options.drawSoulProp({ type: "soulProp", x: item.x, y: item.y, s: item.s, frame: item.frame, flip: item.flip });
      ctx.restore();
    } else options.drawSoulProp({ type: "soulProp", x: item.x, y: item.y, s: item.s, frame: item.frame, flip: item.flip });
    if (!chopping) {
      if (plate && plate.node === woodcuttingScene.target) {
        const left = item.x - (item.flip ? frame.w - frame.ax : frame.ax) * item.s, top = item.y - frame.ay * item.s;
        const { area } = plate;
        if (left < area.right && left + frame.w * item.s > area.left && top < area.bottom && top + frame.h * item.s > area.top) plate.draw();
      }
      return;
    }
    const dpr = options.devicePixelRatio();
    const x = snapWorldRenderCoordinate(item.x - camera.x, camera.zoom, dpr), y = snapWorldRenderCoordinate(item.y - camera.y, camera.zoom, dpr);
    const progress = Math.max(0, Math.min(1, woodcuttingScene.progress));
    const name = WOOD_TREES[tree.kind].name, colors = { light: LOG_COLORS[tree.log].face };
    ctx.save();
    ctx.font = MINING_PLATE_FONT;
    const plateWidth = Math.min(MINING_PLATE.width, Math.max(76, ctx.measureText(name).width + 18));
    ctx.restore();
    const draw = () => drawScreenSpaceAt(ctx, camera.zoom, x, y + MINING_PLATE.drop, () => drawMiningPlate(ctx, name, plateWidth, colors, progress, options.outlinedText));
    draw();
    const scale = cameraZoomPreference() / (camera.zoom > 0 ? camera.zoom : 1);
    plate = {
      node: tree.id, draw,
      area: { left: item.x - plateWidth / 2 * scale, right: item.x + plateWidth / 2 * scale, top: item.y + MINING_PLATE.drop, bottom: item.y + MINING_PLATE.drop + MINING_PLATE.height * scale },
    };
  };
}
