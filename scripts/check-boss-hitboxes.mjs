#!/usr/bin/env node
/**
 * Measure each boss's drawn artwork against the collision circle the server
 * hits it with, so a hitbox that does not match what a player can see shows up
 * as a number rather than as a complaint.
 *
 * The client draws each boss from an atlas or sheet. Compare the opaque art
 * with its shared hitbox, or the server constant for bosses without a sheet.
 *
 * Only the bosses drawn from artwork are measured here. The rest are drawn
 * with canvas primitives, so their extent is code rather than pixels and has
 * to be read off a render.
 *
 *     node scripts/check-boss-hitboxes.mjs
 */
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Key out green backdrops as the client does before drawing. Measuring the raw
// green reports entire cells as bodies and gives misleading recommendations.
const pixelSource = await readFile("src/game/runtime/render/sprite-pixels.ts", "utf8");
const pixelModule = ts.transpileModule(pixelSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { removeGreenPixels } = await import(`data:text/javascript;base64,${Buffer.from(pixelModule).toString("base64")}`);
const bossArt = JSON.parse(await readFile("src/game/boss-art.json", "utf8"));
const frameCrops = JSON.parse(await readFile("src/game/boss-frame-crops.json", "utf8"));
const greenSheets = new Set(Object.values(bossArt).filter((boss) => boss.preprocess === "green").map((boss) => boss.sheet));
const processedSheets = new Map();
async function processedSheet(path) {
  if (processedSheets.has(path)) return processedSheets.get(path);
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  if (greenSheets.has(path.split("/").pop())) removeGreenPixels(pixels, 145, 1.45);
  const sheet = { data: pixels, info };
  processedSheets.set(path, sheet);
  return sheet;
}

const hitboxSource = await readFile("shared/boss-hitbox.ts", "utf8");
const combatSource = await readFile("spacetimedb/src/boss-combat.ts", "utf8");
const RADIUS = /export const (\w+)_RADIUS = (\d+);/g;
const radii = Object.fromEntries([...combatSource.matchAll(RADIUS), ...hitboxSource.matchAll(RADIUS)].map((m) => [m[1], Number(m[2])]));
const constantsSource = await readFile("src/game/constants.ts", "utf8");
const readNumber = (source, name) => {
  const match = source.match(new RegExp(`export const ${name} = (-?[\\d.]+);`));
  return match ? Number(match[1]) : undefined;
};

/** The opaque extent of an atlas animation, in world units around the anchor. */
function atlasExtent(atlas, spriteHeight, animation = "idle") {
  const scale = spriteHeight / (atlas.bounds.bottom - atlas.bounds.top);
  const drawX = -atlas.anchorX * scale;
  const drawY = spriteHeight / 2 - atlas.bounds.bottom * scale;
  const extent = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const frame of atlas.animations[animation].frames) {
    const content = frame.contentBounds ?? { x: 0, y: 0, w: frame.w, h: frame.h };
    const scaleX = atlas.frameWidth * scale / frame.w;
    const scaleY = atlas.frameHeight * scale / frame.h;
    extent.left = Math.min(extent.left, drawX + content.x * scaleX);
    extent.right = Math.max(extent.right, drawX + (content.x + content.w) * scaleX);
    extent.top = Math.min(extent.top, drawY + content.y * scaleY);
    extent.bottom = Math.max(extent.bottom, drawY + (content.y + content.h) * scaleY);
  }
  return extent;
}

/** The same, for a boss drawn from a strip of equal frames. */
async function sheetExtent(path, { frames, drawWidth, groundOffset, groundBaseline }) {
  const { data, info } = await processedSheet(path);
  const frameWidth = Math.floor(info.width / frames);
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] < 16) continue;
      const withinFrame = x % frameWidth;
      if (withinFrame < left) left = withinFrame;
      if (withinFrame > right) right = withinFrame;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  const scale = drawWidth / frameWidth;
  const drawHeight = drawWidth * info.height / frameWidth;
  const topOffset = groundOffset - drawHeight * groundBaseline;
  return {
    left: (left - frameWidth / 2) * scale,
    right: (right + 1 - frameWidth / 2) * scale,
    top: topOffset + top * scale,
    bottom: topOffset + (bottom + 1) * scale,
  };
}

/**
 * A boss drawn as a strip of equal cells, scaled into drawWidth x drawHeight
 * centred on the anchor plus its Y offset. The cell usually has transparent
 * margin, which is why the status bar floats: it hangs off the cell's top edge
 * rather than the top of the creature.
 */
