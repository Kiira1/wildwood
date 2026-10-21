import { carapaceAnglerSpriteFrame } from "./carapace-angler-sprite";
import { BOSS_ART } from "./boss-art";
import { drawVoltwardenArt, VOLTWARDEN_ART_TOP } from "./neon-boss-art";
import { drawGravebloomArt, GRAVEBLOOM_ART_TOP } from "./verdant-boss-art";
import { drawAegisPrimeArt, AEGIS_PRIME_ART_TOP } from "./ion-boss-art";
import { bossFrameCrop, drawBossSheetFrame } from "./boss-frame-crop";
import { createGloomrootSpriteCache, GLOOMROOT_SPRITE_FILTER, paintGloomrootAura } from "./gloomroot-sprite-cache";
import { scorpionSpriteFrame } from "./scorpion-sprite";
import { prismshellSpriteFrame } from "./prismshell-sprite";
import { ironhornSpriteFrame } from "./ironhorn-sprite";
import { dreadreaperSpriteFrame } from "./dreadreaper-sprite";
import type { BossArtAssets, BossHazards, BossKind, BossStates } from "./boss-registry";
import type { BossCone } from "../types";
import {
  AEGIS_PRIME_SPRITE_Y_OFFSET, DRAGON_ART_TOP, DRAGON_SPRITE_GROUND_OFFSET, DRAGON_SPRITE_Y_OFFSET, DREADREAPER_ART_TOP,
  DREADREAPER_SPRITE_Y_OFFSET, FROSTCLAW_ART_TOP, FROSTCLAW_SPRITE_GROUND_OFFSET, FROSTCLAW_SPRITE_Y_OFFSET,
  GLOOMROOT_ART_TOP, GLOOMROOT_SPRITE_GROUND_OFFSET, GLOOMROOT_SPRITE_Y_OFFSET, GRAVEBLOOM_SPRITE_Y_OFFSET, IRONHORN_ART_TOP,
  IRONHORN_SPRITE_Y_OFFSET, KOI_SHOGUN_ART_TOP, KOI_SHOGUN_SPRITE_GROUND_OFFSET, KOI_SHOGUN_SPRITE_Y_OFFSET,
  MAGMALISK_ART_TOP, MAGMALISK_SPRITE_GROUND_OFFSET, MAGMALISK_SPRITE_Y_OFFSET, MIREMAW_ART_TOP, MIREMAW_SPRITE_GROUND_OFFSET,
  MIREMAW_SPRITE_Y_OFFSET, PRISMSHELL_ART_TOP, PRISMSHELL_SPRITE_GROUND_OFFSET, PRISMSHELL_SPRITE_Y_OFFSET, SPIDER_ART_TOP,
  SPIDER_SPRITE_GROUND_OFFSET, TAU, TEMPEST_KIRIN_ART_TOP, TEMPEST_KIRIN_SPRITE_GROUND_OFFSET, TEMPEST_KIRIN_SPRITE_Y_OFFSET,
  TIDEWYRM_SPRITE_Y_OFFSET, VOLTWARDEN_SPRITE_Y_OFFSET,
} from "../../constants";

/** What a boss's paint hook gets from the renderer. */
export type BossPaint = {
  ctx: CanvasRenderingContext2D;
  time: number;
  art: BossArtAssets;
  drawShadow: (x: number, y: number, width: number, alpha?: number) => void;
  gloomrootSprites: ReturnType<typeof createGloomrootSpriteCache>;
};

/** The health bar and name over a boss. */
type BossStatusLook = {
  barGap: number; barWidth: number; barHeight: number; fillColor: string;
  name: string; nameColor: string; rewardBottomOffsetY?: number;
};

type SpriteSheetId = keyof typeof BOSS_ART;
type AtlasFrame = ReturnType<typeof ironhornSpriteFrame>;

