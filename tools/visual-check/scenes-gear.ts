// The gear scene: characters in every grade, refine and class, and the poses gear is drawn in.
import { drawStartingPlayer } from "../../src/game/player-appearance";
import { ITEM_PRESENTATIONS } from "../../src/game/item-presentation";
import { MINING_PICKAXE, PICKAXE_OVERRIDES } from "../../src/game/runtime/town/pickaxe-sprite";
import { HATCHET_OVERRIDES, WOODCUTTING_HATCHET } from "../../src/game/runtime/town/hatchet-sprite";
import { toolArtSource, toolSprite } from "../../src/game/runtime/town/tool-sprites";
import { PLAYER_DEATH_FALL_DURATION_MS, type PlayerDeathAnimationState } from "../../src/game/runtime/player-death-animation";
import { ARMOR_CLASSES, BOOT_STYLES, GEAR_GRADES } from "../../shared/gear-grades";
import { gradeItemId, isGradeItemId } from "../../shared/grade-equipment";
import { PLAYER_SKIN_TONES } from "../../shared/player-skin-tones";
import {
  DIAMOND_GALAXY_ARMOR, DIAMOND_GALAXY_BOOTS, DIAMOND_GALAXY_BOW, DIAMOND_GALAXY_HELMET,
  GALAXY_ARMOR, GALAXY_BOOTS, GALAXY_BOW, GALAXY_HELMET, STARTER_BOW, STARTER_STAFF, STARTER_STONE, WOODEN_SWORD,
} from "../../shared/items";
import { drawUntilStable } from "./determinism";
import { createWorld, label, resetCanvas, sceneCanvas, section, type SceneCanvas } from "./world";

type Assets = Awaited<ReturnType<typeof createWorld>>["assets"];
type Pose = Parameters<typeof drawStartingPlayer>[2];

/** A titled grid of character cells; `cell` draws one at its feet-centre (x, y). */
function grid(title: string, columns: string[], rows: string[], cellWidth: number, cellHeight: number) {
  const labelWidth = 92, headHeight = 22;
  const width = labelWidth + columns.length * cellWidth, height = headHeight + rows.length * cellHeight;
  const scene = sceneCanvas(section(title), width, height);
  return {
    scene,
    /** Clears and labels the grid, then calls `cell` for every column and row. */
    draw(cell: (ctx: CanvasRenderingContext2D, column: number, row: number, x: number, y: number) => void) {
      resetCanvas(scene);
      const { ctx } = scene;
      columns.forEach((text, column) => label(ctx, text, labelWidth + (column + .5) * cellWidth, 4));
      rows.forEach((text, row) => {
        label(ctx, text, 6, headHeight + row * cellHeight + cellHeight / 2 - 6, "left");
        columns.forEach((_, column) => cell(ctx, column, row, labelWidth + (column + .5) * cellWidth, headHeight + row * cellHeight + cellHeight * .62));
      });
    },
  };
}

const GEAR_REFINES = [0, 10, 20] as const;
const WEAPON_CYCLE = ["bow", "sword", "staff", "bow"] as const;

/** One character per grade × refine × armour class: helmet, armour, boots and a weapon. */
function gradedGear(assets: Assets) {
  const columns = GEAR_REFINES.flatMap(refine => ARMOR_CLASSES.map(armorClass => `★${refine} ${armorClass}`));
  const view = grid("Gear · grade × refine (★0 ★10 ★20) × class (light medium heavy magic) · zoom 1", columns, [...GEAR_GRADES], 74, 96);
  return () => view.draw((ctx, column, row, x, y) => {
    const refine = GEAR_REFINES[Math.floor(column / ARMOR_CLASSES.length)], classIndex = column % ARMOR_CLASSES.length;
    const grade = GEAR_GRADES[row], armorClass = ARMOR_CLASSES[classIndex];
    drawStartingPlayer(ctx, assets, {
      x, y, facing: 0, moving: false, gameTime: 0, skinTone: classIndex,
      headItem: gradeItemId("helmet", grade, armorClass),
      chestItem: gradeItemId("armor", grade, armorClass),
      feetItem: gradeItemId("boots", grade, BOOT_STYLES[classIndex % BOOT_STYLES.length]),
      rightHandItem: gradeItemId(WEAPON_CYCLE[classIndex], grade),
      leftHandItem: "",
      itemRefine: () => refine,
    });
  });
}

