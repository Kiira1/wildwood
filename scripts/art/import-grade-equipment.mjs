#!/usr/bin/env node
/**
 * The graded gear (shared/grade-equipment.ts), from the vendor's Character Parts Pack: one unused part per piece,
 * plain at Common and ornate at Mythic, picked in scripts/art/grade-equipment.json. Every part keeps the size its
 * kind already has in the game, so each piece is drawn as the map gear is; staffs are scaled once to the in-hand
 * size as import-vendor-staffs.mjs does. Encoded as the rest of the shipped artwork is (scripts/convert-png-to-webp.mjs).
 *
 *   node scripts/art/import-grade-equipment.mjs ["<Parts Pack Vol.1 folder>"]
 *
 * The pack lives in the main checkout's art-source/vendor, which is not committed. Writes
 * public/assets/wildstat/player-parts/<item id, dashed>.webp.
 */
import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const pack = resolve(process.argv[2] ?? join(root, "art-source/vendor/2D Minimal - Character Parts Pack Vol.1 [Expansion]/Parts Pack Vol.1"));
const parts = join(pack, "Parts");
if (!existsSync(parts)) { console.error(`No parts at ${parts}`); process.exit(1); }

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "grade-equipment.json"), "utf8"));

/** The pack's size for each kind of part, and the size it is drawn at when that differs. */
const SIZES = {
  "HandRight/Bow": { width: 130, height: 71 },
  "HandRight/Sword": { width: 118, height: 59 },
  "HandRight/Staff": { width: 68, height: 135, drawn: { width: 52, height: 104 } },
  Helmet: { width: 118, height: 106 },
  Chest: { width: 76, height: 68 },
};

for (const [id, { source: part }] of Object.entries(manifest)) {
  const folder = part.slice(0, part.lastIndexOf("/"));
  const size = SIZES[folder];
  if (!size) throw new Error(`${id}: no size for ${folder}`);
  const source = join(parts, part);
  const target = join(root, "public/assets/wildstat/player-parts", `${id.replace(/_/g, "-")}.webp`);
  const { width, height } = await sharp(source).metadata();
  if (width !== size.width || height !== size.height) throw new Error(`${part} is ${width} × ${height}, not ${size.width} × ${size.height}`);
  const image = size.drawn ? sharp(source).resize(size.drawn.width, size.drawn.height, { fit: "fill", kernel: "lanczos3" }) : sharp(source);
  await image.webp({ quality: 95, alphaQuality: 100, effort: 6 }).toFile(target);
  console.log(`${part} -> ${target.slice(root.length + 1)}`);
}
