#!/usr/bin/env node
/**
 * The wizard staffs, from the vendor's Character Parts Pack (the one the swords came from): one of its fifteen staff
 * designs per map, in order, each in a colour that climbs from plain wood to gold, purple and dark, and the plainest
 * stick for the Smith's Starter Staff. Every staff is 68 × 135 in the pack; each is scaled once to STAFF_SIZE, the
 * size the player renderer draws in hand (src/game/campaign-item-presentation.ts), so none is resized while drawn.
 * Encoded as the rest of the shipped artwork is (scripts/convert-png-to-webp.mjs).
 *
 *   node scripts/art/import-vendor-staffs.mjs ["<Parts Pack Vol.1 folder>"]
 *
 * The pack lives in the main checkout's art-source/vendor, which is not committed. Writes
 * public/assets/wildstat/player-parts/<staff id, dashed>.webp.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const pack = resolve(process.argv[2] ?? join(root, "art-source/vendor/2D Minimal - Character Parts Pack Vol.1 [Expansion]/Parts Pack Vol.1"));
const staffs = join(pack, "Parts/HandRight/Staff");
if (!existsSync(staffs)) { console.error(`No staffs at ${staffs}`); process.exit(1); }

/** The in-hand size: the pack's 68 × 135 at about three quarters, a little taller than the character's body. */
const STAFF_SIZE = { width: 52, height: 104 };

/** Each staff: the pack's design for its tier, in the colours of its map. */
const STAFFS = {
  starter_staff: "011_Wood", // The Smith's: a plain stick.
  forest_staff: "011_Brown", // Tutorial Forest: the same stick, bound in teal.
  desert_staff: "012_Wood", // Beginner Desert: a dry branch.
  snow_staff: "013_Brown", // Intermediate Snowlands: a twisted stick with cold blue bands.
  lava_staff: "014_Gold", // Advanced Lava Lake: a fire-red eye in an orange crook.
  night_staff: "015_Purple", // Night Forest: a violet twist.
  sky_staff: "016_DarkBlue", // Water Reach: a blue orb.
  samurai_staff: "017_DarkRed", // Samurai Garden: a red crystal.
  cloudspire_staff: "018_DarkGold", // Cloudspire: a gold crescent.
  moonfen_staff: "019_White", // Moonfen: pale moonlight.
  crystal_staff: "020_Purple", // Crystal Hollows: a cyan crystal on purple.
  clockwork_staff: "021_Gold", // Clockwork Ruins: a brass gear.
  duskfall_staff: "022_WhitePink", // Duskfall Orchard: a dusk-pink star.
  neon_staff: "023_DarkMint", // Neon Bastion: a mint light on dark horns.
  verdant_staff: "024_Gray", // Verdant Catacombs: bone grey.
  ion_staff: "025_DarPurple", // Ion Citadel: a dark purple skull.
};

for (const [id, art] of Object.entries(STAFFS)) {
  const source = join(staffs, `FA_WP_Main_Staff_${art}.png`);
  const target = join(root, "public/assets/wildstat/player-parts", `${id.replace(/_/g, "-")}.webp`);
  const { width, height } = await sharp(source).metadata();
  if (width !== 68 || height !== 135) throw new Error(`${art} is ${width} × ${height}, not the pack's 68 × 135`);
  await sharp(source).resize(STAFF_SIZE.width, STAFF_SIZE.height, { fit: "fill", kernel: "lanczos3" })
    .webp({ quality: 95, alphaQuality: 100, effort: 6 }).toFile(target);
  console.log(`${art} -> ${target.slice(root.length + 1)}`);
}