const THRESHOLD_REFINES = [0, 9, 10, 19, 20, 30];
/** One grade's pieces either side of each refine look's threshold: the base look to ★9, ★10 to ★19, ★20 on. */
function refineThresholds(assets: Assets) {
  const rows = ARMOR_CLASSES.map((armorClass, index) => ({ armorClass, weapon: WEAPON_CYCLE[index] }));
  const view = grid("Refine looks · epic gear at ★0 ★9 ★10 ★19 ★20 ★30", THRESHOLD_REFINES.map(refine => `★${refine}`), rows.map(row => row.armorClass), 96, 96);
  return () => view.draw((ctx, column, row, x, y) => {
    const { armorClass, weapon } = rows[row];
    drawStartingPlayer(ctx, assets, {
      x, y, facing: 0, moving: false, gameTime: 0,
      headItem: gradeItemId("helmet", "epic", armorClass), chestItem: gradeItemId("armor", "epic", armorClass),
      feetItem: gradeItemId("boots", "epic", BOOT_STYLES[row % BOOT_STYLES.length]), rightHandItem: gradeItemId(weapon, "epic"), leftHandItem: "",
      itemRefine: () => THRESHOLD_REFINES[column],
    });
  });
}

/** Every non-graded piece with world art, worn alone. */
function otherGear(assets: Assets) {
  const others = Object.entries(ITEM_PRESENTATIONS).filter(([id, presentation]) => presentation?.world && !isGradeItemId(id)).map(([id]) => id);
  const perRow = 10;
  const scene = sceneCanvas(section(`Other gear · each piece with world art that is not graded (${others.length})`), perRow * 96, Math.ceil(others.length / perRow) * 110 + 10);
  return () => {
    resetCanvas(scene);
    others.forEach((itemId, index) => {
      const x = (index % perRow + .5) * 96;
      const top = Math.floor(index / perRow) * 110;
      const slot = ITEM_PRESENTATIONS[itemId as keyof typeof ITEM_PRESENTATIONS]!.world!;
      const worn = slot.kind === "LEGS" ? { feetItem: itemId } : slot.layer === "HEAD" ? { headItem: itemId }
        : slot.layer === "CHEST" ? { chestItem: itemId } : { rightHandItem: itemId };
      drawStartingPlayer(scene.ctx, assets, { x, y: top + 62, facing: 0, moving: false, gameTime: 0, rightHandItem: "", leftHandItem: "", ...worn });
      label(scene.ctx, itemId.length > 15 ? `${itemId.slice(0, 14)}…` : itemId, x, top + 94);
    });
  };
}

const HELD = [
  { name: "stone", item: STARTER_STONE }, { name: "bow", item: STARTER_BOW }, { name: "sword", item: WOODEN_SWORD },
  { name: "staff", item: STARTER_STAFF }, { name: "rare bow", item: "rare_bow" }, { name: "mythic sword", item: "mythic_sword" },
];
const hands = (item: string, left: boolean) => ({ rightHandItem: left ? "" : item, leftHandItem: left ? item : "" });

/** Each weapon in either hand, facing right and left: the grip stays in the same hand as the body turns. */
function heldWeapons(assets: Assets) {
  const columns = ["right hand →", "right hand ←", "left hand →", "left hand ←"];
  const view = grid("Held weapons · either hand, facing right and left", columns, HELD.map(held => held.name), 96, 100);
  return () => view.draw((ctx, column, row, x, y) => drawStartingPlayer(ctx, assets, {
    x, y, facing: column % 2 ? Math.PI : 0, moving: false, gameTime: 0, chestItem: "rare_medium_armor", ...hands(HELD[row].item, column >= 2),
  }));
}

const AIMS = [0, 45, 90, 135, 180, -135, -90, -45];
/** Combat aim in eight directions: bows point along the shot, in either hand; swords and staffs face it. */
function aim(assets: Assets) {
  const rows = [
    { name: "bow, right", item: STARTER_BOW, left: false }, { name: "bow, left", item: STARTER_BOW, left: true },
    { name: "rare bow", item: "rare_bow", left: false }, { name: "sword", item: WOODEN_SWORD, left: false }, { name: "staff", item: STARTER_STAFF, left: false },
  ];
  const view = grid("Aim · combat facing in eight directions (0° is right, 90° is down)", AIMS.map(degrees => `${degrees}°`), rows.map(row => row.name), 96, 100);
  return () => view.draw((ctx, column, row, x, y) => {
    const combatFacing = AIMS[column] * Math.PI / 180;
    drawStartingPlayer(ctx, assets, { x, y, facing: combatFacing, combatFacing, moving: false, gameTime: 0, ...hands(rows[row].item, rows[row].left) });
  });
}

