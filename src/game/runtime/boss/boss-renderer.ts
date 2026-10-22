import { drawVerdantAttacks } from "./verdant-attack-art";
import { decodedImage } from "../render/decoded-image";
import { drawIonAttacks } from "./ion-attack-art";
import { drawNeonAttacks } from "./neon-attack-art";
import { BOSS_ART } from "./boss-art";
import { BOSS_LOOKS, type BossLook, type BossPaint } from "./boss-looks";
import { drawBossAtlasFrame } from "./boss-atlas-drawing";
import { bossFrameCrop, drawBossSheetFrame } from "./boss-frame-crop";
import { createGloomrootSpriteCache } from "./gloomroot-sprite-cache";
import { bossVerticalRadius } from "../../../../shared/boss-hitbox";
import {
  BOSS_CONE_HALF_ANGLE, BOSS_CONE_RANGE, FROSTCLAW_RIFT_RANGE, FROSTCLAW_ROAR_RANGE, GLOOMROOT_SWEEP_HALF_ANGLE,
  GLOOMROOT_SWEEP_RANGE, MAGMALISK_BITE_HALF_ANGLE, MAGMALISK_BITE_RANGE, MIREMAW_TONGUE_HALF_ANGLE, MIREMAW_TONGUE_RANGE,
  PRISMSHELL_SHATTER_HALF_ANGLE, IRONHORN_SHATTER_HALF_ANGLE, DREADREAPER_SHATTER_HALF_ANGLE,
  PRISMSHELL_SHATTER_RANGE, IRONHORN_SHATTER_RANGE, DREADREAPER_SHATTER_RANGE, KOI_SHOGUN_SLASH_HALF_ANGLE,
  KOI_SHOGUN_SLASH_RANGE, TIDEWYRM_SURGE_HALF_ANGLE, TIDEWYRM_SURGE_RANGE, TEMPEST_KIRIN_CHARGE_HALF_ANGLE,
  TEMPEST_KIRIN_CHARGE_RANGE, TAU,
} from "../../constants";
import { clamp } from "../../math";
import { formatCompactNumber } from "../../../../shared/compact-number";
import type { Camera } from "../render/camera";
import type { BossCone } from "../types";
import {
  BOSS_NAME_FONT_SIZE,
  BOSS_STATUS_HEALTH_FONT_SIZE,
  bossStatusLabelOffsets,
} from "./boss-label-style";
import { healthBarTextY } from "../render/health-bar-layout";
import {
  BOSS_KINDS, type BossArtAssets, type BossHazards, type BossKind, type BossPageArt, type BossSheetArt, type BossStates,
} from "./boss-registry";
import { drawScreenSpaceAt, fillPixelRect, snapWorldRenderCoordinate } from "../render/render-space";

type PixelCircle = (x: number, y: number, radius: number) => void;
type OutlinedText = (text: string, x: number, y: number, color: string, strokeWidth?: number) => void;
type DrawShadow = (x: number, y: number, width: number, alpha?: number) => void;

/** The colours that set apart the crystal-shatter telegraph three bosses share. */
type ShatterPalette = {
  windupFill: string;
  windupStroke: string;
  activeFill: string;
  activeStroke: string;
  /** "r,g,b" of the burst fill; its alpha grows as the burst lands. */
  burstFill: string;
  burstStroke: string;
  oddShard: string;
  evenShard: string;
};
const PRISMSHELL_PALETTE: ShatterPalette = {
  windupFill: "rgba(171,139,230,.17)", windupStroke: "rgba(208,181,255,.96)",
  activeFill: "rgba(148,232,244,.24)", activeStroke: "rgba(213,252,255,.98)",
  burstFill: "172,142,226", burstStroke: "rgba(222,204,255,.96)",
  oddShard: "rgba(180,243,255,.92)", evenShard: "rgba(220,181,255,.92)",
};
const IRONHORN_PALETTE: ShatterPalette = {
  windupFill: "rgba(223,162,69,.17)", windupStroke: "rgba(255,215,139,.96)",
  activeFill: "rgba(247,202,107,.24)", activeStroke: "rgba(255,234,182,.98)",
  burstFill: "217,149,64", burstStroke: "rgba(255,213,127,.96)",
  oddShard: "rgba(255,193,96,.92)", evenShard: "rgba(201,220,207,.92)",
};
const DREADREAPER_PALETTE: ShatterPalette = {
  windupFill: "rgba(141,206,109,.17)", windupStroke: "rgba(205,255,162,.96)",
  activeFill: "rgba(210,244,137,.24)", activeStroke: "rgba(231,255,203,.98)",
  burstFill: "132,201,104", burstStroke: "rgba(224,255,176,.96)",
  oddShard: "rgba(179,235,116,.92)", evenShard: "rgba(240,175,91,.92)",
};

const BOSS_LABEL_FONT_FAMILY = '"Arial Rounded MT Bold", "Arial Rounded MT", Arial, sans-serif';
const bossLabelFont = (size: number) => `900 ${size}px ${BOSS_LABEL_FONT_FAMILY}`;

