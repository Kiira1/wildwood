#!/usr/bin/env node
/**
 * Convert shipped PNG artwork to WebP at the same settings the enemy sprite
 * importer uses. Run with --apply to write; without it, only reports.
 */
import sharp from "sharp";
import { readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";

// Install icons and favicons stay PNG: the web manifest and the Apple touch
// icon have consumers outside the game that do not all accept WebP.
const KEEP_PNG = /app-icon|favicon|apple-touch/i;
const apply = process.argv.includes("--apply");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith(".webp")) out.push(path);
  }
  return out;
}

const all = walk("public");
const convert = all.filter(path => !KEEP_PNG.test(path));
const kept = all.filter(path => KEEP_PNG.test(path));
console.log(`png files: ${all.length}  converting: ${convert.length}  keeping as png: ${kept.length}`);
for (const path of kept) console.log("  keep:", relative("public", path));

let before = 0, after = 0;
for (const path of convert) {
  before += statSync(path).size;
  const encoded = await sharp(path).webp({ quality: 95, alphaQuality: 100, effort: 6 }).toBuffer();
  after += encoded.length;
  if (apply) { writeFileSync(path.replace(/\.webp$/, ".webp"), encoded); unlinkSync(path); }
}
const saved = Math.round((before - after) / 1024 / 1024 * 10) / 10;
console.log(`\n${apply ? "CONVERTED" : "DRY RUN"}  ${Math.round(before / 1024)}KB -> ${Math.round(after / 1024)}KB (${Math.round((1 - after / before) * 100)}% smaller, saves ${saved}MB)`);
