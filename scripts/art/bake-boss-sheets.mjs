#!/usr/bin/env node
/**
 * Bakes the campaign boss sheets listed in scripts/art/boss-sheets.json into transparent strips with padded cells.
 *
 *   node scripts/art/bake-boss-sheets.mjs [BOSS_ID ...] [--source <folder of the source PNGs>]
 *
 * The generated sheets put poses wherever they fell, some reaching across the equal cells the game reads, so a
 * hand or a tail was cut at the cell edge. Each pose here is every pixel that belongs to it (its solid body, all
 * joined to it, loose bits in its cell), moved by its frame's `shift` into a cell with `pad` pixels of room on
 * every side. Fails rather than writes when a pose comes within `margin` of its cell's edge, and says what pad fits.
 *
 * Sources default to the lossless PNGs the game shipped before WebP, read from git at the recipe's `ref`.
 */
import sharp from "sharp";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const recipe = JSON.parse(readFileSync(join(import.meta.dirname, "boss-sheets.json"), "utf8"));
const wanted = [];
let sourceFolder = null;
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === "--source") sourceFolder = resolve(process.argv[++index]);
  else wanted.push(process.argv[index]);
}

// The green key, removed here so the game loads the sheets as they are.
const pixelModule = ts.transpileModule(readFileSync(join(root, "src/game/runtime/render/sprite-pixels.ts"), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { removeGreenPixels } = await import(`data:text/javascript;base64,${Buffer.from(pixelModule).toString("base64")}`);

function readSource(file) {
  if (sourceFolder) return readFileSync(join(sourceFolder, file));
  return execFileSync("git", ["show", `${recipe.ref}:${recipe.folder}/${file}`], { cwd: root, maxBuffer: 1 << 28 });
}

const NEIGHBOURS = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy])).filter(([dx, dy]) => dx || dy);

/** Pixels that stay set when every pixel within `radius` (a square) is set. */
function erode(mask, width, height, radius) {
  const across = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  const sums = new Int32Array(Math.max(width, height) + 1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) sums[x + 1] = sums[x] + mask[y * width + x];
    for (let x = radius; x < width - radius; x += 1) across[y * width + x] = sums[x + radius + 1] - sums[x - radius] === radius * 2 + 1 ? 1 : 0;
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) sums[y + 1] = sums[y] + across[y * width + x];
    for (let y = radius; y < height - radius; y += 1) out[y * width + x] = sums[y + radius + 1] - sums[y - radius] === radius * 2 + 1 ? 1 : 0;
  }
  return out;
}

function components(mask, width, height) {
  const labels = new Int32Array(mask.length), queue = new Int32Array(mask.length);
  let count = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;
    labels[start] = ++count;
    let head = 0, tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const at = queue[head++], x = at % width, y = (at - x) / width;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (mask[next] && !labels[next]) { labels[next] = count; queue[tail++] = next; }
      }
    }
  }
  return { labels, count };
}

/** Which frame owns each visible pixel: its pose's solid core grown through the sprite, loose bits by their cell. */
function poseOwners(pixels, width, height, boss) {
  const cellWidth = width / boss.columns, cellHeight = height / boss.rows, frames = boss.columns * boss.rows;
  const cellOf = (at) => {
    const x = at % width, y = (at - x) / width;
    return Math.min(boss.rows - 1, Math.floor(y / cellHeight)) * boss.columns + Math.min(boss.columns - 1, Math.floor(x / cellWidth));
  };
  const solid = new Uint8Array(width * height);
  for (let at = 0; at < solid.length; at += 1) solid[at] = pixels[at * 4 + 3] >= 128 ? 1 : 0;
  for (const radius of [3, 6, 10, 16]) {
    // Thin wisps where two poses touch wear away first, leaving one core per cell.
    const { labels, count } = components(erode(solid, width, height, radius), width, height);
    const inCell = Array.from({ length: count + 1 }, () => new Float64Array(frames));
    for (let at = 0; at < labels.length; at += 1) if (labels[at]) inCell[labels[at]][cellOf(at)] += 1;
    const cores = new Array(frames).fill(0), sizes = new Array(frames).fill(0);
    for (let label = 1; label <= count; label += 1) {
      const total = inCell[label].reduce((sum, value) => sum + value, 0);
      const cell = inCell[label].indexOf(Math.max(...inCell[label]));
      if (inCell[label][cell] / total > .9 && total > sizes[cell]) { sizes[cell] = total; cores[cell] = label; }
    }
    if (cores.some((label) => !label)) continue;
    const owner = new Int8Array(width * height).fill(-1), queue = new Int32Array(width * height);
    let head = 0, tail = 0;
    for (let at = 0; at < labels.length; at += 1) {
      const frame = labels[at] ? cores.indexOf(labels[at]) : -1;
      if (frame >= 0) { owner[at] = frame; queue[tail++] = at; }
    }
    // A pixel joined to two poses goes to the one it is fewer steps from.
    while (head < tail) {
      const at = queue[head++], x = at % width, y = (at - x) / width;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (owner[next] < 0 && pixels[next * 4 + 3] > 0) { owner[next] = owner[at]; queue[tail++] = next; }
      }
    }
    // Loose specks, sparks and droplets stay with the cell they were drawn in.
    const loose = new Uint8Array(width * height);
    for (let at = 0; at < loose.length; at += 1) loose[at] = owner[at] < 0 && pixels[at * 4 + 3] > 0 ? 1 : 0;
    const parts = components(loose, width, height);
    const votes = Array.from({ length: parts.count + 1 }, () => new Float64Array(frames));
    for (let at = 0; at < loose.length; at += 1) if (parts.labels[at]) votes[parts.labels[at]][cellOf(at)] += 1;
    for (let at = 0; at < loose.length; at += 1) {
      const label = parts.labels[at];
      if (label) owner[at] = votes[label].indexOf(Math.max(...votes[label]));
    }
    return owner;
  }
  throw new Error("could not find one solid pose per cell");
}