/** A four-cell strip: frame chosen by state, an optional attack pulse and mirror, and a stand-in drawn when the art is missing. */
type SheetBody<S, H> = {
  body: "sheet";
  sheetId: SpriteSheetId;
  yOffset: number;
  groundOffset: number;
  shadowAlpha: number;
  artTop: number;
  /** Draws the art this much lower than its shadow line. */
  nudgeY?: number;
  frame(state: S, hazards: H, time: number): number;
  /** Breathing scale while attacking; on while hazards stand unless `when` says otherwise. */
  pulse?: { speed: number; amplitude: number; when?(state: S): boolean };
  mirror?(frame: number): boolean;
  /** Without one the boss is skipped (status included) until its art loads. */
  fallback?(ctx: CanvasRenderingContext2D): void;
};

/** An imported atlas prefab that faces left and turns toward its cone attack. */
type AtlasBody<S, H> = {
  body: "atlas";
  atlasId: string;
  yOffset: number;
  /** The status line's top; the frame's own top when absent. */
  artTop?: number;
  spriteFrame(time: number, attackElapsed?: number): AtlasFrame;
  attackElapsed(state: S, hazards: H): number | undefined;
  facing(state: S): BossCone | null;
  groundShadow?(ctx: CanvasRenderingContext2D): void;
  fallback(ctx: CanvasRenderingContext2D): void;
};

/** The expansion bosses pose by attack: a laser while the cone plays, a pulse while hazards stand. */
type PosedBody = {
  body: "posed";
  drawArt: typeof drawVoltwardenArt;
  cropId: string;
  /** Status sits on the posed frame, not the idle one. */
  posedStatus: boolean;
  yOffset: number;
  artTop: number;
};

/** Drawn by its own hook, which returns the status line's top, or null to skip the boss. */
type CustomBody<S, H> = {
  body: "custom";
  paint(paint: BossPaint, state: S, hazards: H, x: number, y: number): number | null;
};

export type BossLook<S, H> = (SheetBody<S, H> | AtlasBody<S, H> | PosedBody | CustomBody<S, H>) & { status: BossStatusLook };

