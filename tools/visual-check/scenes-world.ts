// Canvas scenes: overhead plates, gear on characters, enemies' frames and the parts-built enemies.
import { BASE_ATTACK_RANGE } from "../../src/game/constants";
import { targetCameraZoom } from "../../src/game/runtime/render/camera";
import { enemySpriteVerticalBounds } from "../../src/game/runtime/render/actor-renderer";
import { MAP_ENEMY_SPRITE_GROUPS } from "../../src/game/runtime/render/map-asset-groups";
import { setEnemyHpNumbersEnabled } from "../../src/ui/enemy-hp-setting";
import { drawStartingPlayer } from "../../src/game/player-appearance";
import { ITEM_PRESENTATIONS } from "../../src/game/item-presentation";
import { ENEMY_SPRITE_LAYOUTS } from "../../src/game/enemy-sprite-layouts.mjs";
import { ENEMY_TYPES, type EnemyKind } from "../../src/game/enemies";
import { ARMOR_CLASSES, BOOT_STYLES, GEAR_GRADES } from "../../shared/gear-grades";
import { gradeItemId, isGradeItemId } from "../../shared/grade-equipment";
import { PLAYER_GENDER_FEMALE, PLAYER_GENDER_MALE } from "../../shared/player-gender";
import { drawUntilStable } from "./determinism";
import { createWorld, enemySprites, fakeEnemy, resetCanvas, sceneCanvas, section, type FakePlayer } from "./world";

