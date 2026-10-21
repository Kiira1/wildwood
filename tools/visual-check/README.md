# Visual check

Screenshots of the game's own renderers, drawn from fake in-memory state: no game server, no login,
no network beyond the art in `public/`. Use it to see a rendering change, or to prove a refactor
(sprites moved into atlases, say) draws pixel for pixel what it drew before.

It is an offline tool: it builds into `local-data/visual-check-build` (gitignored), never into `dist/`
or `public/`, and needs no release notes or version bump.

## Scenes

Picked by URL hash in `visual-check.html`:

| Scene | What it draws |
| --- | --- |
| `plates` | Players' and enemies' overhead plates at the phone camera framing: guest, prestige badge, gender, dev and guild tags, long name with descenders, power, low HP, a chat bubble; enemy bars with and without HP numbers |
| `gear` | One character per grade × refine (★0 ★10 ★20) × armour class, all slots; then every non-graded piece with world art |
| `enemies` | Every atlas-animated enemy at idle / walk / attack, frames 0 and middle, grouped by map |
| `parts` | The parts-built enemies (goblins, skeletons, slimes …) facing right, left and aiming |
| `icons` | The inventory window over a full bag (every item, a few grades again at ★10 / ★20), at 390 and 1280 wide |
| `hud` | The in-game HUD: player card, toolbar icons, gem wallet, minimap |
| `wordmark` | The start screen with the wordmark |

Clocks, `Math.random`, animation and the device pixel ratio are pinned, so two captures of the same
code are identical (0 changed pixels).

## Capture

    npm run visual:capture -- --out <dir> [--scenes plates,gear] [--dpr 1,2]

Builds the harness, serves it on `127.0.0.1:4517` with `public/` behind it, runs headless Chrome
with DevTools on port `9351`, and writes `<scene>-<width>w@<dpr>x.png` plus `manifest.json`.
`--no-build` reuses the last build; `--port` / `--cdp-port` move the ports (never 3000 or 8000).

To capture another commit, check it out in a temporary worktree, copy `tools/visual-check/` and
`config/vite.visual-check.config.ts` into it, and run its `capture.mjs` with a different `--out` and
`--build-dir`.

## Diff

    npm run visual:diff -- <baseline-dir> <candidate-dir> [--out <dir>] [--threshold 0] [--tolerance 0]

Prints changed pixels per capture. For each capture that changed it writes `<name>.diff.png`
(changes in magenta) and `<name>.side.png` (baseline | candidate | diff). Exits 1 when any capture
changes more than `--threshold` pixels, differs in size, or is missing on one side.

## Always kill Chrome

`capture.mjs` closes Chrome and the server in every exit path (errors, Ctrl-C, SIGTERM), and a
watchdog kills Chrome if the script itself is killed. Still, after a session check that nothing is
left over; a forgotten headless Chrome once ran for days at full CPU:

    ps aux | grep remote-debugging-port | grep -v grep
