# Scenario tests

One file per area (`combat.test.ts`, `social.test.ts`, …). Each `it(...)` is one
thing a player or the server would notice, in a few steps, run on the real code.

Rules:

- Drive the game the way a player or the server does; read what they would see.
- Never mock our own modules. Fake only the network, the clock, storage and
  browser APIs (the harness does this).
- Never assert wording, markup, CSS classes, diagnostic strings, default flag
  values, call order or source text.

## Harness (`harness/`)

| Piece | What it is | Use for |
|---|---|---|
| `server.ts` `scenarioWorld()` | Every reducer, view and scheduled reducer of `spacetimedb/src` on an in-memory database. `world.join("Ann")` connects, accepts the Terms and enters (tutorial skipped unless `{ tutorial: true }`). `ann.call(...)` / `ann.refusal(...)`, `ann.view("my_gold")`, `world.advance(ms)`, `world.runDue()` for scheduled work. | Server rules |
| `client.ts` `connectClient(world, ann)` | A `DbConnection` for one player: its reducer calls run on the world, its tables show that player's views and visible rows, row callbacks fire as the SDK fires them. Any client service (`createToolRows`, `createChatService`, …) runs on it unchanged. `conn.fake.settle()` lets replies land. | One client service against the real server |
| `game.ts` `gameWorld()`, `bootGame(world)`, `playAs(world, "Ann")` | The whole client booted as index.html boots it (coop-client.js, then game.js) on linkedom, with fake timers, art loading from `public/`, and the network going to the world. `tab.play(ms)`, `tab.tap(id)`, `tab.hold("KeyD", ms)`, `tab.setHidden(true)`, `tab.reload()`, `tab.acceptTerms()`, `tab.screen()` (ids on screen). | What the player sees end to end |
| `sim.ts` `simPlayer(profile)` | The game's frame step headless (virtual-player.ts): combat, enemy AI, bosses, travel, autofarm, seeded clocks. `sim.play(seconds, { autofarm })`, `sim.walk(x, y, seconds)`, `sim.parts` (player, enemies, autoFarm, …). | Long fights and farming, fast |
| `browser.ts` | Images that load at their real size and `fetch` for the site's own files. | Used by `game.ts` |

A file's first boot costs a second or two (loading the client); each boot
after it about 0.2 s. Played time is what costs: a minute of `tab.play` takes
one to two seconds. Keep a file under ~10 s on its own so the parallel run
stays even, and run `npm run test:weights` after adding or splitting a slow
file (CI splits its four parts by those times).

## Visual checks

Rendering is checked by `tools/visual-check` scenes against a baseline kept
per machine in `local-data/visual-check-baseline` (`npm run visual:check`, needs
Chrome; `--update` creates it; not part of vitest or CI).
