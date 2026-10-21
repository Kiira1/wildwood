#!/usr/bin/env node
/**
 * Ships main: the client (push, then GitHub Actions deploys both sites and the
 * Android feed) and the server (publish), in the order that keeps players playing.
 *
 *   npm run ship                          checks, then ships whatever main has that is not live
 *   npm run ship -- --dry-run             says what it would do, ships nothing
 *   npm run ship -- --allow-client-break  agrees to a server change that reconnects every player
 *   npm run ship -- --no-announce         ships without telling open tabs to reload
 *
 * The order:
 * - A compatible server change goes first, then the client: a new client may
 *   need what only the new server has, and old clients work on a new server.
 * - A server change that breaks clients goes last: the client is pushed and
 *   this waits until both sites serve it, then publishes. Open tabs play on the
 *   old server meanwhile, and the publish sends everyone straight to a client
 *   that is already live (a refused tab looks for a new build every 5 seconds).
 *   Published first, every player would wait out the whole deploy.
 *
 * Once a new client is live, open tabs are told so (announce_client_update):
 * they save, reload onto it and pick Auto Farm back up. A tab otherwise waits
 * for its next version check, and a hidden one never checks.
 *
 * Nothing ships until the checks pass: check:release (it includes the
 * code-health ratchets), both typechecks, the server bindings against a fresh
 * generate, and the unit tests (--quick leaves those to GitHub Actions).
 *
 * Nor while the live balance is not the repo's (balanceVerdict): there is one
 * balance, the one in code, and a control changed live in the Balance Lab is
 * copied into the repo (npm run balance:adopt) before anything else ships.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
/** Files compiled into the server module, as publish-server-live.mjs counts them. */
export const SERVER_INPUTS = ["spacetimedb", "shared"];
const SITES = ["https://wildstatmmo.com/version.json", "https://tydoskus.github.io/wildwood/version.json"];
const ANDROID_FEED = "https://wildstatmmo.com/ota/production-android.json";

/**
 * What to ship and in which order. `server` is "none", "compatible" or "breaking".
 * Returns the steps, or a refusal that ships nothing.
 */
export function planShip({ clientAhead, server, allowClientBreak, announce = true }) {
  if (server === "breaking" && !allowClientBreak) {
    return { refuse: "The server change reconnects every player. Run again with --allow-client-break to ship it (the client goes first, so it takes seconds)." };
  }
  const steps = [];
  if (server === "compatible") steps.push("publish");
  if (clientAhead) steps.push("push");
  // A breaking publish waits for the live client even when it was pushed already (the post-commit hook pushes main).
  if (clientAhead || server === "breaking") steps.push("wait-for-deploy");
  if (server === "breaking") steps.push("publish-breaking");
  if (clientAhead && announce) steps.push("announce");
  if (!steps.length) return { refuse: "Nothing to ship: origin/main has every commit and the server is published from this one." };
  return { steps };
}

/**
 * Whether the live balance lets this ship go ahead: it is the repo's, or it is from before the balance curve and
 * this ship publishes the server, whose migration puts the repo's on. Otherwise the refusal says how to fix it.
 */
export function balanceVerdict({ revision, onCurve, matches, differences = [] }, server) {
  if (matches) return { ok: `live balance (revision ${revision}) is the repo's` };
  if (!onCurve && server !== "none") return { ok: `live balance (revision ${revision}) is replaced by the repo's on publish` };
  return { refuse: `The live balance (revision ${revision}) is not the repo's: ${differences.slice(0, 4).join(", ")}${differences.length > 4 ? ", …" : ""}. `
    + "If that was a change in the Balance Lab, copy it into the repo with npm run balance:adopt and commit it; otherwise set the Lab back to the repo's balance." };
}