/** The stand-in for a horned boss whose art did not load: a body and two horns. */
function drawHornedSilhouette(ctx: CanvasRenderingContext2D, body: string, outline: string, horns: string) {
  ctx.fillStyle = body;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.ellipse(0, 55, 160, 105, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = horns;
  ctx.beginPath();
  ctx.moveTo(-105, -5);
  ctx.lineTo(-70, -130);
  ctx.lineTo(-25, -5);
  ctx.moveTo(25, -5);
  ctx.lineTo(70, -130);
  ctx.lineTo(105, -5);
  ctx.fill();
  ctx.stroke();
}
const armoredSilhouette = (ctx: CanvasRenderingContext2D) => drawHornedSilhouette(ctx, "#74749c", "#25273e", "#9adff0");

const WIDE_STATUS = { barGap: 34, barWidth: 330, barHeight: 23 };

/** How each world boss is drawn: its art, layout, status bar and the few hooks where one differs. */
export const BOSS_LOOKS: { [K in BossKind]: BossLook<BossStates[K], BossHazards[K]> } = {
  dragon: {
    body: "sheet", sheetId: "DRAGON", yOffset: DRAGON_SPRITE_Y_OFFSET, groundOffset: DRAGON_SPRITE_GROUND_OFFSET,
    shadowAlpha: .24, artTop: DRAGON_ART_TOP,
    frame: (_state, _hazards, time) => Math.floor(time * 4) % 4,
    status: { barGap: 20, barWidth: 220, barHeight: 20, fillColor: "#d8352d", name: "Dragon", nameColor: "#f5e9c4", rewardBottomOffsetY: -5 },
  },
  spider: {
    body: "custom",
    paint: ({ ctx, time, art, drawShadow }, _state, _hazards, x, y) => {
      if (!art.spider.ready()) return null;
      const canvas = art.spider.canvas;
      const frame = scorpionSpriteFrame(time, canvas.width, canvas.height);
      drawShadow(x, y + SPIDER_SPRITE_GROUND_OFFSET, BOSS_ART.SPIDER.shadowWidth, .24);
      // Placed from its feet, hence the top.
      ctx.save();
      ctx.translate(x, 0);
      drawBossSheetFrame(ctx, canvas, {
        bossId: "SPIDER", frame: frame.index,
        sourceX: frame.sourceX, sourceY: frame.sourceY,
        cellWidth: frame.sourceWidth, cellHeight: frame.sourceHeight,
        drawWidth: frame.drawWidth, drawHeight: frame.drawHeight, top: y + frame.topOffset,
      });
      ctx.restore();
      return y + SPIDER_ART_TOP + (bossFrameCrop("SPIDER", frame.index).statusOffsetY ?? 0);
    },
    status: { barGap: 32, barWidth: 250, barHeight: 22, fillColor: "#9f5c2f", name: "Desert Scorpion", nameColor: "#f5e9c4", rewardBottomOffsetY: -5 },
  },
  frostclaw: {
    body: "sheet", sheetId: "FROSTCLAW", yOffset: FROSTCLAW_SPRITE_Y_OFFSET, groundOffset: FROSTCLAW_SPRITE_GROUND_OFFSET,
    shadowAlpha: .27, artTop: FROSTCLAW_ART_TOP, nudgeY: 2,
    frame: (state, hazards, time) => state.roar ? 2 : state.rift ? 1 : hazards.length ? 3 : Math.floor(time * 3.5) % 4,
    pulse: { speed: 15, amplitude: .018, when: (state) => Boolean(state.roar) },
    status: { barGap: 34, barWidth: 270, barHeight: 22, fillColor: "#42c9f5", name: "Frostclaw", nameColor: "#dff8ff" },
  },
  magmalisk: {
    // Uses only source frames 0–2.
    body: "sheet", sheetId: "MAGMALISK", yOffset: MAGMALISK_SPRITE_Y_OFFSET, groundOffset: MAGMALISK_SPRITE_GROUND_OFFSET,
    shadowAlpha: .29, artTop: MAGMALISK_ART_TOP,
    frame: (state, hazards) => hazards.length > 0 ? 2 : state.bite ? 1 : 0,
    pulse: { speed: 14, amplitude: .016 },
    status: { barGap: 34, barWidth: 290, barHeight: 23, fillColor: "#ef6428", name: "Magmalisk", nameColor: "#ffe0ad" },
  },
  gloomroot: {
    body: "custom",
    paint: ({ ctx, time, art, drawShadow, gloomrootSprites }, state, hazards, x, y) => {
      const canvas = art.gloomroot.canvas;
      const frame = hazards.length > 0 ? 3 : state.sweep ? 1 : 0;
      const visualY = y + GLOOMROOT_SPRITE_Y_OFFSET;
      const pulse = hazards.length > 0 ? 1 + Math.sin(time * 13) * .018 : 1;
      drawShadow(x, visualY + GLOOMROOT_SPRITE_GROUND_OFFSET, BOSS_ART.GLOOMROOT.shadowWidth, .3);
      // A moon-sap aura sets the dark treant apart from the Night Forest; aura and filtered frames are baked once.
      if (!gloomrootSprites.drawAura(ctx, x, visualY)) paintGloomrootAura(ctx, x, visualY);
      ctx.save();
      ctx.translate(x, visualY);
      if (art.gloomroot.ready() && canvas.width >= 2 && canvas.height >= 2) {
        const sheetFrame = {
          bossId: "GLOOMROOT", frame, cellWidth: canvas.width / 2, cellHeight: canvas.height / 2, columns: 2,
          drawWidth: BOSS_ART.GLOOMROOT.drawWidth, drawHeight: BOSS_ART.GLOOMROOT.drawHeight,
        };
        if (!gloomrootSprites.drawFrame(ctx, canvas, sheetFrame, pulse)) {
          ctx.scale(pulse, pulse);
          ctx.filter = GLOOMROOT_SPRITE_FILTER;
          drawBossSheetFrame(ctx, canvas, sheetFrame);
        }
      } else {
        gloomrootSprites.reset();
        ctx.scale(pulse, pulse);
        ctx.fillStyle = "#172c3d";
        ctx.strokeStyle = "#65eee9";
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(-68, 176);
        ctx.quadraticCurveTo(-118, 92, -70, 18);
        ctx.lineTo(-132, -58);
        ctx.lineTo(-42, -18);
        ctx.quadraticCurveTo(-24, -138, 0, -184);
        ctx.quadraticCurveTo(28, -132, 42, -18);
        ctx.lineTo(132, -58);
        ctx.lineTo(70, 18);
        ctx.quadraticCurveTo(118, 92, 68, 176);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#9ffff9";
        ctx.fillRect(-40, -78, 22, 14);
        ctx.fillRect(18, -78, 22, 14);
      }
      ctx.restore();
      return visualY + GLOOMROOT_ART_TOP + (bossFrameCrop("GLOOMROOT", frame).statusOffsetY ?? 0);
    },
    status: { barGap: 34, barWidth: 300, barHeight: 23, fillColor: "#39cbd3", name: "Gloomroot", nameColor: "#b9fbf5" },
  },
  tidewyrm: {
    // Its own crop identity; the capture includes the Angler's ground shadow.
    body: "atlas", atlasId: "CARAPACE_ANGLER", yOffset: TIDEWYRM_SPRITE_Y_OFFSET, spriteFrame: carapaceAnglerSpriteFrame,
    attackElapsed: (state) => state.spriteAttackElapsed,
    facing: (state) => state.surge,
    fallback: (ctx) => {
      ctx.fillStyle = "#147f9d";
      ctx.strokeStyle = "#b9f8ff";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.ellipse(0, 35, 150, 88, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#0d405d";
      for (let fin = -2; fin <= 2; fin += 1) {
        ctx.beginPath();
        ctx.moveTo(fin * 42 - 12, -46);
        ctx.lineTo(fin * 42 + 2, -91);
        ctx.lineTo(fin * 42 + 20, -42);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = "#e7ffff";
      ctx.fillRect(-76, -3, 18, 13);
      ctx.fillRect(58, -3, 18, 13);
    },
    status: { barGap: 34, barWidth: 310, barHeight: 23, fillColor: "#35cce5", name: "Carapace Angler", nameColor: "#c7faff" },
  },
  koiShogun: {
    body: "sheet", sheetId: "KOI_SHOGUN", yOffset: KOI_SHOGUN_SPRITE_Y_OFFSET, groundOffset: KOI_SHOGUN_SPRITE_GROUND_OFFSET,
    shadowAlpha: .3, artTop: KOI_SHOGUN_ART_TOP,
    frame: (state, hazards) => hazards.length > 0 ? 3 : state.slash ? (state.slash.windup > 0 ? 2 : 1) : 0,
    pulse: { speed: 14, amplitude: .016 },
    mirror: (frame) => frame === 0 || frame === 1,
    fallback: (ctx) => {
      ctx.fillStyle = "#d87825";
      ctx.strokeStyle = "#4c2917";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.ellipse(0, 30, 145, 90, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e6b84d";
      ctx.beginPath();
      ctx.moveTo(-145, -28);
      ctx.lineTo(0, -112);
      ctx.lineTo(145, -28);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    },
    status: { barGap: 34, barWidth: 310, barHeight: 23, fillColor: "#e2832d", name: "Koi Shogun", nameColor: "#ffe6a4" },
  },
  tempestKirin: {
    body: "sheet", sheetId: "TEMPEST_KIRIN", yOffset: TEMPEST_KIRIN_SPRITE_Y_OFFSET, groundOffset: TEMPEST_KIRIN_SPRITE_GROUND_OFFSET,
    shadowAlpha: .3, artTop: TEMPEST_KIRIN_ART_TOP,
    frame: (state, hazards) => hazards.length > 0 ? 3 : state.charge ? (state.charge.windup > 0 ? 1 : 2) : 0,
    pulse: { speed: 15, amplitude: .016 },
    fallback: (ctx) => {
      ctx.fillStyle = "#ecfaff";
      ctx.strokeStyle = "#23466e";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.ellipse(0, 36, 144, 88, -.08, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#74c8ff";
      ctx.beginPath();
      ctx.moveTo(-95, -15);
      ctx.lineTo(-12, -150);
      ctx.lineTo(45, -15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    },
    status: { barGap: 34, barWidth: 320, barHeight: 23, fillColor: "#65c8ff", name: "Tempest Kirin", nameColor: "#e9fbff" },
  },
  miremaw: {
    body: "sheet", sheetId: "MIREMAW", yOffset: MIREMAW_SPRITE_Y_OFFSET, groundOffset: MIREMAW_SPRITE_GROUND_OFFSET,
    shadowAlpha: .3, artTop: MIREMAW_ART_TOP,
    frame: (state, hazards) => hazards.length > 0 ? 3 : state.tongue ? (state.tongue.windup > 0 ? 1 : 2) : 0,
    pulse: { speed: 14, amplitude: .018 },
    fallback: (ctx) => drawHornedSilhouette(ctx, "#3caa86", "#102b27", "#b788f4"),
    status: { ...WIDE_STATUS, fillColor: "#55d6a8", name: "Miremaw", nameColor: "#e9fff5" },
  },
  prismshell: {
    body: "atlas", atlasId: "PRISMSHELL", yOffset: PRISMSHELL_SPRITE_Y_OFFSET, artTop: PRISMSHELL_ART_TOP, spriteFrame: prismshellSpriteFrame,
    attackElapsed: (state, hazards) => state.shatter
      ? 1.65 - state.shatter.windup - state.shatter.timer
      : hazards.length > 0
        ? Math.max(...hazards.map((burst) => burst.maxTimer - burst.timer))
        : undefined,
    facing: (state) => state.shatter,
    // A soft contact shadow that stays on the floor through breathing and attacks.
    groundShadow: (ctx) => {
      ctx.save();
      ctx.translate(0, PRISMSHELL_SPRITE_GROUND_OFFSET);
      ctx.scale(175, 48);
      const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      shadow.addColorStop(0, "rgba(15, 9, 24, 0.42)");
      shadow.addColorStop(0.55, "rgba(15, 9, 24, 0.28)");
      shadow.addColorStop(1, "rgba(15, 9, 24, 0)");
      ctx.fillStyle = shadow;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    },
    fallback: armoredSilhouette,
    status: { ...WIDE_STATUS, fillColor: "#ab8be6", name: "Prismshell", nameColor: "#f1e9ff" },
  },
  ironhorn: {
    body: "atlas", atlasId: "IRONHORN", yOffset: IRONHORN_SPRITE_Y_OFFSET, artTop: IRONHORN_ART_TOP, spriteFrame: ironhornSpriteFrame,
    attackElapsed: (state) => state.spriteAttackElapsed, facing: (state) => state.shatter, fallback: armoredSilhouette,
    status: { ...WIDE_STATUS, fillColor: "#d9a64e", name: "Ironhorn", nameColor: "#f1e9ff" },
  },
  dreadreaper: {
    body: "atlas", atlasId: "DREADREAPER", yOffset: DREADREAPER_SPRITE_Y_OFFSET, artTop: DREADREAPER_ART_TOP, spriteFrame: dreadreaperSpriteFrame,
    attackElapsed: (state) => state.spriteAttackElapsed, facing: (state) => state.shatter, fallback: armoredSilhouette,
    status: { ...WIDE_STATUS, fillColor: "#a3c563", name: "Dreadreaper", nameColor: "#f1e9ff" },
  },
  voltwarden: {
    body: "posed", drawArt: drawVoltwardenArt, cropId: "VOLTWARDEN", posedStatus: true,
    yOffset: VOLTWARDEN_SPRITE_Y_OFFSET, artTop: VOLTWARDEN_ART_TOP,
    status: { ...WIDE_STATUS, fillColor: "#35dae6", name: "Voltwarden", nameColor: "#f1e9ff" },
  },
  gravebloom: {
    body: "posed", drawArt: drawGravebloomArt, cropId: "GRAVEBLOOM", posedStatus: false,
    yOffset: GRAVEBLOOM_SPRITE_Y_OFFSET, artTop: GRAVEBLOOM_ART_TOP,
    status: { ...WIDE_STATUS, fillColor: "#35dae6", name: "Gravebloom", nameColor: "#f1e9ff" },
  },
  aegisPrime: {
    body: "posed", drawArt: drawAegisPrimeArt, cropId: "AEGIS_PRIME", posedStatus: false,
    yOffset: AEGIS_PRIME_SPRITE_Y_OFFSET, artTop: AEGIS_PRIME_ART_TOP,
    status: { ...WIDE_STATUS, fillColor: "#35dae6", name: "Aegis Prime", nameColor: "#f1e9ff" },
  },
};
