#!/usr/bin/env node
/**
 * The graded boots (shared/grade-equipment.ts): there is no vendor boot art, so each pair is the game's own boot
 * legs (player-parts/boots-leg-front.webp and -back.webp) recoloured, its leather in the piece's fill and trim, cuff,
 * sole, straps, studs and a gem added as the grade rises, each from scripts/art/grade-boots.json. Three looks of each,
 * as the other graded gear has: the base, ★10 in gold and ★20 in its style's jewel. A bag icon of both legs beside
 * each other goes with every look. Pixel art, so written lossless and scaled without smoothing.
 *
 *   node scripts/art/import-grade-boots.mjs
 *
 * Writes public/assets/wildstat/player-parts/<item id, dashed>-leg-front.webp, -leg-back.webp and the icon
 * <item id, dashed>.webp, and the -r10 and -r20 of each.
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const parts = join(root, "public/assets/wildstat/player-parts");
const { pieces } = JSON.parse(readFileSync(join(import.meta.dirname, "grade-boots.json"), "utf8"));

const GOLD = { cuff: "#e3b24a", strap: "#c8952e", sole: "#7a5512", stud: "#fff0b0" };
/** The bag icon: the back leg, then the front one down and to the right of it, four times the size. */
const ICON = { width: 38, height: 26, front: { left: 16, top: 6 }, scale: 4 };

const rgb = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const lightness = (data, i) => (data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114) / 255;

async function load(file) {
  const { data, info } = await sharp(join(parts, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

/** The leg's leather: every opaque pixel lighter than the outline, by row, and how light the leather is at its middle. */
function leather({ data, info }) {
  const rows = new Map(), lights = [];
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3] < 128 || lightness(data, i) < .13) continue;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(x);
    lights.push(lightness(data, i));
  }
  lights.sort((a, b) => a - b);
  return { rows, top: Math.min(...rows.keys()), bottom: Math.max(...rows.keys()), middle: lights[lights.length >> 1] };
}

/** One leg in one look: the leather repainted with its shading kept, then each detail painted over it. */
function paint(source, piece, look, gradeIndex) {
  const data = Buffer.from(source.data), { width } = source.info, region = leather(source);
  const gold = look !== "base", jewel = look === "r20";
  const details = new Set(piece.details);
  // Gold looks always have a cuff and a strap to gild.
  if (gold) { details.add("cuff"); details.add("strap"); }
  const fill = jewel ? mix(mix(rgb(piece.jewel), [0, 0, 0], .45), mix(rgb(piece.jewel), [255, 255, 255], .25), gradeIndex / 14) : rgb(piece.fill);
  const cuff = rgb(gold ? GOLD.cuff : piece.trim), strap = rgb(gold ? GOLD.strap : piece.strap), sole = rgb(gold ? GOLD.sole : piece.strap);
  const stud = gold ? rgb(GOLD.stud) : mix(rgb(piece.trim), [255, 255, 255], .5);
  const set = (x, y, colour) => {
    const i = (y * width + x) * 4, shade = Math.min(1.15, lightness(source.data, i) / region.middle);
    for (let c = 0; c < 3; c += 1) data[i + c] = Math.max(0, Math.min(255, Math.round(colour[c] * shade)));
  };
  const top = region.top;
  const band = row => ({ cuff: row <= top + 1, strap: row === top + 5 || (details.has("strap2") && row === top + 8), sole: row >= region.bottom - 1 });
  for (const [y, xs] of region.rows) {
    const at = band(y);
    xs.forEach((x, index) => {
      let colour = fill;
      if (details.has("sheen") && index === 0) colour = mix(fill, [255, 255, 255], .35);
      if (details.has("cuff") && at.cuff) colour = cuff;
      if (details.has("sole") && at.sole) colour = sole;
      if (details.has("strap") && at.strap) colour = details.has("studs") && index % 2 === 1 ? stud : strap;
      set(x, y, colour);
    });
  }
  if (details.has("gem")) {
    const xs = region.rows.get(top + 1) ?? region.rows.get(top);
    set(xs[xs.length >> 1], region.rows.has(top + 1) ? top + 1 : top, jewel ? [255, 246, 208] : rgb(piece.jewel));
  }
  if (details.has("glow")) {
    // The outline's inner ring takes some of the fill, as if the leather shone through.
    const inner = new Set([...region.rows].flatMap(([y, xs]) => xs.map(x => y * width + x)));
    for (let p = 0; p < data.length / 4; p += 1) {
      if (inner.has(p) || source.data[p * 4 + 3] < 128) continue;
      const x = p % width, y = Math.floor(p / width);
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inner.has((y + dy) * width + x + dx))) continue;
      for (let c = 0; c < 3; c += 1) data[p * 4 + c] = Math.round(fill[c] * .45);
    }
  }
  return { data, info: source.info };
}

const webp = (image, scale = 1) => {
  const out = sharp(image.data, { raw: image.info });
  return (scale > 1 ? out.resize(image.info.width * scale, image.info.height * scale, { kernel: "nearest" }) : out)
    .webp({ lossless: true, effort: 6 });
};

const front = await load("boots-leg-front.webp"), back = await load("boots-leg-back.webp");
const LOOKS = { base: "", r10: "-r10", r20: "-r20" };
const ids = Object.keys(pieces);
for (const [id, piece] of Object.entries(pieces)) {
  const gradeIndex = ids.filter(other => other.endsWith(id.slice(id.indexOf("_")))).indexOf(id);
  const name = id.replace(/_/g, "-");
  for (const [look, suffix] of Object.entries(LOOKS)) {
    const legs = { front: paint(front, piece, look, gradeIndex), back: paint(back, piece, look, gradeIndex) };
    await webp(legs.front).toFile(join(parts, `${name}-leg-front${suffix}.webp`));
    await webp(legs.back).toFile(join(parts, `${name}-leg-back${suffix}.webp`));
    const icon = await sharp({ create: { width: ICON.width, height: ICON.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: legs.back.data, raw: legs.back.info, left: 0, top: 0 },
        { input: legs.front.data, raw: legs.front.info, left: ICON.front.left, top: ICON.front.top },
      ]).raw().toBuffer({ resolveWithObject: true });
    await webp(icon, ICON.scale).toFile(join(parts, `${name}${suffix}.webp`));
  }
  console.log(`${id}: ${piece.look}`);
}