export function createBossRenderer(options: {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  devicePixelRatio: () => number;
  bosses: BossStates;
  hazards: BossHazards;
  art: BossArtAssets;
  gameTime: () => number;
  pixelCircle: PixelCircle;
  outlinedText: OutlinedText;
  drawShadow: DrawShadow;
  /** Developer overlay: draw each boss's collision shape over its artwork. */
  showBossHitboxes?: () => boolean;
  hpLossFlashDuration: number;
  spiderWebRange: number;
}) {
  const { ctx, camera, bosses, hazards, art } = options;
  const {
    dragon: boss, spider: spiderBoss, frostclaw: frostclawBoss, magmalisk: magmaliskBoss, gloomroot: gloomrootBoss,
    tidewyrm: tidewyrmBoss, koiShogun: koiShogunBoss, tempestKirin: tempestKirinBoss, miremaw: miremawBoss,
    prismshell: prismshellBoss, ironhorn: ironhornBoss, dreadreaper: dreadreaperBoss, voltwarden: voltwardenBoss,
    gravebloom: gravebloomBoss, aegisPrime: aegisPrimeBoss,
  } = bosses;
  const screenX = (worldX: number) => snapWorldRenderCoordinate(worldX - camera.x, camera.zoom, options.devicePixelRatio());
  const screenY = (worldY: number) => snapWorldRenderCoordinate(worldY - camera.y, camera.zoom, options.devicePixelRatio());
  /**
   * The collision shape the server hits a boss with, drawn over its artwork.
   *
   * A boss is hit as an ellipse around its position: `r` across, and `ry`
   * down when the boss carries one. Nothing lines these two up automatically,
   * so the only way to see whether a hitbox matches what a player can see is
   * to draw it. Developer overlay; off by default.
   */
  function drawBossHitboxes() {
    if (!options.showBossHitboxes?.()) return;
    ctx.save();
    ctx.lineWidth = 3;
    for (const boss of BOSS_KINDS.map((kind) => bosses[kind])) {
      if (!boss || boss.dead || !(boss.r > 0)) continue;
      const x = screenX(boss.x);
      const y = screenY(boss.y);
      const horizontal = boss.r;
      const vertical = bossVerticalRadius(boss.r, (boss as { ry?: number }).ry);
      const centreY = y + ((boss as { hitboxOffsetY?: number }).hitboxOffsetY ?? 0);
      ctx.strokeStyle = "rgba(255, 64, 160, .95)";
      ctx.beginPath();
      ctx.ellipse(x, centreY, horizontal, vertical, 0, 0, TAU);
      ctx.stroke();
      // A cross at the anchor: the position the server measures from, which is
      // not always where the artwork's middle looks like it is.
      ctx.strokeStyle = "rgba(255, 255, 255, .9)";
      ctx.beginPath();
      ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y);
      ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBossStatus(options_: {
    x: number;
    spriteTopY: number;
    barGap: number;
    barWidth: number;
    barHeight: number;
    hp: number;
    maxHp: number;
    hpLossFlashTimer: number;
    hpLossFlashFrom: number;
    fillColor: string;
    name: { text: string; color: string };
    rewardBottomOffsetY?: number;
  }) {
    drawScreenSpaceAt(ctx, camera.zoom, options_.x, options_.spriteTopY, () => {
      const barX = -Math.floor(options_.barWidth / 2);
      const barY = -options_.barGap;
      const ratio = clamp(options_.hp / options_.maxHp, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,.9)";
      fillPixelRect(ctx, barX - 2, barY - 2, options_.barWidth + 4, options_.barHeight + 4);
      ctx.fillStyle = "#000";
      fillPixelRect(ctx, barX, barY, options_.barWidth, options_.barHeight);
      ctx.fillStyle = options_.fillColor;
      fillPixelRect(ctx, barX, barY, Math.round(options_.barWidth * ratio), options_.barHeight);
      if (options_.hpLossFlashTimer > 0 && options_.hpLossFlashFrom > options_.hp) {
        const fromRatio = clamp(options_.hpLossFlashFrom / options_.maxHp, ratio, 1);
        ctx.save();
        ctx.globalAlpha = clamp(options_.hpLossFlashTimer / options.hpLossFlashDuration, 0, 1);
        ctx.fillStyle = "#fff";
        fillPixelRect(ctx,
          barX + Math.round(options_.barWidth * ratio),
          barY,
          Math.max(1, Math.round(options_.barWidth * (fromRatio - ratio))),
          options_.barHeight,
        );
        ctx.restore();
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = bossLabelFont(BOSS_STATUS_HEALTH_FONT_SIZE);
      options.outlinedText(
        `${formatCompactNumber(Math.max(0, Math.ceil(options_.hp)))} / ${formatCompactNumber(Math.ceil(options_.maxHp))}`,
        0,
        healthBarTextY(barY, options_.barHeight),
        "#fff",
        4,
      );
      ctx.textBaseline = "bottom";
      const labelOffsets = bossStatusLabelOffsets(0, options_.rewardBottomOffsetY);
      ctx.font = bossLabelFont(BOSS_NAME_FONT_SIZE);
      options.outlinedText(options_.name.text, 0, barY + labelOffsets.name, options_.name.color, 4);
    });
  }
  function drawBossTelegraphs() {
    if (boss.dead) return;
    if (boss.cone) {
      const x = screenX(boss.x); const y = screenY(boss.y); const cone = boss.cone;
      ctx.save(); ctx.fillStyle = "rgba(255,52,42,.20)"; ctx.strokeStyle = "rgba(255,92,64,.92)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, BOSS_CONE_RANGE, cone.angle - BOSS_CONE_HALF_ANGLE, cone.angle + BOSS_CONE_HALF_ANGLE); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (cone.windup <= 0) { const waveRadius = boss.r + (BOSS_CONE_RANGE - boss.r) * clamp(1 - cone.timer / cone.duration, 0, 1); for (let index = 0; index < 9; index += 1) { const angle = cone.angle - BOSS_CONE_HALF_ANGLE + index / 8 * BOSS_CONE_HALF_ANGLE * 2; const fireX = x + Math.cos(angle) * waveRadius; const fireY = y + Math.sin(angle) * waveRadius; ctx.fillStyle = "#a83218"; options.pixelCircle(fireX, fireY, 15); ctx.fillStyle = "#ff6a28"; options.pixelCircle(fireX, fireY - 2, 11); ctx.fillStyle = "#ffd05c"; options.pixelCircle(fireX, fireY - 4, 6); } }
      ctx.restore();
    }
    for (const strike of hazards.dragon) { const x = screenX(strike.x); const y = screenY(strike.y); const progress = 1 - clamp(strike.timer / strike.maxTimer, 0, 1); const fallY = y - 150 * (1 - progress); ctx.save(); ctx.strokeStyle = "rgba(255,70,54,.92)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, strike.r, 0, TAU); ctx.stroke(); ctx.fillStyle = "#ff5b36"; options.pixelCircle(x, fallY, 9); ctx.fillStyle = "#ffd05c"; options.pixelCircle(x, fallY, 5); ctx.restore(); }
  }
  function drawSpiderTelegraphs() {
    if (spiderBoss.dead) return; const x = screenX(spiderBoss.x); const y = screenY(spiderBoss.y);
    if (spiderBoss.web) { const radius = spiderBoss.r + (options.spiderWebRange - spiderBoss.r) * clamp(1 - spiderBoss.web.timer / spiderBoss.web.duration, 0, 1); ctx.save(); ctx.strokeStyle = "rgba(235,239,218,.9)"; ctx.lineWidth = 7; ctx.setLineDash([13, 10]); ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.stroke(); ctx.restore(); }
    for (const pool of hazards.spider) { const progress = 1 - clamp(pool.timer / pool.maxTimer, 0, 1); ctx.save(); ctx.fillStyle = `rgba(113,214,71,${.12 + progress * .18})`; ctx.strokeStyle = "rgba(155,238,88,.95)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(screenX(pool.x), screenY(pool.y), pool.r, 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore(); }
  }

  function drawFrostclawTelegraphs() {
    if (frostclawBoss.dead) return;
    const x = screenX(frostclawBoss.x);
    const y = screenY(frostclawBoss.y);
    const time = options.gameTime();
    if (frostclawBoss.roar) {
      const roar = frostclawBoss.roar;
      ctx.save();
      if (roar.windup > 0) {
        const charge = clamp(1 - roar.windup / .85, 0, 1);
        ctx.fillStyle = `rgba(91,220,255,${.08 + charge * .12})`;
        ctx.beginPath(); ctx.arc(x, y, frostclawBoss.r + 95 * charge, 0, TAU); ctx.fill();
        for (let ring = 0; ring < 3; ring += 1) {
          ctx.strokeStyle = `rgba(190,249,255,${.28 + charge * .2})`;
          ctx.lineWidth = 3;
          ctx.setLineDash([8 + ring * 3, 7]);
          ctx.lineDashOffset = -time * (35 + ring * 12);
          ctx.beginPath(); ctx.arc(x, y, frostclawBoss.r + 24 + ring * 26 + charge * 26, 0, TAU); ctx.stroke();
        }
      } else {
        const progress = clamp(1 - roar.timer / roar.duration, 0, 1);
        const radius = frostclawBoss.r + (FROSTCLAW_ROAR_RANGE - frostclawBoss.r) * progress;
        ctx.strokeStyle = "rgba(217,252,255,.95)"; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.stroke();
        ctx.strokeStyle = "rgba(66,196,255,.72)"; ctx.lineWidth = 22; ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.stroke();
        for (let shard = 0; shard < 24; shard += 1) {
          const angle = shard * TAU / 24 + time * .3;
          const shardX = x + Math.cos(angle) * radius;
          const shardY = y + Math.sin(angle) * radius;
          ctx.save(); ctx.translate(shardX, shardY); ctx.rotate(angle + Math.PI / 2);
          ctx.fillStyle = shard % 2 ? "#d9fbff" : "#68d9ff";
          ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(6, 7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.restore();
        }
      }
      ctx.restore();
    }
    if (frostclawBoss.rift) {
      const rift = frostclawBoss.rift;
      const active = rift.windup <= 0;
      const progress = active ? clamp(1 - rift.timer / rift.duration, 0, 1) : 0;
      ctx.save();
      for (const offset of [-.28, 0, .28]) {
        const angle = rift.angle + offset;
        ctx.strokeStyle = active ? "rgba(109,224,255,.92)" : "rgba(202,248,255,.66)";
        ctx.lineWidth = active ? 13 : 4;
        ctx.setLineDash(active ? [] : [18, 12]);
        ctx.lineDashOffset = -time * 38;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * frostclawBoss.r, y + Math.sin(angle) * frostclawBoss.r);
        ctx.lineTo(x + Math.cos(angle) * FROSTCLAW_RIFT_RANGE, y + Math.sin(angle) * FROSTCLAW_RIFT_RANGE); ctx.stroke();
        if (!active) continue;
        const waveRadius = frostclawBoss.r + (FROSTCLAW_RIFT_RANGE - frostclawBoss.r) * progress;
        for (let shard = 0; shard < 5; shard += 1) {
          const radius = waveRadius - shard * 24;
          if (radius < frostclawBoss.r) continue;
          const shardX = x + Math.cos(angle) * radius;
          const shardY = y + Math.sin(angle) * radius;
          ctx.save(); ctx.translate(shardX, shardY); ctx.rotate(angle + Math.PI / 2);
          ctx.fillStyle = shard % 2 ? "#e2fdff" : "#38bff2";
          ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(11, 11); ctx.lineTo(-11, 11); ctx.closePath(); ctx.fill(); ctx.restore();
        }
      }
      ctx.restore();
    }
    for (const strike of hazards.frostclaw) {
      const progress = 1 - clamp(strike.timer / strike.maxTimer, 0, 1);
      const strikeX = screenX(strike.x);
      const strikeY = screenY(strike.y);
      const fallY = strikeY - 220 * (1 - progress);
      ctx.save();
      ctx.fillStyle = `rgba(75,193,244,${.08 + progress * .18})`;
      ctx.strokeStyle = "rgba(205,249,255,.92)";
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 7]);
      ctx.lineDashOffset = -time * 32;
      ctx.beginPath(); ctx.arc(strikeX, strikeY, strike.r * (.7 + progress * .3), 0, TAU); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      const gradient = ctx.createLinearGradient(strikeX, fallY - 30, strikeX, fallY + 34);
      gradient.addColorStop(0, "rgba(231,253,255,.96)");
      gradient.addColorStop(1, "rgba(49,176,236,.94)");
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.moveTo(strikeX, fallY + 35); ctx.lineTo(strikeX - 13, fallY - 12); ctx.lineTo(strikeX, fallY - 32); ctx.lineTo(strikeX + 13, fallY - 12); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }


  function drawMagmaliskTelegraphs() {
    if (magmaliskBoss.dead) return;
    const x = screenX(magmaliskBoss.x);
    const y = screenY(magmaliskBoss.y);
    const time = options.gameTime();
    if (magmaliskBoss.bite) {
      const bite = magmaliskBoss.bite;
      ctx.save();
      ctx.fillStyle = bite.windup > 0 ? "rgba(255,116,35,.15)" : "rgba(255,72,24,.22)";
      ctx.strokeStyle = "rgba(255,151,52,.94)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, MAGMALISK_BITE_RANGE, bite.angle - MAGMALISK_BITE_HALF_ANGLE, bite.angle + MAGMALISK_BITE_HALF_ANGLE);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (bite.windup <= 0) {
        const radius = magmaliskBoss.r + (MAGMALISK_BITE_RANGE - magmaliskBoss.r) * clamp(1 - bite.timer / bite.duration, 0, 1);
        for (let flame = 0; flame < 11; flame += 1) {
          const angle = bite.angle - MAGMALISK_BITE_HALF_ANGLE + flame / 10 * MAGMALISK_BITE_HALF_ANGLE * 2;
          ctx.fillStyle = flame % 2 ? "#ffad2f" : "#ff5b22";
          options.pixelCircle(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, flame % 2 ? 12 : 16);
        }
      }
      ctx.restore();
    }
    for (const eruption of hazards.magmalisk) {
      const progress = 1 - clamp(eruption.timer / eruption.maxTimer, 0, 1);
      const strikeX = screenX(eruption.x);
      const strikeY = screenY(eruption.y);
      const fallY = strikeY - 230 * (1 - progress);
      ctx.save();
      ctx.fillStyle = `rgba(255,84,28,${.1 + progress * .2})`;
      ctx.strokeStyle = "rgba(255,176,58,.96)";
      ctx.lineWidth = 5;
      ctx.setLineDash([12, 8]);
      ctx.lineDashOffset = -time * 38;
      ctx.beginPath(); ctx.arc(strikeX, strikeY, eruption.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#3b2925"; options.pixelCircle(strikeX, fallY, 14);
      ctx.fillStyle = "#ff6b21"; options.pixelCircle(strikeX, fallY + 3, 9);
      ctx.fillStyle = "#ffd34b"; options.pixelCircle(strikeX, fallY + 5, 4);
      ctx.restore();
    }
  }


  function drawGloomrootTelegraphs() {
    if (gloomrootBoss.dead) return;
    const x = screenX(gloomrootBoss.x);
    const y = screenY(gloomrootBoss.y);
    const time = options.gameTime();
    if (gloomrootBoss.sweep) {
      const sweep = gloomrootBoss.sweep;
      ctx.save();
      ctx.fillStyle = sweep.windup > 0 ? "rgba(63,214,221,.13)" : "rgba(73,239,238,.22)";
      ctx.strokeStyle = "rgba(128,247,244,.95)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, GLOOMROOT_SWEEP_RANGE, sweep.angle - GLOOMROOT_SWEEP_HALF_ANGLE, sweep.angle + GLOOMROOT_SWEEP_HALF_ANGLE);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (sweep.windup <= 0) {
        const radius = gloomrootBoss.r + (GLOOMROOT_SWEEP_RANGE - gloomrootBoss.r) * clamp(1 - sweep.timer / sweep.duration, 0, 1);
        for (let root = 0; root < 13; root += 1) {
          const angle = sweep.angle - GLOOMROOT_SWEEP_HALF_ANGLE + root / 12 * GLOOMROOT_SWEEP_HALF_ANGLE * 2;
          ctx.fillStyle = root % 2 ? "#56e7e9" : "#173d55";
          options.pixelCircle(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, root % 2 ? 10 : 15);
        }
      }
      ctx.restore();
    }
    for (const bloom of hazards.gloomroot) {
      const progress = 1 - clamp(bloom.timer / bloom.maxTimer, 0, 1);
      const bloomX = screenX(bloom.x);
      const bloomY = screenY(bloom.y);
      ctx.save();
      ctx.fillStyle = `rgba(36,196,210,${.08 + progress * .2})`;
      ctx.strokeStyle = "rgba(116,244,239,.96)";
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 7]);
      ctx.lineDashOffset = -time * 35;
      ctx.beginPath(); ctx.arc(bloomX, bloomY, bloom.r * (.72 + progress * .28), 0, TAU); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      for (let thorn = 0; thorn < 7; thorn += 1) {
        const angle = thorn * TAU / 7 + time * .45;
        const radius = bloom.r * (.35 + progress * .45);
        ctx.fillStyle = thorn % 2 ? "#7af5ee" : "#294d72";
        options.pixelCircle(bloomX + Math.cos(angle) * radius, bloomY + Math.sin(angle) * radius, 6 + progress * 4);
      }
      ctx.restore();
    }
  }


  function drawTidewyrmTelegraphs() {
    if (tidewyrmBoss.dead) return;
    const x = screenX(tidewyrmBoss.x);
    const y = screenY(tidewyrmBoss.y);
    const time = options.gameTime();
    if (tidewyrmBoss.surge) {
      const surge = tidewyrmBoss.surge;
      ctx.save();
      ctx.fillStyle = surge.windup > 0 ? "rgba(62,211,232,.14)" : "rgba(83,230,250,.24)";
      ctx.strokeStyle = "rgba(185,249,255,.96)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, TIDEWYRM_SURGE_RANGE, surge.angle - TIDEWYRM_SURGE_HALF_ANGLE, surge.angle + TIDEWYRM_SURGE_HALF_ANGLE);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (surge.windup <= 0) {
        const radius = tidewyrmBoss.r + (TIDEWYRM_SURGE_RANGE - tidewyrmBoss.r) * clamp(1 - surge.timer / surge.duration, 0, 1);
        for (let crest = 0; crest < 15; crest += 1) {
          const angle = surge.angle - TIDEWYRM_SURGE_HALF_ANGLE + crest / 14 * TIDEWYRM_SURGE_HALF_ANGLE * 2;
          const crestX = x + Math.cos(angle) * radius;
          const crestY = y + Math.sin(angle) * radius;
          ctx.fillStyle = crest % 2 ? "#baf8ff" : "#36c8e4";
          options.pixelCircle(crestX, crestY, crest % 2 ? 10 : 15);
          ctx.fillStyle = "#effeff";
          options.pixelCircle(crestX, crestY - 5, 5);
        }
      }
      ctx.restore();
    }
    for (const pool of hazards.tidewyrm) {
      const progress = 1 - clamp(pool.timer / pool.maxTimer, 0, 1);
      const poolX = screenX(pool.x);
      const poolY = screenY(pool.y);
      ctx.save();
      ctx.fillStyle = `rgba(28,151,198,${.1 + progress * .2})`;
      ctx.strokeStyle = "rgba(171,247,255,.96)";
      ctx.lineWidth = 5;
      ctx.setLineDash([13, 8]);
      ctx.lineDashOffset = time * 54;
      ctx.beginPath();
      ctx.ellipse(poolX, poolY, pool.r, pool.r * .62, time * .7, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(49,210,238,.9)";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.ellipse(poolX, poolY, pool.r * (.24 + progress * .36), pool.r * (.15 + progress * .22), -time, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }


  function drawKoiShogunTelegraphs() {
    if (koiShogunBoss.dead) return;
    const x = screenX(koiShogunBoss.x);
    const y = screenY(koiShogunBoss.y);
    const time = options.gameTime();
    if (koiShogunBoss.slash) {
      const slash = koiShogunBoss.slash;
      ctx.save();
      ctx.fillStyle = slash.windup > 0 ? "rgba(242,183,68,.13)" : "rgba(72,205,235,.23)";
      ctx.strokeStyle = slash.windup > 0 ? "rgba(255,221,137,.94)" : "rgba(193,250,255,.98)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, KOI_SHOGUN_SLASH_RANGE, slash.angle - KOI_SHOGUN_SLASH_HALF_ANGLE, slash.angle + KOI_SHOGUN_SLASH_HALF_ANGLE);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (slash.windup <= 0) {
        const radius = koiShogunBoss.r + (KOI_SHOGUN_SLASH_RANGE - koiShogunBoss.r) * clamp(1 - slash.timer / slash.duration, 0, 1);
        for (let crest = 0; crest < 15; crest += 1) {
          const angle = slash.angle - KOI_SHOGUN_SLASH_HALF_ANGLE + crest / 14 * KOI_SHOGUN_SLASH_HALF_ANGLE * 2;
          const crestX = x + Math.cos(angle) * radius;
          const crestY = y + Math.sin(angle) * radius;
          ctx.fillStyle = crest % 2 ? "#d6fbff" : "#42cbe7";
          options.pixelCircle(crestX, crestY, crest % 2 ? 10 : 15);
          ctx.fillStyle = "#ffffff";
          options.pixelCircle(crestX, crestY - 5, 5);
        }
      }
      ctx.restore();
    }
    for (const pool of hazards.koiShogun) {
      const progress = 1 - clamp(pool.timer / pool.maxTimer, 0, 1);
      const poolX = screenX(pool.x);
      const poolY = screenY(pool.y);
      ctx.save();
      ctx.fillStyle = `rgba(28,151,198,${.1 + progress * .2})`;
      ctx.strokeStyle = "rgba(255,224,146,.96)";
      ctx.lineWidth = 5;
      ctx.setLineDash([13, 8]);
      ctx.lineDashOffset = time * 54;
      ctx.beginPath();
      ctx.ellipse(poolX, poolY, pool.r, pool.r * .62, time * .7, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(49,210,238,.9)";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.ellipse(poolX, poolY, pool.r * (.24 + progress * .36), pool.r * (.15 + progress * .22), -time, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }


  function drawTempestKirinTelegraphs() {
    if (tempestKirinBoss.dead) return;
    const x = screenX(tempestKirinBoss.x);
    const y = screenY(tempestKirinBoss.y);
    const time = options.gameTime();
    if (tempestKirinBoss.charge) {
      const charge = tempestKirinBoss.charge;
      ctx.save();
      ctx.fillStyle = charge.windup > 0 ? "rgba(104,194,255,.13)" : "rgba(228,249,255,.25)";
      ctx.strokeStyle = charge.windup > 0 ? "rgba(151,220,255,.96)" : "rgba(255,232,139,.98)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, TEMPEST_KIRIN_CHARGE_RANGE, charge.angle - TEMPEST_KIRIN_CHARGE_HALF_ANGLE, charge.angle + TEMPEST_KIRIN_CHARGE_HALF_ANGLE);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (charge.windup <= 0) {
        const radius = tempestKirinBoss.r + (TEMPEST_KIRIN_CHARGE_RANGE - tempestKirinBoss.r) * clamp(1 - charge.timer / charge.duration, 0, 1);
        ctx.strokeStyle = "rgba(242,253,255,.98)";
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.arc(x, y, radius, charge.angle - TEMPEST_KIRIN_CHARGE_HALF_ANGLE, charge.angle + TEMPEST_KIRIN_CHARGE_HALF_ANGLE);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const bolt of hazards.tempestKirin) {
      const progress = 1 - clamp(bolt.timer / bolt.maxTimer, 0, 1);
      const boltX = screenX(bolt.x);
      const boltY = screenY(bolt.y);
      ctx.save();
      ctx.fillStyle = `rgba(92,190,255,${.1 + progress * .2})`;
      ctx.strokeStyle = "rgba(255,231,133,.98)";
      ctx.lineWidth = 5;
      ctx.setLineDash([11, 7]);
      ctx.lineDashOffset = -time * 70;
      ctx.beginPath();
      ctx.arc(boltX, boltY, bolt.r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(219,249,255,.94)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(boltX, boltY, bolt.r * (.2 + progress * .55), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }


  function drawMiremawTelegraphs() {
    if (miremawBoss.dead) return;
    const x = screenX(miremawBoss.x);
    const y = screenY(miremawBoss.y);
    const time = options.gameTime();
    if (miremawBoss.tongue) {
      const tongue = miremawBoss.tongue;
      ctx.save();
      ctx.fillStyle = tongue.windup > 0 ? "rgba(119,255,199,.13)" : "rgba(212,255,235,.24)";
      ctx.strokeStyle = tongue.windup > 0 ? "rgba(133,255,209,.95)" : "rgba(255,151,207,.98)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, MIREMAW_TONGUE_RANGE, tongue.angle - MIREMAW_TONGUE_HALF_ANGLE, tongue.angle + MIREMAW_TONGUE_HALF_ANGLE);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (tongue.windup <= 0) {
        const radius = miremawBoss.r + (MIREMAW_TONGUE_RANGE - miremawBoss.r) * clamp(1 - tongue.timer / tongue.duration, 0, 1);
        ctx.strokeStyle = "rgba(255,174,218,.98)";
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(x, y, radius, tongue.angle - MIREMAW_TONGUE_HALF_ANGLE, tongue.angle + MIREMAW_TONGUE_HALF_ANGLE);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const burst of hazards.miremaw) {
      const progress = 1 - clamp(burst.timer / burst.maxTimer, 0, 1);
      const burstX = screenX(burst.x);
      const burstY = screenY(burst.y);
      ctx.save();
      ctx.fillStyle = `rgba(100,238,187,${.1 + progress * .22})`;
      ctx.strokeStyle = "rgba(185,255,226,.96)";
      ctx.lineWidth = 5;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -time * 44;
      ctx.beginPath();
      ctx.arc(burstX, burstY, burst.r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      for (let bubble = 0; bubble < 5; bubble += 1) {
        const angle = bubble * TAU / 5 + time * .8;
        const radius = burst.r * (.16 + progress * .58);
        ctx.strokeStyle = bubble % 2 ? "rgba(213,255,238,.9)" : "rgba(190,135,255,.86)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(burstX + Math.cos(angle) * radius, burstY + Math.sin(angle) * radius, 5 + bubble % 3 * 2, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  /**
   * Prismshell, Ironhorn and Dreadreaper share one telegraph: a jagged cone
   * front and six-shard bursts, differing only in palette.
   */
  function drawShatterTelegraphs(
    state: typeof prismshellBoss | typeof ironhornBoss | typeof dreadreaperBoss,
    bursts: readonly { x: number; y: number; r: number; timer: number; maxTimer: number }[],
    range: number,
    halfAngle: number,
    palette: ShatterPalette,
  ) {
    if (state.dead) return;
    const x = screenX(state.x);
    const y = screenY(state.y);
    const time = options.gameTime();
    if (state.shatter) {
      const shatter = state.shatter;
      ctx.save();
      ctx.fillStyle = shatter.windup > 0 ? palette.windupFill : palette.activeFill;
      ctx.strokeStyle = shatter.windup > 0 ? palette.windupStroke : palette.activeStroke;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, range, shatter.angle - halfAngle, shatter.angle + halfAngle);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (shatter.windup <= 0) {
        const radius = state.r + (range - state.r) * clamp(1 - shatter.timer / shatter.duration, 0, 1);
        ctx.strokeStyle = palette.activeStroke;
        ctx.lineWidth = 9;
        ctx.beginPath();
        for (let point = 0; point <= 12; point += 1) {
          const angle = shatter.angle - halfAngle + point / 12 * halfAngle * 2;
          const reach = Math.max(state.r, radius - (point % 2 ? 24 : 0));
          const pointX = x + Math.cos(angle) * reach;
          const pointY = y + Math.sin(angle) * reach;
          if (point === 0) ctx.moveTo(pointX, pointY);
          else ctx.lineTo(pointX, pointY);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const burst of bursts) {
      const progress = 1 - clamp(burst.timer / burst.maxTimer, 0, 1);
      const burstX = screenX(burst.x);
      const burstY = screenY(burst.y);
      ctx.save();
      ctx.fillStyle = `rgba(${palette.burstFill},${.1 + progress * .22})`;
      ctx.strokeStyle = palette.burstStroke;
      ctx.lineWidth = 5;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -time * 44;
      ctx.beginPath();
      ctx.arc(burstX, burstY, burst.r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      for (let shard = 0; shard < 6; shard += 1) {
        const angle = shard * TAU / 6 - Math.PI / 2;
        const radius = burst.r * (.24 + progress * .32);
        const shardX = burstX + Math.cos(angle) * radius;
        const shardY = burstY + Math.sin(angle) * radius;
        const length = 7 + progress * 12;
        ctx.fillStyle = shard % 2 ? palette.oddShard : palette.evenShard;
        ctx.beginPath();
        ctx.moveTo(shardX + Math.cos(angle) * length, shardY + Math.sin(angle) * length);
        ctx.lineTo(shardX - Math.sin(angle) * 5, shardY + Math.cos(angle) * 5);
        ctx.lineTo(shardX - Math.cos(angle) * length, shardY - Math.sin(angle) * length);
        ctx.lineTo(shardX + Math.sin(angle) * 5, shardY - Math.cos(angle) * 5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }
  const drawPrismshellTelegraphs = () => drawShatterTelegraphs(prismshellBoss, hazards.prismshell, PRISMSHELL_SHATTER_RANGE, PRISMSHELL_SHATTER_HALF_ANGLE, PRISMSHELL_PALETTE);
  const drawIronhornTelegraphs = () => drawShatterTelegraphs(ironhornBoss, hazards.ironhorn, IRONHORN_SHATTER_RANGE, IRONHORN_SHATTER_HALF_ANGLE, IRONHORN_PALETTE);
  const drawDreadreaperTelegraphs = () => drawShatterTelegraphs(dreadreaperBoss, hazards.dreadreaper, DREADREAPER_SHATTER_RANGE, DREADREAPER_SHATTER_HALF_ANGLE, DREADREAPER_PALETTE);
  function drawVoltwardenTelegraphs() {
    if (!voltwardenBoss.dead) drawNeonAttacks(ctx, voltwardenBoss, hazards.voltwarden, camera);
  }
  function drawGravebloomTelegraphs() {
    if (!gravebloomBoss.dead) drawVerdantAttacks(ctx, gravebloomBoss, hazards.gravebloom, camera);
  }
  function drawAegisPrimeTelegraphs() {
    if (!aegisPrimeBoss.dead) drawIonAttacks(ctx, aegisPrimeBoss, hazards.aegisPrime, camera);
  }

  type CommonBoss = { dead: boolean; x: number; y: number; hp: number; maxHp: number; hpLossFlashTimer: number; hpLossFlashFrom: number; shatter?: BossCone | null; hurt: number };
  const paint: BossPaint = { ctx, time: 0, art, drawShadow: options.drawShadow, gloomrootSprites: createGloomrootSpriteCache() };

  /** The art's status-line top for one boss after painting it, or null when it is not drawn yet. */
  function paintBossBody(kind: BossKind, look: BossLook<CommonBoss, { length: number }>, state: CommonBoss, x: number, y: number) {
    const hazardList = hazards[kind];
    const time = options.gameTime();
    if (look.body === "custom") {
      paint.time = time;
      return look.paint(paint, state, hazardList, x, y);
    }
    const visualY = y + look.yOffset;
    if (look.body === "posed") {
      const pulsing = hazardList.length > 0;
      const pages = (art[kind] as BossPageArt);
      look.drawArt(ctx, x, visualY, time, state.shatter ? "laser" : pulsing ? "emp" : "idle", state.hurt, pages.ready() ? pages.pages[0] : undefined);
      const statusFrame = look.posedStatus ? (state.shatter ? 1 : pulsing ? 2 : 0) : 0;
      return visualY + look.artTop + (bossFrameCrop(look.cropId, statusFrame).statusOffsetY ?? 0);
    }
    if (look.body === "atlas") {
      const frame = look.spriteFrame(time, look.attackElapsed(state, hazardList));
      const pages = art[kind] as BossPageArt;
      const page = pages.pages[frame.page];
      const facing = look.facing(state);
      ctx.save();
      ctx.translate(x, visualY);
      look.groundShadow?.(ctx);
      if (facing && Math.cos(facing.angle) > 0) ctx.scale(-1, 1);
      if (pages.ready() && page?.naturalWidth > 0) drawBossAtlasFrame(ctx, decodedImage(page), frame, look.atlasId);
      else look.fallback(ctx);
      ctx.restore();
      return visualY + (look.artTop ?? frame.top) + (bossFrameCrop(look.atlasId, frame.tuningFrame).statusOffsetY ?? 0);
    }
    const sheet = art[kind] as BossSheetArt;
    const canvas = sheet.canvas;
    const ready = sheet.ready() && (!look.fallback || (canvas.width >= 4 && canvas.height >= 2));
    if (!ready && !look.fallback) return null;
    const size = BOSS_ART[look.sheetId];
    const frame = look.frame(state, hazardList, time);
    const pulseOn = look.pulse && (look.pulse.when ? look.pulse.when(state) : hazardList.length > 0);
    const pulse = look.pulse && pulseOn ? 1 + Math.sin(time * look.pulse.speed) * look.pulse.amplitude : 1;
    options.drawShadow(x, visualY + look.groundOffset, size.shadowWidth, look.shadowAlpha);
    ctx.save();
    ctx.translate(x, visualY + (look.nudgeY ?? 0));
    if (look.pulse || look.mirror) ctx.scale(look.mirror?.(frame) ? -pulse : pulse, pulse);
    if (ready) {
      drawBossSheetFrame(ctx, canvas, { bossId: look.sheetId, frame, cellWidth: canvas.width / 4, cellHeight: canvas.height, drawWidth: size.drawWidth, drawHeight: size.drawHeight });
    } else look.fallback?.(ctx);
    ctx.restore();
    return visualY + look.artTop + (bossFrameCrop(look.sheetId, frame).statusOffsetY ?? 0);
  }

  /** One boss through its BOSS_LOOKS entry: body, then health bar and name. */
  function drawBossKind(kind: BossKind) {
    const state = bosses[kind] as CommonBoss;
    if (state.dead) return;
    const look = BOSS_LOOKS[kind] as unknown as BossLook<CommonBoss, { length: number }>;
    const x = screenX(state.x);
    const y = screenY(state.y);
    const spriteTopY = paintBossBody(kind, look, state, x, y);
    if (spriteTopY === null) return;
    const { name, nameColor, ...bar } = look.status;
    drawBossStatus({
      x, spriteTopY, ...bar,
      hp: state.hp, maxHp: state.maxHp, hpLossFlashTimer: state.hpLossFlashTimer, hpLossFlashFrom: state.hpLossFlashFrom,
      name: { text: name, color: nameColor },
    });
  }

  return {
    drawBoss: Object.fromEntries(BOSS_KINDS.map((kind) => [kind, () => drawBossKind(kind)])) as Record<BossKind, () => void>,
    drawBossTelegraphs: {
      dragon: drawBossTelegraphs, spider: drawSpiderTelegraphs, frostclaw: drawFrostclawTelegraphs, magmalisk: drawMagmaliskTelegraphs,
      gloomroot: drawGloomrootTelegraphs, tidewyrm: drawTidewyrmTelegraphs, koiShogun: drawKoiShogunTelegraphs, tempestKirin: drawTempestKirinTelegraphs,
      miremaw: drawMiremawTelegraphs, prismshell: drawPrismshellTelegraphs, ironhorn: drawIronhornTelegraphs, dreadreaper: drawDreadreaperTelegraphs,
      voltwarden: drawVoltwardenTelegraphs, gravebloom: drawGravebloomTelegraphs, aegisPrime: drawAegisPrimeTelegraphs,
    } satisfies Record<BossKind, () => void>,
    drawBossHitboxes,
  };
}