async function cellExtent(path, { frames, rows = 1, drawWidth, drawHeight, offsetY, measureFrames, crops = {} }) {
  const { data, info } = await processedSheet(path);
  const cellWidth = Math.floor(info.width / frames);
  const cellHeight = Math.floor(info.height / rows);
  const scaleX = drawWidth / cellWidth, scaleY = drawHeight / cellHeight;
  const wanted = measureFrames ? new Set(measureFrames) : null;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] < 16) continue;
      const frame = Math.floor(y / cellHeight) * frames + Math.floor(x / cellWidth);
      if (wanted && !wanted.has(frame)) continue;
      // The tuner's per-frame move, in cell pixels.
      const crop = crops[frame] ?? {};
      const withinX = x % cellWidth + (crop.offsetX ?? 0) / scaleX, withinY = y % cellHeight + (crop.offsetY ?? 0) / scaleY;
      if (withinX < left) left = withinX;
      if (withinX > right) right = withinX;
      if (withinY < top) top = withinY;
      if (withinY > bottom) bottom = withinY;
    }
  }
  return {
    left: (left - cellWidth / 2) * scaleX,
    right: (right + 1 - cellWidth / 2) * scaleX,
    top: offsetY + (top - cellHeight / 2) * scaleY,
    bottom: offsetY + (bottom + 1 - cellHeight / 2) * scaleY,
    // What the status bar is currently anchored to, for comparison.
    cellTop: offsetY - drawHeight / 2,
  };
}

/**
 * The creature's body, as opposed to everything its sprite contains.
 *
 * Horns, tails and weapons are narrow; the body is the wide part. Rows at
 * least 60% as wide as the widest one are the body, which is what a player
 * aims at and what the hitbox should cover.
 */
async function bodyExtent(path, { frames, rows = 1, drawWidth, drawHeight, offsetY, measureFrames, crops = {} }) {
  const { data, info } = await processedSheet(path);
  const cellWidth = Math.floor(info.width / frames);
  const cellHeight = Math.floor(info.height / rows);
  const scaleX = drawWidth / cellWidth, scaleY = drawHeight / cellHeight;
  // Only the poses the hitbox should answer for. A wind-up that throws the
  // creature across its cell would otherwise set the body's size for every
  // frame, including the one it stands still in.
  const poses = measureFrames ?? Array.from({ length: frames }, (_, index) => index);
  const lefts = new Map(), rights = new Map();
  for (const pose of poses) {
    const base = pose * cellWidth;
    const crop = crops[pose] ?? {};
    const moveX = (crop.offsetX ?? 0) / scaleX, moveY = Math.round((crop.offsetY ?? 0) / scaleY);
    for (let y = 0; y < cellHeight; y += 1) {
      for (let x = base; x < base + cellWidth; x += 1) {
        if (data[(y * info.width + x) * 4 + 3] < 16) continue;
        const row = y + moveY, within = x - base + moveX;
        if (within < (lefts.get(row) ?? Infinity)) lefts.set(row, within);
        if (within > (rights.get(row) ?? -Infinity)) rights.set(row, within);
      }
    }
  }
  const rowsDrawn = [...lefts.keys()].sort((a, b) => a - b);
  const widths = rowsDrawn.map((y) => ({ y, width: rights.get(y) - lefts.get(y) + 1 }));
  const widest = Math.max(...widths.map((row) => row.width));
  const toWorld = (y) => offsetY + (y - cellHeight / 2) * scaleY;
  const body = widths.filter((row) => row.width >= widest * 0.6);
  if (!body.length) return null;
  const top = toWorld(body[0].y), bottom = toWorld(body[body.length - 1].y + 1);
  return { top, bottom, verticalRadius: (bottom - top) / 2, offsetY: (top + bottom) / 2 };
}

const round = (value, width = 5) => String(Math.round(value)).padStart(width);

function report(name, radius, extent) {
  const halfWidth = Math.max(Math.abs(extent.left), Math.abs(extent.right));
  const centreOffset = (extent.left + extent.right) / 2;
  console.log(
    `${name.padEnd(12)} radius ${round(radius, 4)}` +
    `  art x[${round(extent.left)},${round(extent.right)}] y[${round(extent.top)},${round(extent.bottom)}]` +
    `  half-width ${round(halfWidth, 4)}  off-centre ${round(centreOffset, 4)}`,
  );
}

const rhino = (await import("../src/game/enemy-atlases/rhino-armor-512.mjs")).default;
const reaper = (await import("../src/game/enemy-atlases/reaper-death-512.mjs")).default;

report("ironhorn", radii.IRONHORN, atlasExtent(rhino, 340));
report("dreadreaper", radii.DREADREAPER, atlasExtent(reaper, 340));

