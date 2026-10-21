// The bosses scene: every world boss through the game's boss renderer, on plain ground, frame by frame.
import { createCanvasPrimitives } from "../../src/game/canvas";
import { createGameBootstrap } from "../../src/game/runtime/game-bootstrap";
import { createBossRenderer } from "../../src/game/runtime/boss/boss-renderer";
import { BOSS_HP_LOSS_FLASH_DURATION, SPIDER_WEB_RANGE } from "../../src/game/runtime/boss/boss-controller";
import { BOSS_KINDS, BOSSES, type BossKind } from "../../src/game/runtime/boss/boss-registry";
import type { Camera } from "../../src/game/runtime/render/camera";
import type { MapId } from "../../src/game/world";
import { mapArtReady, sharedAssets } from "./game-world";
import { drawUntilStable } from "./determinism";
import { label, resetCanvas, sceneCanvas, section } from "./world";

const ZOOM = .42;
const CELL = { width: 190, height: 330 };
const LABEL_WIDTH = 92;

type Pose = { name: string; gameTime: number; attacking?: boolean; hurt?: boolean; hitbox?: boolean };
/** The idle cycle at three moments, mid-attack, hit (with the bar's loss flash), and the hitbox over the art. */
const POSES: Pose[] = [
  { name: "0 s", gameTime: 0 }, { name: "0.25 s", gameTime: .25 }, { name: "0.5 s", gameTime: .5 },
  { name: "attacking", gameTime: .3, attacking: true }, { name: "hit", gameTime: 0, hurt: true }, { name: "hitbox", gameTime: 0, hitbox: true },
];

/** Every boss at each pose: anchored at the cell's foot, its name and bar over it. */
export async function bosses() {
  for (const kind of BOSS_KINDS) await mapArtReady(BOSSES[kind].mapId as MapId);
  const art = sharedAssets().assets.bossArt;
  const width = LABEL_WIDTH + POSES.length * CELL.width, height = 22 + BOSS_KINDS.length * CELL.height;
  const scene = sceneCanvas(section("Bosses · idle at three moments, attacking, hit, and the hitbox over the art (zoom 0.42)"), width, height);
  const { ctx } = scene;
  const primitives = createCanvasPrimitives(ctx);
  const camera: Camera = { x: 0, y: 0, zoom: ZOOM };
  let gameTime = 0;
  let hitboxes = false;
  const { bosses: states, bossHazards } = createGameBootstrap();
  const renderer = createBossRenderer({
    ctx, camera, devicePixelRatio: () => scene.dpr, bosses: states, hazards: bossHazards, art, gameTime: () => gameTime,
    pixelCircle: primitives.pixelCircle, outlinedText: primitives.outlinedWorldText, drawShadow: () => {},
    showBossHitboxes: () => hitboxes, hpLossFlashDuration: BOSS_HP_LOSS_FLASH_DURATION, spiderWebRange: SPIDER_WEB_RANGE,
  });
  const fresh = createGameBootstrap().bosses;
  const draw = () => {
    resetCanvas(scene);
    POSES.forEach((pose, column) => label(ctx, pose.name, LABEL_WIDTH + (column + .5) * CELL.width, 4));
    BOSS_KINDS.forEach((kind: BossKind, row) => {
      label(ctx, BOSSES[kind].name ?? kind, 6, 22 + row * CELL.height + CELL.height / 2, "left");
      POSES.forEach((pose, column) => {
        const state = states[kind] as Record<string, unknown> & { x: number; y: number; maxHp: number };
        Object.assign(state, fresh[kind], { spriteAttackElapsed: undefined, shatter: undefined });
        // Only this boss is alive, so the hitbox overlay draws only its shape (several share an arena centre).
        for (const other of BOSS_KINDS) if (other !== kind) states[other].dead = true;
        state.hp = state.maxHp * .6;
        if (pose.attacking) Object.assign(state, { spriteAttackElapsed: .4, shatter: { angle: Math.PI } });
        if (pose.hurt) Object.assign(state, { hurt: .2, hpLossFlashTimer: BOSS_HP_LOSS_FLASH_DURATION / 2, hpLossFlashFrom: state.maxHp });
        gameTime = pose.gameTime;
        hitboxes = Boolean(pose.hitbox);
        // The boss's position lands at the cell's centre, a little below the middle.
        const cellX = LABEL_WIDTH + (column + .5) * CELL.width, cellY = 22 + row * CELL.height + CELL.height * .66;
        camera.x = state.x - cellX / ZOOM;
        camera.y = state.y - cellY / ZOOM;
        ctx.save();
        ctx.beginPath();
        ctx.rect(LABEL_WIDTH + column * CELL.width, 22 + row * CELL.height, CELL.width, CELL.height);
        ctx.clip();
        ctx.scale(ZOOM, ZOOM);
        renderer.drawBoss[kind]();
        renderer.drawBossHitboxes();
        ctx.restore();
      });
    });
  };
  await drawUntilStable(draw);
}
