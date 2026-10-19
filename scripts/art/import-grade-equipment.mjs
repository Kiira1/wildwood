#!/usr/bin/env node
/**
 * The graded gear (shared/grade-equipment.ts), from the vendor's Character Parts Pack: one design per piece, plain at
 * Crude and ornate at Eternal, and three looks of it, the base and the ★10 and ★20 refine looks, picked in
 * scripts/art/grade-equipment.json. A look is one of the design's own colours, or the part recoloured where the design
 * has none that fits (the manifest's "about"). Every part keeps the size its kind already has in the game, so each
 * piece is drawn as the map gear is; staffs are scaled once to the in-hand size as import-vendor-staffs.mjs does.
 * Encoded as the rest of the shipped artwork is (scripts/convert-png-to-webp.mjs).
 *
 *   node scripts/art/import-grade-equipment.mjs ["<Parts Pack Vol.1 folder>"]
 *
 * The pack lives in the main checkout's art-source/vendor, which is not committed. Writes
 * public/assets/wildstat/player-parts/<item id, dashed>.webp, and -r10.webp and -r20.webp beside it.
 */
import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const pack = resolve(process.argv[2] ?? join(root, "art-source/vendor/2D Minimal - Character Parts Pack Vol.1 [Expansion]/Parts Pack Vol.1"));
const parts = join(pack, "Parts");
if (!existsSync(parts)) { console.error(`No parts at ${parts}`); process.exit(1); }

const { pieces } = JSON.parse(readFileSync(join(import.meta.dirname, "grade-equipment.json"), "utf8"));

/** The pack's size for each kind of part, and the size it is drawn at when that differs. */
const SIZES = {
  "HandRight/Bow": { width: 130, height: 71 },
  "HandRight/Sword": { width: 118, height: 59 },
  "HandRight/Staff": { width: 68, height: 135, drawn: { width: 52, height: 104 } },
  Helmet: { width: 118, height: 106 },
  Chest: { width: 76, height: 68 },
};

/** A pixel's hue in degrees and saturation, 0 to 1. */
function hueAndSaturation(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), range = max - min;
  if (!range) return [0, 0];
  const hue = max === r ? ((g - b) / range + 6) % 6 : max === g ? (b - r) / range + 2 : (r - g) / range + 4;
  return [hue * 60, range / max];
}

/**
 * A part in a new colour: the part's main colour (its steel, or its cloth) is repainted, each pixel's lightness picking
 * a shade from a deep shadow through the colour to a pale highlight, so it keeps its shading. Its other colours, a
 * plume or a gem or trim, and the black outline stay as they are.
 */
async function tinted(source, hex) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colour = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
  const shadow = colour.map(c => c * .3), highlight = colour.map(c => c + (255 - c) * .5);
  const lightness = i => (data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114) / 255;
  // The main colour: grey when most of the part is unsaturated, else the most common hue in twelve bins.
  const bins = new Array(13).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128 || lightness(i) < .13) continue;
    const [hue, saturation] = hueAndSaturation(data[i], data[i + 1], data[i + 2]);
    bins[saturation < .22 ? 12 : Math.floor(hue / 30) % 12] += 1;
  }
  const main = bins.indexOf(Math.max(...bins));
  const repainted = (hue, saturation) => main === 12 ? saturation < .22
    : saturation >= .15 && [11, 0, 1].some(step => Math.floor(hue / 30) % 12 === (main + step) % 12);
  for (let i = 0; i < data.length; i += 4) {
    const light = lightness(i);
    if (light < .13 || !repainted(...hueAndSaturation(data[i], data[i + 1], data[i + 2]))) continue;
    const t = Math.min(1, .08 + light * .95);
    const [from, to, f] = t < .5 ? [shadow, colour, t / .5] : [colour, highlight, (t - .5) / .5];
    for (let c = 0; c < 3; c += 1) data[i + c] = Math.round(from[c] + (to[c] - from[c]) * f);
  }
  return sharp(data, { raw: info });
}

/** A part with its hue turned, except gold and yellow pixels, so gold trim stays gold. */
async function turnKeepingGold(source, hue) {
  const original = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const turned = await sharp(source).modulate({ hue }).ensureAlpha().raw().toBuffer();
  const { data, info } = original;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const gold = max - min > 40 && r >= g && g > b && (g - b) / (max - min) > .45;
    if (!gold) for (let c = 0; c < 3; c += 1) data[i + c] = turned[i + c];
  }
  return sharp(data, { raw: info });
}

/** Each look's file suffix. */
const LOOKS = { base: "", r10: "-r10", r20: "-r20" };

for (const [id, entry] of Object.entries(pieces)) {
  for (const [key, suffix] of Object.entries(LOOKS)) {
    const look = typeof entry[key] === "string" ? { source: entry[key] } : entry[key];
    if (!look?.source) throw new Error(`${id}: no ${key} look`);
    const folder = look.source.slice(0, look.source.lastIndexOf("/"));
    const size = SIZES[folder];
    if (!size) throw new Error(`${id}: no size for ${folder}`);
    const source = join(parts, look.source);
    const target = join(root, "public/assets/wildstat/player-parts", `${id.replace(/_/g, "-")}${suffix}.webp`);
    const { width, height } = await sharp(source).metadata();
    if (width !== size.width || height !== size.height) throw new Error(`${look.source} is ${width} × ${height}, not ${size.width} × ${size.height}`);
    let image = sharp(source);
    if (look.tint) image = await tinted(source, look.tint);
    if (look.hue) image = look.keepGold ? await turnKeepingGold(source, look.hue) : image.modulate({ hue: look.hue });
    if (size.drawn) image = sharp(await image.png().toBuffer()).resize(size.drawn.width, size.drawn.height, { fit: "fill", kernel: "lanczos3" });
    await image.webp({ quality: 95, alphaQuality: 100, effort: 6 }).toFile(target);
    console.log(`${look.source}${look.tint ? ` tint ${look.tint}` : ""}${look.hue ? ` hue ${look.hue}` : ""} -> ${target.slice(root.length + 1)}`);
  }
}