// Prismshell is a single texture with authored bounds rather than an atlas.
const prismshell = { left: 17, top: 15, right: 1242, bottom: 1239 };
const prismshellScale = 340 / (prismshell.bottom - prismshell.top);
const prismshellHalf = (prismshell.right - prismshell.left) * prismshellScale / 2;
report("prismshell", radii.PRISMSHELL, { left: -prismshellHalf, right: prismshellHalf, top: -170, bottom: 170 });

report("spider", radii.SPIDER, await sheetExtent(
  `public/assets/wildstat/${bossArt.SPIDER.sheet}`,
  { frames: 4, drawWidth: bossArt.SPIDER.drawWidth, groundOffset: 55, groundBaseline: bossArt.SPIDER.groundBaseline },
));

/** Sheet, cells and draw box as the game reads them from boss-art.json. */
const sheetBoss = (key, extra = {}) => {
  const { sheet, frames, rows, drawWidth, drawHeight } = bossArt[key];
  return [sheet, { frames: key === "GLOOMROOT" ? 2 : frames, rows, drawWidth, drawHeight, crops: frameCrops[key], ...extra }];
};
const SHEETS = [
  ["frostclaw", "FROSTCLAW", ...sheetBoss("FROSTCLAW", { offsetY: -12 })],
  ["magmalisk", "MAGMALISK", ...sheetBoss("MAGMALISK", { offsetY: -8 })],
  ["gloomroot", "GLOOMROOT", ...sheetBoss("GLOOMROOT", { offsetY: -18 })],
  ["tidewyrm", "TIDEWYRM", ...sheetBoss("TIDEWYRM", { offsetY: -28 })],
  // Frame 3 is each one's summoned attack — the whirlpools and the
  // thunderbolts — which throws the creature out of the shape it holds.
  ["koi shogun", "KOI_SHOGUN", ...sheetBoss("KOI_SHOGUN", { offsetY: -30, measureFrames: [0, 1, 2] })],
  ["tempest kirin", "TEMPEST_KIRIN", ...sheetBoss("TEMPEST_KIRIN", { offsetY: -42, measureFrames: [0, 1, 2] })],
  // The idle frame alone. The tongue reaches and the bog burst rears the toad
  // up out of its own body; sizing the hitbox to either hands back the reach
  // this is removing for every frame it is not doing it.
  ["miremaw", "MIREMAW", ...sheetBoss("MIREMAW", { offsetY: -45, measureFrames: [0] })],
];

console.log("");
for (const [name, key, file, geometry] of SHEETS) {
  const path = `public/assets/wildstat/${file}`;
  const currentGeometry = { ...geometry, offsetY: readNumber(constantsSource, `${key}_SPRITE_Y_OFFSET`) ?? geometry.offsetY };
  const extent = await cellExtent(path, currentGeometry);
  report(name, radii[key], extent);
  const halfHeight = Math.max(Math.abs(extent.top), Math.abs(extent.bottom));
  const body = await bodyExtent(path, currentGeometry);
  const verticalRadius = readNumber(hitboxSource, `${key}_VERTICAL_RADIUS`) ?? radii[key];
  const hitboxOffsetY = readNumber(hitboxSource, `${key}_HITBOX_OFFSET_Y`) ?? 0;
  const artTop = readNumber(constantsSource, `${key}_ART_TOP`);
  const statusAnchor = currentGeometry.offsetY + (artTop ?? -currentGeometry.drawHeight / 2);
  const float = extent.top - statusAnchor;
  const notes = [];
  if (body) {
    // Positive means the hitbox reaches past the body into open air, which is
    // the Miremaw fault: a shot lands before it touches the creature. Negative
    // means the hitbox stops short of the artwork, which is the opposite
    // complaint and not what we are hunting here.
    const above = body.top - (hitboxOffsetY - verticalRadius);
    const below = hitboxOffsetY + verticalRadius - body.bottom;
    if (above > 40 || below > 40) {
      notes.push(`reaches past the body: ${round(above, 0)} above, ${round(below, 0)} below`);
    } else if (above < -40 || below < -40) {
      notes.push(`stops short of the artwork: ${round(-above, 0)} above, ${round(-below, 0)} below`);
    }
    console.log(
      `${"".padEnd(12)} body y[${round(body.top)},${round(body.bottom)}]` +
      `  suggests verticalRadius ${round(body.verticalRadius, 4)} offsetY ${round(body.offsetY, 4)}`,
    );
  }
  if (float > 45) notes.push(`status anchor sits ${round(float, 0)}px above the artwork`);
  for (const note of notes) console.log(`${"".padEnd(12)} ! ${note}`);
  console.log(`${"".padEnd(12)}   half-height ${round(halfHeight, 4)} vs radius ${round(radii[key], 4)}`);
}

console.log("\nNot measured here: dragon, voltwarden, gravebloom, aegis prime");
