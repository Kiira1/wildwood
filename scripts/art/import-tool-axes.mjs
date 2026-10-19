#!/usr/bin/env node
/**
 * The Hatchet's axes (src/game/runtime/town/hatchet-sprite.ts), from the vendor's Character Parts Pack: one design per
 * tool level, picked in scripts/art/tool-axes.json. Kept at the pack's size, encoded as the graded gear is
 * (import-grade-equipment.mjs).
 *
 *   node scripts/art/import-tool-axes.mjs ["<Parts Pack Vol.1 folder>"]
 *
 * The pack lives in the main checkout's art-source/vendor, which is not committed. Writes
 * public/assets/wildstat/tools/hatchet-<level>.webp.
 */
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const pack = resolve(process.argv[2] ?? join(root, "art-source/vendor/2D Minimal - Character Parts Pack Vol.1 [Expansion]/Parts Pack Vol.1"));
const parts = join(pack, "Parts");
if (!existsSync(parts)) { console.error(`No parts at ${parts}`); process.exit(1); }

const { hatchet } = JSON.parse(readFileSync(join(import.meta.dirname, "tool-axes.json"), "utf8"));
/** Every axe in the pack is this size; hatchet-sprite.ts holds them by one grip. */
const SIZE = { width: 108, height: 85 };
const folder = join(root, "public/assets/wildstat/tools");
mkdirSync(folder, { recursive: true });

for (const { level, source } of hatchet) {
  const file = join(parts, source);
  const { width, height } = await sharp(file).metadata();
  if (width !== SIZE.width || height !== SIZE.height) throw new Error(`${source} is ${width} × ${height}, not ${SIZE.width} × ${SIZE.height}`);
  const target = join(folder, `hatchet-${level}.webp`);
  await sharp(file).webp({ quality: 95, alphaQuality: 100, effort: 6 }).toFile(target);
  console.log(`${source} -> ${target.slice(root.length + 1)}`);
}