function run(command, args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed${capture ? `:\n${(result.stdout + result.stderr).trim().split("\n").slice(-15).join("\n")}` : "."}`);
  }
  return capture ? { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() } : { ok: result.status === 0, output: "" };
}
const git = (...args) => run("git", args, { capture: true }).output;

/** Runs commands side by side; prints each one's result as it finishes. */
async function parallel(tasks) {
  const results = await Promise.all(tasks.map(([label, command, args]) => new Promise(done => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.on("close", code => {
      console.log(`  ${code === 0 ? "✓" : "✗"} ${label}`);
      done({ label, ok: code === 0, output });
    });
  })));
  const failed = results.filter(result => !result.ok);
  for (const { label, output } of failed) console.error(`\n--- ${label} ---\n${output.trim().split("\n").slice(-25).join("\n")}`);
  if (failed.length) throw new Error(`Checks failed: ${failed.map(result => result.label).join(", ")}. Nothing was shipped.`);
}

async function bindingsMatch() {
  const dir = await mkdtemp(join(tmpdir(), "wildstat-bindings-"));
  try {
    run("spacetime", ["generate", "--lang", "typescript", "--out-dir", dir, "--module-path", "spacetimedb", "-y"], { capture: true });
    const diff = run("diff", ["-r", dir, "src/module_bindings"], { capture: true, allowFailure: true });
    if (!diff.ok) throw new Error(`src/module_bindings does not match the server (run npm run spacetime:generate):\n${diff.output.split("\n").slice(0, 10).join("\n")}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** The last commit the server was published from, if this checkout published it. */
async function publishedServerCommit() {
  try {
    return JSON.parse(await readFile(resolve(root, "local-data/releases/latest-server-release.json"), "utf8")).commit ?? null;
  } catch { return null; }
}

async function serverChange(head, offMain) {
  const published = await publishedServerCommit();
  const known = published && run("git", ["cat-file", "-e", `${published}^{commit}`], { capture: true, allowFailure: true }).ok;
  if (known && run("git", ["diff", "--quiet", published, head, "--", ...SERVER_INPUTS], { capture: true, allowFailure: true }).ok) return "none";
  // Asks Maincloud whether this module would disconnect everyone; publishes nothing.
  const preflight = run("node", ["scripts/publish-server-live.mjs", "--preflight", ...(offMain ? ["--allow-unreleased"] : [])], { capture: true, allowFailure: true });
  if (preflight.ok) return "compatible";
  if (/client-compatibility release/.test(preflight.output)) return "breaking";
  throw new Error(`The server preflight failed:\n${preflight.output.split("\n").slice(-10).join("\n")}`);
}

async function liveVersion(url) {
  try {
    const response = await fetch(`${url}?ship=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return response.ok ? (await response.json()).version ?? null : null;
  } catch { return null; }
}

async function waitForDeploy(sha, version) {
  console.log("Waiting for GitHub Actions to deploy...");
  let runId = null;
  for (let tries = 0; !runId && tries < 30; tries++) {
    const runs = JSON.parse(run("gh", ["run", "list", "--workflow", "pages.yml", "--commit", sha, "--json", "databaseId", "--limit", "1"], { capture: true }).output || "[]");
    runId = runs[0]?.databaseId ?? null;
    if (!runId) await new Promise(done => setTimeout(done, 4_000));
  }
  if (!runId) throw new Error("No deploy run started for this push. Check GitHub Actions.");
  if (!run("gh", ["run", "watch", String(runId), "--exit-status", "--interval", "5"], { allowFailure: true }).ok) {
    throw new Error(`The deploy failed: gh run view ${runId} --log-failed`);
  }
  for (const url of SITES) {
    const deadline = Date.now() + 3 * 60_000;
    while (await liveVersion(url) !== version) {
      if (Date.now() > deadline) throw new Error(`${new URL(url).host} is not serving v${version} yet.`);
      await new Promise(done => setTimeout(done, 3_000));
    }
    console.log(`  ✓ ${new URL(url).host} serves v${version}`);
  }
  try {
    const feed = JSON.parse((await (await fetch(`${ANDROID_FEED}?ship=${Date.now()}`, { cache: "no-store" })).json()).payload);
    console.log(`  Android update feed: ${feed.bundle?.id ?? "unknown"}`);
  } catch { console.log("  Android update feed: not read"); }
}

/** Tells every open tab that v`version` is live; see announceClientUpdate in spacetimedb/src/release-control.ts. */
async function announceClientUpdate(version) {
  const call = step => run("spacetime", ["call", "wildwood-coop", "announce_client_update", JSON.stringify(version), JSON.stringify(step),
    "--server", "maincloud"], { capture: true });
  call("start");
  // Long enough for a visible tab's quarter-second check to see the update begin.
  await new Promise(done => setTimeout(done, 3_000));
  call("finish");
  console.log(`  ✓ open tabs told to reload onto v${version}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run"), quick = args.includes("--quick"), allowClientBreak = args.includes("--allow-client-break");
  const announce = !args.includes("--no-announce");
  // A dry run may look at a branch; only main ships.
  const offMain = git("branch", "--show-current") !== "main";
  if (offMain && !dryRun) throw new Error("Ship from main.");
  const dirty = git("status", "--porcelain", "--", ...SERVER_INPUTS, "src/module_bindings", "src/app", "public/version.json");
  if (dirty) throw new Error(`Uncommitted changes would ship:\n${dirty}`);
  git("fetch", "origin", "main");
  const [ahead, behind] = git("rev-list", "--left-right", "--count", "HEAD...origin/main").split(/\s+/).map(Number);
  if (behind) throw new Error("origin/main has commits this checkout lacks. Pull first.");
  const head = git("rev-parse", "HEAD");
  const version = JSON.parse(await readFile(resolve(root, "public/version.json"), "utf8")).version;

  console.log(`Checking v${version} (${head.slice(0, 8)})...`);
  await parallel([
    ["release files", "npm", ["run", "--silent", "check:release"]],
    ["client typecheck", "npm", ["run", "--silent", "typecheck:coop"]],
    ["server typecheck", "npm", ["run", "--silent", "typecheck:server"]],
    ...(quick ? [] : [["unit tests", "npm", ["run", "--silent", "test:unit"]]]),
  ]);
  await bindingsMatch();
  console.log("  ✓ server bindings");

  const server = await serverChange(head, offMain);
  // The CLI's own warnings come out beside it; the check's answer is its one JSON line.
  const checked = run("npx", ["tsx", "scripts/balance-check.ts"], { capture: true }).output.split("\n").find(line => line.startsWith("{"));
  if (!checked) throw new Error("The live balance check gave no answer.");
  const verdict = balanceVerdict(JSON.parse(checked), server);
  if (verdict.refuse) throw new Error(verdict.refuse);
  console.log(`  ✓ ${verdict.ok}`);
  const plan = planShip({ clientAhead: ahead > 0, server, allowClientBreak, announce });
  if (plan.refuse) throw new Error(plan.refuse);
  console.log(`Plan: ${plan.steps.join(" → ")} (client ${ahead ? `${ahead} commit(s) ahead` : "already pushed"}, server ${server})`);
  if (dryRun) return;

  for (const step of plan.steps) {
    if (step === "publish") run("node", ["scripts/publish-server-live.mjs"]);
    if (step === "push") run("git", ["push", "origin", "main"]);
    if (step === "wait-for-deploy") await waitForDeploy(head, version);
    if (step === "publish-breaking") run("node", ["scripts/publish-server-live.mjs", "--allow-client-break"]);
    if (step === "announce") await announceClientUpdate(version);
  }
  console.log(`Shipped v${version}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`\nShip stopped: ${error.message}`); process.exitCode = 1; });
}