const LABEL_FONT = "bold 11px Arial, sans-serif";

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = "center") {
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#101410";
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = "#f2f2e8";
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** The phone framing: a 390 × 780 canvas at the base attack range (camera.ts). */
const PHONE_ZOOM = targetCameraZoom(BASE_ATTACK_RANGE, { width: 390, height: 780 });

const PLATE_PLAYERS: (FakePlayer & { local?: boolean })[] = [
  { id: "p-local", local: true, name: "Rymel", power: 12_345, hp: 840, maxHp: 1_200, guildTag: "TheG", prestige: 3, gender: PLAYER_GENDER_MALE, skinTone: 2, headItem: "heroic_medium_helmet", chestItem: "heroic_medium_armor", rightHandItem: "heroic_bow" },
  { id: "p-guest", name: "Guest4821", guest: true, prestige: 1, gender: PLAYER_GENDER_FEMALE, power: 980, hp: 90, maxHp: 1_500, fighting: true, skinTone: 4 },
  { id: "p-long", name: "Jiggly_Puppy_Gqyp", power: 1_234_567, hp: 1, maxHp: 1, prestige: 12, gender: PLAYER_GENDER_FEMALE, skinTone: 1, headItem: "legendary_magic_helmet", chestItem: "legendary_magic_armor", rightHandItem: "legendary_staff" },
  { id: "p-dev", name: "rymel", developer: true, guildTag: "TheG", power: 0, hp: 3_300, maxHp: 5_000, fighting: true, gender: PLAYER_GENDER_MALE, chat: "plates look even now?", skinTone: 0, headItem: "eternal_heavy_helmet", chestItem: "eternal_heavy_armor", rightHandItem: "eternal_sword" },
  { id: "p-plain", name: "Wanderer", power: 30, hp: 30, maxHp: 30, fighting: true, skinTone: 5 },
  { id: "p-guest2", name: "Guest0007", guest: true, power: 45_600, hp: 1, maxHp: 1, skinTone: 3, headItem: "crude_light_helmet" },
];

const PLATE_ENEMIES = ["Spitter", "Dune Raider", "Whiteout Reaper"];

/** Several players and enemies with their plates, at the phone camera framing. */
async function plates() {
  const width = 390, height = 900;
  const host = section(`Plates · phone framing, zoom ${PHONE_ZOOM.toFixed(3)} · dpr ${window.devicePixelRatio}`);
  const scene = sceneCanvas(host, width, height);
  const animated = Object.keys(ENEMY_SPRITE_LAYOUTS).find(kind => ENEMY_SPRITE_LAYOUTS[kind].animation && ENEMY_TYPES[kind as EnemyKind]);
  const enemyKinds = [...PLATE_ENEMIES, ...(animated ? [animated] : [])];
  const sprites = await enemySprites([...new Set(enemyKinds)]);
  const world = await createWorld(scene.ctx, { zoom: PHONE_ZOOM, viewport: { width, height }, players: PLATE_PLAYERS, enemySprites: sprites });
  const z = PHONE_ZOOM;
  const draw = () => {
    resetCanvas(scene);
    const { ctx } = scene;
    world.updateSpeechBubbles();
    ctx.save();
    ctx.scale(z, z);
    PLATE_PLAYERS.forEach((player, index) => {
      const x = (index % 2 ? 285 : 105) / z;
      const y = (170 + Math.floor(index / 2) * 150) / z;
      if (player.local) world.drawLocalPlayer(player, x, y);
      else world.drawRemotePlayer(player, x, y);
    });
    // Two rows of enemies: bars without numbers, then with (Settings > Enemy HP Numbers).
    [false, true].forEach((numbers, row) => {
      setEnemyHpNumbersEnabled(numbers);
      const kinds = row ? [animated ?? PLATE_ENEMIES[0], PLATE_ENEMIES[2], PLATE_ENEMIES[1]] : PLATE_ENEMIES;
      kinds.forEach((kind, column) => {
        const ratio = [1, .5, .08][column];
        const enemy = fakeEnemy(kind, (75 + column * 120) / z, (680 + row * 150) / z);
        enemy.hp = Math.max(1, Math.round(enemy.maxHp * ratio));
        world.actor.drawEnemy(enemy);
      });
    });
    setEnemyHpNumbersEnabled(true);
    ctx.restore();
  };
  await drawUntilStable(draw);
}

const GEAR_REFINES = [0, 10, 20] as const;
const WEAPON_CYCLE = ["bow", "sword", "staff", "bow"] as const;

/** One character per grade × refine × armour class: helmet, armour, boots and a weapon. */
async function gear() {
  const cell = 74, rowHeight = 96, labelWidth = 74;
  const columns = GEAR_REFINES.length * ARMOR_CLASSES.length;
  const width = labelWidth + columns * cell, height = 40 + GEAR_GRADES.length * rowHeight;
  const host = section("Gear · grade × refine (★0 ★10 ★20) × class (light medium heavy magic) · zoom 1");
  const scene = sceneCanvas(host, width, height);
  const world = await createWorld(scene.ctx, { zoom: 1, viewport: { width, height } });
  const others = Object.entries(ITEM_PRESENTATIONS).filter(([id, presentation]) => presentation?.world && !isGradeItemId(id)).map(([id]) => id);
  const perRow = 10;
  const otherHost = section(`Other gear · each piece with world art that is not graded (${others.length})`);
  const otherWidth = perRow * 96, otherHeight = Math.ceil(others.length / perRow) * 110 + 10;
  const otherScene = sceneCanvas(otherHost, otherWidth, otherHeight);
  const draw = () => {
    resetCanvas(scene);
    const { ctx } = scene;
    GEAR_REFINES.forEach((refine, refineIndex) => ARMOR_CLASSES.forEach((armorClass, classIndex) => {
      label(ctx, `★${refine} ${armorClass}`, labelWidth + (refineIndex * ARMOR_CLASSES.length + classIndex + .5) * cell, 6);
    }));
    GEAR_GRADES.forEach((grade, gradeIndex) => {
      const rowTop = 30 + gradeIndex * rowHeight;
      label(ctx, grade, 6, rowTop + 40, "left");
      GEAR_REFINES.forEach((refine, refineIndex) => ARMOR_CLASSES.forEach((armorClass, classIndex) => {
        const column = refineIndex * ARMOR_CLASSES.length + classIndex;
        const x = labelWidth + (column + .5) * cell;
        const y = rowTop + 52;
        drawStartingPlayer(ctx, world.assets, {
          x, y, facing: 0, moving: false, gameTime: 0, skinTone: classIndex,
          headItem: gradeItemId("helmet", grade, armorClass),
          chestItem: gradeItemId("armor", grade, armorClass),
          feetItem: gradeItemId("boots", grade, BOOT_STYLES[classIndex % BOOT_STYLES.length]),
          rightHandItem: gradeItemId(WEAPON_CYCLE[classIndex], grade),
          leftHandItem: "",
          itemRefine: () => refine,
        });
      }));
    });
    resetCanvas(otherScene);
    others.forEach((itemId, index) => {
      const x = (index % perRow + .5) * 96;
      const top = Math.floor(index / perRow) * 110;
      const slot = ITEM_PRESENTATIONS[itemId as keyof typeof ITEM_PRESENTATIONS]!.world!;
      const worn = slot.kind === "LEGS" ? { feetItem: itemId } : slot.layer === "HEAD" ? { headItem: itemId }
        : slot.layer === "CHEST" ? { chestItem: itemId } : { rightHandItem: itemId };
      drawStartingPlayer(otherScene.ctx, world.assets, { x, y: top + 62, facing: 0, moving: false, gameTime: 0, rightHandItem: "", leftHandItem: "", ...worn });
      label(otherScene.ctx, itemId.length > 15 ? `${itemId.slice(0, 14)}…` : itemId, x, top + 94);
    });
  };
  await drawUntilStable(draw);
}

type Motion = "idle" | "walk" | "attack";
const MOTIONS: Motion[] = ["idle", "walk", "attack"];

/**
 * One enemy at one frame of one motion, through drawEnemy and its animation sampler: a first, clipped-out
 * draw starts the motion, the second lands on the middle of frame `frame`.
 */
function drawEnemyFrame(world: Awaited<ReturnType<typeof createWorld>>, ctx: CanvasRenderingContext2D, kind: string, motion: Motion, frame: number, x: number, y: number, facingX: -1 | 1 = 1) {
  const animation = ENEMY_SPRITE_LAYOUTS[kind].animation!;
  const clip = animation.animations[motion];
  const start = 100;
  const enemy = fakeEnemy(kind, x, y, { hideStatus: true, facingX, vx: motion === "walk" ? 50 : 0 });
  const definition = ENEMY_TYPES[kind as EnemyKind] ?? enemy.definition!;
  const middle = (frame + .5) * clip.frameDurationMs;
  if (motion === "attack") {
    const attackDuration = Math.min(clip.durationMs / 1_000, .8 / Math.max(.01, definition.attackSpeed));
    enemy.attackAnimationElapsed = middle / clip.durationMs * attackDuration;
  }
  world.setGameTime(start);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 0, 0);
  ctx.clip();
  world.actor.drawEnemy(enemy);
  ctx.restore();
  world.setGameTime(motion === "attack" ? start : start + middle / 1_000);
  world.actor.drawEnemy(enemy);
}