const RUN_TIMES = [0, .1, .2, .3, .45];
/** Running: legs step and the held weapon sways, mirrored for the other hand; standing still, the head bobs. */
function running(assets: Assets) {
  const rows = [
    { name: "bow, right", item: STARTER_BOW, left: false, moving: true }, { name: "bow, left", item: STARTER_BOW, left: true, moving: true },
    { name: "sword", item: WOODEN_SWORD, left: false, moving: true }, { name: "staff", item: STARTER_STAFF, left: false, moving: true },
    { name: "idle bob", item: STARTER_BOW, left: false, moving: false },
  ];
  const times = (row: number) => rows[row].moving ? RUN_TIMES : [0, .5, 1, 1.5, 2];
  const view = grid("Running and idle · sampled through the walk cycle and the idle bob", RUN_TIMES.map((_, index) => `frame ${index + 1}`), rows.map(row => row.name), 96, 100);
  return () => view.draw((ctx, column, row, x, y) => drawStartingPlayer(ctx, assets, {
    x, y, facing: 0, moving: rows[row].moving, gameTime: times(row)[column], headItem: "rare_light_helmet", ...hands(rows[row].item, rows[row].left),
  }));
}

const SWING_CLOCKS = [.42, .36, .3, .2, .05];
/** The attack: a throw, a swing, a cast and a shot, sampled from wind-up to follow-through. */
function attacks(assets: Assets) {
  const rows = HELD.slice(0, 4);
  const view = grid("Attacks · throw / swing / cast / shot from wind-up to follow-through", SWING_CLOCKS.map(clock => `${Math.round((.42 - clock) * 1000)} ms`), rows.map(row => row.name), 96, 100);
  return () => view.draw((ctx, column, row, x, y) => drawStartingPlayer(ctx, assets, {
    x, y, facing: 0, combatFacing: 0, moving: false, gameTime: 0, throwClock: SWING_CLOCKS[column], rightHandItem: rows[row].item, leftHandItem: "",
  }));
}

const TOOL_LEVELS = [0, 2, 4, 6, 8, 10];
/** Gathering tools in hand at each level, mid-swing; the Smith's painted tools beside them. */
function tools(assets: Assets) {
  const held = [
    { name: "pickaxe", id: MINING_PICKAXE, tool: "pickaxe" as const, overrides: PICKAXE_OVERRIDES },
    { name: "hatchet", id: WOODCUTTING_HATCHET, tool: "hatchet" as const, overrides: HATCHET_OVERRIDES },
  ];
  const view = grid("Tools · pickaxe and hatchet in hand by level (idle, then mid-swing)", TOOL_LEVELS.map(level => `level ${level}`), held.flatMap(tool => [tool.name, `${tool.name} swing`]), 96, 100);
  const painted = ["hammer", "knife", "focus"] as const;
  const art = painted.map(tool => TOOL_LEVELS.map(level => { const image = new Image(); image.src = toolArtSource(tool, level); return image; }));
  const flat = grid("Tools · the Smith's painted Hammer, Knife and Focus by level", TOOL_LEVELS.map(level => `level ${level}`), [...painted], 128, 64);
  return () => {
    view.draw((ctx, column, row, x, y) => {
      const tool = held[Math.floor(row / 2)];
      const sprite = toolSprite(tool.tool, TOOL_LEVELS[column]);
      if (sprite) assets.equipment[tool.id] = { sprite };
      drawStartingPlayer(ctx, assets, {
        x, y, facing: 0, moving: false, gameTime: 0, throwClock: row % 2 ? .3 : 0, rightHandItem: tool.id, leftHandItem: "", presentationOverrides: tool.overrides,
      });
    });
    flat.draw((ctx, column, row, x, y) => {
      const image = art[row][column];
      if (image.complete && image.naturalWidth) ctx.drawImage(image, x - 59, y - 40, 118, 59);
    });
  };
}

