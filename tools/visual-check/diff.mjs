#!/usr/bin/env node
// Compares two capture folders pixel by pixel. For each PNG in either folder it prints the changed-pixel count,
// writes <name>.diff.png (changes in magenta over a faded candidate) and <name>.side.png (baseline | candidate |
// diff), and exits 1 when any capture changes more than the threshold or is missing on one side.
//
//   node tools/visual-check/diff.mjs <baseline-dir> <candidate-dir> [--out <dir>] [--threshold 0] [--tolerance 0]
//     [--labels "old,new"] [--all-pictures]
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import sharp from "sharp";

function parseArgs(argv) {
  const args = { dirs: [], out: null, threshold: 0, tolerance: 0, labels: ["baseline", "candidate"], allPictures: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--out") args.out = resolve(argv[++index]);
    else if (flag === "--threshold") args.threshold = Number(argv[++index]);
    else if (flag === "--tolerance") args.tolerance = Number(argv[++index]);
    else if (flag === "--labels") args.labels = argv[++index].split(",");
    else if (flag === "--all-pictures") args.allPictures = true;
    else if (flag.startsWith("--")) throw new Error(`Unknown flag ${flag}`);
    else args.dirs.push(resolve(flag));
  }
  if (args.dirs.length !== 2) throw new Error("usage: node tools/visual-check/diff.mjs <baseline-dir> <candidate-dir> [--out <dir>] [--threshold <pixels>] [--tolerance <0-255>] [--labels a,b]");
  for (const dir of args.dirs) if (!existsSync(dir)) throw new Error(`No such folder: ${dir}`);
  args.out ??= join(args.dirs[1], "diff");
  return args;
}

const pngs = dir => readdirSync(dir).filter(name => name.endsWith(".png") && !name.endsWith(".diff.png") && !name.endsWith(".side.png"));

async function rgba(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** One image padded with transparent pixels to width × height. */
function padded(image, width, height) {
  if (image.width === width && image.height === height) return image.data;
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < image.height; y += 1) image.data.copy(out, y * width * 4, y * image.width * 4, (y + 1) * image.width * 4);
  return out;
}

/** Changed pixels, and a picture of them: the candidate faded to grey, changes in solid magenta. */
function compare(a, b, width, height, tolerance) {
  const left = padded(a, width, height), right = padded(b, width, height);
  const diff = Buffer.alloc(width * height * 4);
  let changed = 0;
  let box = null;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    let delta = 0;
    for (let channel = 0; channel < 4; channel += 1) delta = Math.max(delta, Math.abs(left[offset + channel] - right[offset + channel]));
    if (delta > tolerance) {
      changed += 1;
      diff[offset] = 255; diff[offset + 1] = 0; diff[offset + 2] = 255; diff[offset + 3] = 255;
      const x = pixel % width, y = Math.floor(pixel / width);
      box = box ? { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x), bottom: Math.max(box.bottom, y) } : { left: x, top: y, right: x, bottom: y };
    } else {
      const grey = Math.round((right[offset] * .3 + right[offset + 1] * .59 + right[offset + 2] * .11) * .35 + 255 * .65 * .25);
      diff[offset] = diff[offset + 1] = diff[offset + 2] = grey;
      diff[offset + 3] = 255;
    }
  }
  return { changed, diff, box };
}

const escapeXml = text => text.replace(/[<>&"]/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[char]);

function header(width, text) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28"><rect width="100%" height="100%" fill="#111"/><text x="8" y="19" font-family="Arial, sans-serif" font-size="15" font-weight="bold" fill="#fff">${escapeXml(text)}</text></svg>`);
}

/** Baseline, candidate and diff side by side, each under its label. */
async function sideBySide(panels, width, height, file) {
  const gap = 12, head = 28;
  const total = panels.length * width + (panels.length - 1) * gap;
  const layers = [];
  panels.forEach((panel, index) => {
    const left = index * (width + gap);
    layers.push({ input: header(width, panel.label), left, top: 0 });
    layers.push({ input: panel.data, raw: { width: panel.width, height: panel.height, channels: 4 }, left, top: head });
  });
  await sharp({ create: { width: total, height: height + head, channels: 4, background: { r: 40, g: 40, b: 40, alpha: 1 } } })
    .composite(layers).png().toFile(file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [baseDir, candidateDir] = args.dirs;
  mkdirSync(args.out, { recursive: true });
  const names = [...new Set([...pngs(baseDir), ...pngs(candidateDir)])].sort();
  let failing = 0;
  for (const name of names) {
    const baseFile = join(baseDir, name), candidateFile = join(candidateDir, name);
    if (!existsSync(baseFile) || !existsSync(candidateFile)) {
      failing += 1;
      console.log(`${name.padEnd(32)} MISSING in ${existsSync(baseFile) ? basename(candidateDir) : basename(baseDir)}`);
      continue;
    }
    const [a, b] = await Promise.all([rgba(baseFile), rgba(candidateFile)]);
    const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height);
    const { changed, diff, box } = compare(a, b, width, height, args.tolerance);
    const sizeNote = a.width !== b.width || a.height !== b.height ? `  size ${a.width}×${a.height} → ${b.width}×${b.height}` : "";
    const share = (changed / (width * height) * 100).toFixed(3);
    const over = changed > args.threshold || sizeNote !== "";
    if (over) failing += 1;
    const stem = name.replace(/\.png$/, "");
    const where = box ? `  in x ${box.left}-${box.right}, y ${box.top}-${box.bottom}` : "";
    console.log(`${name.padEnd(32)} ${over ? "CHANGED" : "same   "} ${String(changed).padStart(9)} px (${share}%)${sizeNote}${where}`);
    // Pictures only for what changed (or every capture with --all-pictures).
    if (!over && !args.allPictures) continue;
    await sharp(diff, { raw: { width, height, channels: 4 } }).png().toFile(join(args.out, `${stem}.diff.png`));
    await sideBySide([
      { label: `${args.labels[0]} · ${name}`, data: padded(a, width, height), width, height },
      { label: `${args.labels[1]} · ${name}`, data: padded(b, width, height), width, height },
      { label: `diff · ${changed} px`, data: diff, width, height },
    ], width, height, join(args.out, `${stem}.side.png`));
  }
  console.log(`${names.length} capture(s) compared, ${failing} over the threshold of ${args.threshold} px. Diffs in ${args.out}`);
  return failing ? 1 : 0;
}

main().then(code => process.exit(code), error => { console.error(error.message ?? error); process.exit(2); });