function framePicks(count: number) {
  return [...new Set([0, Math.floor(count / 2)])];
}

/** Map → its enemy kinds, then "unplaced" for kinds no authored map lists (Endless and the like). */
function kindsByMap(filter: (kind: string) => boolean) {
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const [mapId, kinds] of Object.entries(MAP_ENEMY_SPRITE_GROUPS as Record<string, readonly string[]>)) {
    const picked = kinds.filter(kind => ENEMY_SPRITE_LAYOUTS[kind] && filter(kind) && !seen.has(kind));
    picked.forEach(kind => seen.add(kind));
    if (picked.length) groups.set(mapId, picked);
  }
  const rest = Object.keys(ENEMY_SPRITE_LAYOUTS).filter(kind => filter(kind) && !seen.has(kind));
  if (rest.length) groups.set("unplaced", rest);
  return groups;
}

/** Every atlas-animated enemy: idle, walk and attack at fixed frames, grouped by map. */
async function enemies() {
  const groups = kindsByMap(kind => Boolean(ENEMY_SPRITE_LAYOUTS[kind].animation));
  const sprites = await enemySprites([...groups.values()].flat());
  const labelWidth = 120;
  const draws: (() => void)[] = [];
  for (const [mapId, kinds] of groups) {
    const cellWidth = Math.max(...kinds.map(kind => ENEMY_SPRITE_LAYOUTS[kind].animation!.w)) + 12;
    const rowHeights = kinds.map(kind => { const animation = ENEMY_SPRITE_LAYOUTS[kind].animation!; return animation.bottom - animation.top + 34; });
    const cells = kinds.map(kind => MOTIONS.flatMap(motion => framePicks(ENEMY_SPRITE_LAYOUTS[kind].animation!.animations[motion].frames.length).map(frame => ({ motion, frame }))));
    const columns = Math.max(...cells.map(row => row.length));
    const width = labelWidth + columns * cellWidth, height = rowHeights.reduce((sum, value) => sum + value, 0);
    const host = section(`Enemies · ${mapId} · idle / walk / attack at frames 0 and middle`);
    const scene = sceneCanvas(host, width, height);
    const world = await createWorld(scene.ctx, { zoom: 1, viewport: { width, height }, enemySprites: sprites });
    draws.push(() => {
      resetCanvas(scene);
      let top = 0;
      kinds.forEach((kind, row) => {
        const bounds = enemySpriteVerticalBounds(sprites[kind], ENEMY_TYPES[kind as EnemyKind]?.r ?? 18);
        label(scene.ctx, kind, 6, top + 6, "left");
        cells[row].forEach(({ motion, frame }, column) => {
          const x = labelWidth + (column + .5) * cellWidth;
          drawEnemyFrame(world, scene.ctx, kind, motion, frame, x, top + 28 - bounds.top);
          label(scene.ctx, `${motion} ${frame}`, x, top + 4);
        });
        top += rowHeights[row];
      });
    });
  }
  await drawUntilStable(() => draws.forEach(draw => draw()));
}

