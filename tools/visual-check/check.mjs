#!/usr/bin/env node
// Captures the checked scenes and compares them with this machine's baseline, pixel for pixel.
// The baseline lives in local-data/visual-check-baseline (gitignored: it depends on Chrome and the fonts).
// Exits 1 when any capture changed (diff pictures are written next to the run), 0 when all match.
//
//   npm run visual:check                    capture and compare
//   npm run visual:check -- --update        capture and make that the new baseline (creates it)
//   npm run visual:check -- --scenes gear   only these scenes (names from SCENES below)
//   [--no-build] [--port 4517] [--cdp-port 9351] [--tolerance 0]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const repo = resolve(import.meta.dirname, "../..");
const baselineDir = join(repo, "local-data/visual-check-baseline");
const runDir = join(repo, "local-data/visual-check-run");

/** Each checked scene at its one width and pixel ratio. */
const SCENES = [
  "plates:390@2", "gear:1280@1", "enemies:1280@1", "parts:1280@1", "combat-hits:390@2", "bosses:1280@1",
  "world:1280@1", "town:1280@1", "guild-battlefield:1280@1", "hud:390@1", "icons:390@1", "wordmark:390@1",
];

function parseArgs(argv) {
  const args = { update: false, scenes: null, passThrough: [], tolerance: "0" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--update") args.update = true;
    else if (flag === "--scenes") args.scenes = argv[++index].split(",").filter(Boolean);
    else if (flag === "--tolerance") args.tolerance = argv[++index];
    else if (flag === "--no-build") args.passThrough.push(flag);
    else if (flag === "--port" || flag === "--cdp-port") args.passThrough.push(flag, argv[++index]);
    else throw new Error(`Unknown flag ${flag}`);
  }
  return args;
}

const sceneName = spec => spec.split(/[:@]/)[0];
const stem = file => file.replace(/\.(png|webp)$/, "");

/** Stored losslessly as WebP (a third smaller than PNG); PNG past WebP's 16,383 pixel limit. */
async function store(png, dir) {
  const { width, height } = await sharp(png).metadata();
  const name = stem(png.split("/").pop());
  if (width <= 16_383 && height <= 16_383) {
    await sharp(png).webp({ lossless: true, exact: true, effort: 6 }).toFile(join(dir, `${name}.webp`));
    return `${name}.webp`;
  }
  await sharp(png).png({ compressionLevel: 9, effort: 10 }).toFile(join(dir, `${name}.png`));
  return `${name}.png`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const unknown = (args.scenes ?? []).filter(name => !SCENES.some(spec => sceneName(spec) === name));
  if (unknown.length) throw new Error(`Unknown scene(s) ${unknown.join(", ")}; checked: ${SCENES.map(sceneName).join(", ")}`);
  const specs = args.scenes ? SCENES.filter(spec => args.scenes.includes(sceneName(spec))) : SCENES;
  const captureDir = join(runDir, "capture");
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(captureDir, { recursive: true });
  const capture = spawnSync(process.execPath, [join(import.meta.dirname, "capture.mjs"), "--out", captureDir, "--scenes", specs.join(","), ...args.passThrough],
    { cwd: repo, stdio: "inherit" });
  if (capture.status !== 0) throw new Error("Capture failed; nothing compared");
  const captured = JSON.parse(readFileSync(join(captureDir, "manifest.json"), "utf8"));

  if (args.update) {
    mkdirSync(baselineDir, { recursive: true });
    const previous = existsSync(join(baselineDir, "manifest.json")) ? JSON.parse(readFileSync(join(baselineDir, "manifest.json"), "utf8")).captures : [];
    const kept = previous.filter(entry => !specs.some(spec => sceneName(spec) === entry.scene));
    const fresh = [];
    for (const entry of captured.captures) {
      for (const file of readdirSync(baselineDir).filter(file => stem(file) === stem(entry.file))) rmSync(join(baselineDir, file));
      fresh.push({ ...entry, file: await store(join(captureDir, entry.file), baselineDir), failures: undefined, missing: undefined });
    }
    const captures = [...kept, ...fresh].sort((a, b) => a.file.localeCompare(b.file));
    writeFileSync(join(baselineDir, "manifest.json"), `${JSON.stringify({ chrome: captured.chrome, captures }, null, 2)}\n`);
    console.log(`Baseline updated: ${fresh.length} capture(s) in ${baselineDir}`);
    return 0;
  }

  if (!existsSync(join(baselineDir, "manifest.json"))) throw new Error(`No baseline in ${baselineDir} yet; take one with --update (on the code before your change)`);
  const baseline = JSON.parse(readFileSync(join(baselineDir, "manifest.json"), "utf8"));
  if (baseline.chrome && captured.chrome && baseline.chrome !== captured.chrome) {
    console.warn(`Note: the baseline was taken with ${baseline.chrome}, this run with ${captured.chrome}; text and edges may differ by a pixel.`);
  }
  // The baseline decoded to PNG beside the run, so diff.mjs compares like with like.
  const expectedDir = join(runDir, "baseline");
  mkdirSync(expectedDir, { recursive: true });
  for (const entry of baseline.captures.filter(entry => specs.some(spec => sceneName(spec) === entry.scene))) {
    await sharp(join(baselineDir, entry.file)).png().toFile(join(expectedDir, `${stem(entry.file)}.png`));
  }
  const diff = spawnSync(process.execPath, [join(import.meta.dirname, "diff.mjs"), expectedDir, captureDir, "--out", join(runDir, "diff"),
    "--tolerance", args.tolerance, "--labels", "baseline,now"], { cwd: repo, stdio: "inherit" });
  if (diff.status !== 0) {
    console.error(`\nVisual check FAILED. Look at ${join(runDir, "diff")} (*.side.png: baseline | now | changes in magenta).`);
    console.error("If the change is intended, take a new baseline: npm run visual:check -- --update");
    return 1;
  }
  console.log("Visual check passed: every capture matches the baseline.");
  return 0;
}

main().then(code => process.exit(code), error => { console.error(error.message ?? error); process.exit(2); });