/** The Galaxy and Diamond Galaxy finishes on every slot, still and running, at two moments of their drifting sky. */
function finishes(assets: Assets) {
  const sets = [
    { name: "Galaxy", items: { headItem: GALAXY_HELMET, chestItem: GALAXY_ARMOR, feetItem: GALAXY_BOOTS, rightHandItem: GALAXY_BOW } },
    { name: "Diamond", items: { headItem: DIAMOND_GALAXY_HELMET, chestItem: DIAMOND_GALAXY_ARMOR, feetItem: DIAMOND_GALAXY_BOOTS, rightHandItem: DIAMOND_GALAXY_BOW } },
  ];
  const columns = ["still →", "still ←", "running", "aiming 45°", "left hand"];
  const view = grid("Finishes · Galaxy and Diamond Galaxy sets", columns, sets.map(set => set.name), 104, 104);
  return () => view.draw((ctx, column, row, x, y) => {
    const { items } = sets[row];
    const pose: Pose = { x, y, facing: column === 1 ? Math.PI : 0, moving: column === 2, gameTime: column === 2 ? .2 : 0, ...items, leftHandItem: "" };
    if (column === 3) Object.assign(pose, { combatFacing: Math.PI / 4, facing: Math.PI / 4 });
    if (column === 4) Object.assign(pose, { rightHandItem: "", leftHandItem: items.rightHandItem });
    drawStartingPlayer(ctx, assets, pose);
  });
}

/** Every skin tone bareheaded, facing both ways: the face template, its outline and the eyes. */
function faces(assets: Assets) {
  const tones = PLAYER_SKIN_TONES.map((_, index) => index);
  const half = Math.ceil(tones.length / 2);
  const view = grid("Faces · every skin tone, bareheaded, facing right then left", tones.slice(0, half).map(tone => `tone ${tone}`), ["→", "←", "→", "←"], 64, 92);
  return () => view.draw((ctx, column, row, x, y) => drawStartingPlayer(ctx, assets, {
    x, y, facing: row % 2 ? Math.PI : 0, moving: false, gameTime: 0, skinTone: tones[column + (row >= 2 ? half : 0)], rightHandItem: "", leftHandItem: "",
  }));
}

const DEATH_AGES = [0, 250, 500, PLAYER_DEATH_FALL_DURATION_MS, 5_000];
/** A player falling: the body tips over, the helmet and weapon land on either side, and the head lies still. */
async function deaths(): Promise<() => void> {
  const outfits = [
    { name: "plain", gear: { rightHandItem: STARTER_BOW } },
    { name: "helmet, sword", gear: { headItem: "rare_heavy_helmet", chestItem: "rare_heavy_armor", feetItem: "rare_warrior_boots", rightHandItem: WOODEN_SWORD } },
    { name: "galaxy ←", gear: { headItem: GALAXY_HELMET, chestItem: GALAXY_ARMOR, feetItem: GALAXY_BOOTS, rightHandItem: GALAXY_BOW }, facing: Math.PI },
  ];
  const cellWidth = 230, cellHeight = 110, labelWidth = 92;
  const columns = DEATH_AGES.map(age => `${age} ms`);
  const width = labelWidth + columns.length * cellWidth, height = 22 + outfits.length * cellHeight;
  const scene: SceneCanvas = sceneCanvas(section("Death · the fall over time, then lying still"), width, height);
  const NOW = 100_000;
  const deathsById = new Map<string, PlayerDeathAnimationState>();
  const players = outfits.flatMap((outfit, row) => DEATH_AGES.map((age, column) => {
    const id = `dead-${row}-${column}`;
    const x = labelWidth + (column + .5) * cellWidth, y = 22 + row * cellHeight + cellHeight * .45;
    deathsById.set(id, { id, x, y, facing: outfit.facing ?? 0, startedAtMs: NOW - age });
    return { id, name: id, power: 1, hp: 0, maxHp: 1, ...outfit.gear, x, y };
  }));
  const world = await createWorld(scene.ctx, { zoom: 1, viewport: { width, height }, players, remoteDeath: id => deathsById.get(id) ?? null, nowMs: () => NOW });
  return () => {
    resetCanvas(scene);
    columns.forEach((text, column) => label(scene.ctx, text, labelWidth + (column + .5) * cellWidth, 4));
    outfits.forEach((outfit, row) => label(scene.ctx, outfit.name, 6, 22 + row * cellHeight + cellHeight / 2 - 6, "left"));
    for (const player of players) world.drawRemotePlayer(player, player.x, player.y);
  };
}

/** One character per grade × refine × class, every other worn piece, and the poses gear is drawn in. */
export async function gear() {
  const { assets } = await createWorld(document.createElement("canvas").getContext("2d")!, { zoom: 1, viewport: { width: 1, height: 1 } });
  const draws = [gradedGear(assets), refineThresholds(assets), otherGear(assets), heldWeapons(assets), aim(assets), running(assets), attacks(assets),
    tools(assets), finishes(assets), faces(assets), await deaths()];
  await drawUntilStable(() => draws.forEach(draw => draw()));
}