let failed = false;
for (const [id, boss] of Object.entries(recipe.bosses)) {
  if (wanted.length && !wanted.includes(id)) continue;
  const { data, info } = await sharp(readSource(boss.source)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  if (boss.chroma) removeGreenPixels(pixels, boss.chroma[0], boss.chroma[1]);
  const cellWidth = width / boss.columns, cellHeight = height / boss.rows;
  if (!Number.isInteger(cellWidth) || !Number.isInteger(cellHeight)) throw new Error(`${id}: ${width} × ${height} does not split into ${boss.columns} × ${boss.rows}`);
  if (boss.shift.length !== boss.columns * boss.rows) throw new Error(`${id}: ${boss.shift.length} shifts for ${boss.columns * boss.rows} cells`);
  const owner = poseOwners(pixels, width, height, boss);
  const [padX, padY] = boss.pad;
  const outCellWidth = cellWidth + padX * 2, outCellHeight = cellHeight + padY * 2;
  const outWidth = outCellWidth * boss.columns, outHeight = outCellHeight * boss.rows;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  const bounds = boss.shift.map(() => ({ left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }));
  for (let at = 0; at < width * height; at += 1) {
    if (!pixels[at * 4 + 3]) continue;
    const frame = owner[at], [dx, dy] = boss.shift[frame];
    const x = at % width - (frame % boss.columns) * cellWidth + dx + padX;
    const y = Math.floor(at / width) - Math.floor(frame / boss.columns) * cellHeight + dy + padY;
    const box = bounds[frame];
    box.left = Math.min(box.left, x); box.right = Math.max(box.right, x); box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y);
    if (x < 0 || y < 0 || x >= outCellWidth || y >= outCellHeight) continue;
    const target = ((y + Math.floor(frame / boss.columns) * outCellHeight) * outWidth + x + (frame % boss.columns) * outCellWidth) * 4;
    out.set(pixels.subarray(at * 4, at * 4 + 4), target);
  }
  const margin = recipe.margin;
  const tight = bounds.map((box, frame) => ({ frame, ...box })).filter((box) => box.left < margin || box.top < margin
    || box.right >= outCellWidth - margin || box.bottom >= outCellHeight - margin);
  if (tight.length) {
    failed = true;
    for (const box of tight) console.error(`${id} frame ${box.frame}: pose spans x ${box.left}–${box.right}, y ${box.top}–${box.bottom} of a ${outCellWidth} × ${outCellHeight} cell`);
    // The smallest even padding that clears every pose by the margin.
    const need = (low, high, size, pad) => Math.max(0, ...bounds.map((box) => Math.max(margin - (box[low] - pad), box[high] - pad - size + 1 + margin)));
    const even = (value) => value + value % 2;
    console.error(`${id}: needs pad [${even(need("left", "right", cellWidth, padX))}, ${even(need("top", "bottom", cellHeight, padY))}]`);
    continue;
  }
  const target = join(root, recipe.folder, boss.output);
  await sharp(Buffer.from(out.buffer), { raw: { width: outWidth, height: outHeight, channels: 4 } })
    .webp({ quality: 95, alphaQuality: 100, effort: 6 }).toFile(target);
  console.log(`${id}: ${outWidth} × ${outHeight} (${boss.columns} × ${boss.rows} cells of ${outCellWidth} × ${outCellHeight}) -> ${target.slice(root.length + 1)}`);
}
if (failed) process.exit(1);