/** The parts-built enemies (goblins, skeletons, slimes and the rest without an atlas), by family. */
async function parts() {
  const families = new Map<string, string[]>();
  for (const [kind, layout] of Object.entries(ENEMY_SPRITE_LAYOUTS)) {
    if (layout.animation) continue;
    const list = families.get(layout.family) ?? [];
    list.push(kind);
    families.set(layout.family, list);
  }
  const sprites = await enemySprites([...families.values()].flat());
  const labelWidth = 120, cellWidth = 120;
  const poses = [
    { name: "right", facingX: 1 as const, engaged: false },
    { name: "left", facingX: -1 as const, engaged: false },
    { name: "aiming", facingX: 1 as const, engaged: true },
  ];
  const draws: (() => void)[] = [];
  for (const [family, kinds] of families) {
    const rowHeights = kinds.map(kind => { const bounds = enemySpriteVerticalBounds(sprites[kind], ENEMY_TYPES[kind as EnemyKind]?.r ?? 18); return Math.ceil(bounds.bottom - bounds.top) + 30; });
    const width = labelWidth + poses.length * cellWidth, height = rowHeights.reduce((sum, value) => sum + value, 0);
    const host = section(`Parts · ${family}`);
    const scene = sceneCanvas(host, width, height);
    const world = await createWorld(scene.ctx, { zoom: 1, viewport: { width, height }, enemySprites: sprites });
    draws.push(() => {
      resetCanvas(scene);
      let top = 0;
      kinds.forEach((kind, row) => {
        const bounds = enemySpriteVerticalBounds(sprites[kind], ENEMY_TYPES[kind as EnemyKind]?.r ?? 18);
        label(scene.ctx, kind, 6, top + 6, "left");
        poses.forEach((pose, column) => {
          const x = labelWidth + (column + .5) * cellWidth, y = top + 20 - bounds.top;
          const enemy = fakeEnemy(kind, x, y, { hideStatus: true, facingX: pose.facingX, engaged: pose.engaged, combatTargetX: x + 200, combatTargetY: y - 120 });
          world.setGameTime(0);
          world.actor.drawEnemy(enemy);
          label(scene.ctx, pose.name, x, top + 4);
        });
        top += rowHeights[row];
      });
    });
  }
  await drawUntilStable(() => draws.forEach(draw => draw()));
}

export const WORLD_SCENES: Record<string, () => Promise<void>> = { plates, gear, enemies, parts };
