import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const nextVersion = process.argv[2];
const checkOnly = process.argv.includes("--check");

if ((checkOnly && process.argv.length !== 3) || (!checkOnly && !/^\d+(?:\.\d+)+$/.test(nextVersion ?? ""))) {
  console.error("Usage: npm run release -- <version> | npm run check:release");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const settingsPath = resolve(root, "src/game/runtime/game-settings.ts");
const htmlPath = resolve(root, "public/index.html");
const versionPath = resolve(root, "public/version.json");
const changelogPath = resolve(root, "src/app/changelog.ts");

const [settings, html, versionJson, changelog] = await Promise.all([
  readFile(settingsPath, "utf8"),
  readFile(htmlPath, "utf8"),
  readFile(versionPath, "utf8"),
  readFile(changelogPath, "utf8"),
]);

const currentMatch = settings.match(/const GAME_VERSION = "([^"]+)";/);
if (!currentMatch) throw new Error("GAME_VERSION was not found in src/game/runtime/game-settings.ts");
const currentVersion = currentMatch[1];
const staticVersion = JSON.parse(versionJson).version;
const htmlVersions = [...html.matchAll(/(?:v|\?v=)(\d+(?:\.\d+)+)/g)].map((match) => match[1]);

if (checkOnly) {
  if (staticVersion !== currentVersion || htmlVersions.some((value) => value !== currentVersion)) {
    throw new Error(`Release version mismatch: settings=${currentVersion}, version.json=${staticVersion}, index.html=${[...new Set(htmlVersions)].join(",")}`);
  }
  if (!changelog.split("export const RELEASE_DAYS")[1]?.includes(`"${currentVersion}": "`)) {
    throw new Error(`Missing release day for ${currentVersion}`);
  }
  process.exit(0);
}

const nextSettings = settings.replace(`const GAME_VERSION = "${currentVersion}";`, `const GAME_VERSION = "${nextVersion}";`);
const nextHtml = html
  .replaceAll(`v${currentVersion}`, `v${nextVersion}`)
  .replaceAll(`?v=${currentVersion}`, `?v=${nextVersion}`);
const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
}).formatToParts(new Date());
const releaseDay = ["year", "month", "day"].map(type => dateParts.find(part => part.type === type).value).join("-");
const daysHeading = "export const RELEASE_DAYS: Record<string, string> = {";
if (!changelog.includes(daysHeading)) throw new Error("Release-day registry was not found.");
const nextChangelog = changelog.split(daysHeading)[1].includes(`"${nextVersion}": "`)
  ? changelog : changelog.replace(daysHeading, `${daysHeading}\n  "${nextVersion}": "${releaseDay}",`);

await Promise.all([
  writeFile(settingsPath, nextSettings),
  writeFile(htmlPath, nextHtml),
  writeFile(versionPath, `${JSON.stringify({ version: nextVersion })}\n`),
  writeFile(changelogPath, nextChangelog),
]);

console.log(`Release version updated: ${currentVersion} → ${nextVersion}`);
console.log("Add release notes for the new version in src/app/changelog.ts before committing.");
