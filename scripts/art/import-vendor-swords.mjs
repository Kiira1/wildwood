#!/usr/bin/env node
/**
 * The tier swords, from the vendor's Character Parts Pack (the one the Wooden Sword, its Sword 025 Brown, came from):
 * one of its swords for each map past the forest, chosen by that map's colours, at the 118 × 59 size every
 * sword in the pack shares, so each is held and swings exactly as the Wooden Sword does. Encoded as the rest of the
 * shipped artwork is (scripts/convert-png-to-webp.mjs).
 *
 *   node scripts/art/import-vendor-swords.mjs ["<Parts Pack Vol.1 folder>"]
 *
 * The pack lives in the main checkout's art-source/vendor, which is not committed. Writes
 * public/assets/wildstat/player-parts/<sword id, dashed>.webp.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const pack = resolve(process.argv[2] ?? join(root, "art-source/vendor/2D Minimal - Character Parts Pack Vol.1 [Expansion]/Parts Pack Vol.1"));
const swords = join(pack, "Parts/HandRight/Sword");
if (!existsSync(swords)) { console.error(`No swords at ${swords}`); process.exit(1); }

/** Each tier's sword: the pack's sword in the colours of its map (and of that map's bow). */
const TIER_SWORDS = {
  iron_sword: "022_DarkGary", // Beginner Desert: plain grey iron.
  snow_sword: "029_BlueGray", // Intermediate Snowlands: cold steel.
  lava_sword: "031_Red", // Advanced Lava Lake: a red, fanged blade.
  night_sword: "020_Black", // Night Forest: violet and black crystal.
  sky_sword: "033_Blue", // Water Reach: a blue blade like a wave.
  samurai_sword: "023_Red", // Samurai Garden: a long curved red blade.
  cloudspire_sword: "021_YellowGray", // Cloudspire: cream and pale gold.
  moonfen_sword: "033_Green", // Moonfen: marsh green.
  crystal_sword: "020_Blue", // Crystal Hollows: cyan crystal.
  clockwork_sword: "030_Yellow", // Clockwork Ruins: brass, shaped like a spanner.
  duskfall_sword: "031_Gold", // Duskfall Orchard: dusk orange.
  neon_sword: "023_Purple", // Neon Bastion: a long purple arc.
  verdant_sword: "028_DarkGreen", // Verdant Catacombs: dark, with green teeth.
  ion_sword: "021_Gold", // Ion Citadel: sovereign gold.
};

for (const [id, art] of Object.entries(TIER_SWORDS)) {
  const source = join(swords, `FA_WP_Main_Sword_${art}.png`);
  const target = join(root, "public/assets/wildstat/player-parts", `${id.replace(/_/g, "-")}.webp`);
  const { width, height } = await sharp(source).metadata();
  if (width !== 118 || height !== 59) throw new Error(`${art} is ${width} × ${height}, not the Wooden Sword's 118 × 59`);
  await sharp(source).webp({ quality: 95, alphaQuality: 100, effort: 6 }).toFile(target);
  console.log(`${art} -> ${target.slice(root.length + 1)}`);
}
