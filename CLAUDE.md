# WildStat

Browser MMO. Web client on GitHub Pages + Cloudflare (wildstatmmo.com), game server on SpacetimeDB
Maincloud (`wildwood-coop`, one database — sharding was removed in 0.766).

## Shipping a version

**Rymel runs the command that ships. Every time.** Claude works on a branch, gets it
green, hands over the exact command and stops. That covers committing to `main`
(the post-commit hook pushes and deploys straight to players), the server publish,
and any production `spacetime sql` write. Rymel can waive it for one change by
saying so; the waiver does not carry to the next one.

**The ship command.** Once main holds the release:

    npm run ship

It runs the fast checks (`check:release`, both typechecks, the server bindings
against a fresh generate, the unit tests), works out what is not live yet, and
ships it in the order that keeps players playing:

- client only: push, wait until both sites serve the new version;
- a compatible server change: publish first, then push (a new client may need
  the new server; old clients work on it);
- a server change that disconnects everyone: refused unless run with
  `--allow-client-break`; then the client is pushed and live first and the server
  is published last, so the reload lands on a client that is already there.

`npm run ship -- --dry-run` prints the plan and ships nothing. Claude hands over
`npm run ship` (with the flag when needed) instead of the separate commands below.

The client and the server deploy by completely separate routes. A commit ships the
client by itself; it never touches the server.

**Client.** Committing to `main` auto-pushes — `.githooks/post-commit`,
main only, not branches. That is why Claude does not commit there: the commit *is*
the deploy. The push triggers `.github/workflows/pages.yml`: the site build, both
typechecks and the unit tests (in four parallel parts) run side by side, then the
signed Android update feed, then the deploy of the same `dist` to wildstatmmo.com
(the Cloudflare Worker `wildstat`, deployed by the workflow since 2026-10-10; the
dashboard's Git build is off) and to GitHub Pages. About two minutes. Check
`https://wildstatmmo.com/version.json`.

`.github/workflows/server-checks.yml` builds the server module and checks the
committed `src/module_bindings` match it. It never deploys anything.

**Server.** Changes under `spacetimedb/` or `shared/` do nothing until published:
`npm run ship` does it, or by hand `npm run spacetime:publish:live`. Rymel runs
either himself in his terminal — never run them from an agent session, and never
publish to `wildwood-coop`, `wildwood-balance-local`, or maincloud from a worktree.

**Version bump.** For a client-only release the one-shot helper is:

    npm run release:live

It suggests the next version, takes one note per line, runs every check, commits,
pushes main, and then waits until the live site reports the new version. It refuses
to run when the diff touches `shared/`, `spacetimedb/` or `src/module_bindings/`,
because those need the server publish above.

The pieces underneath it: `npm run release -- <version>` rewrites GAME_VERSION,
`public/index.html`, `public/version.json`, the changelog release day, and the
artwork stamp in `config/shipped-assets.json`. Write the release notes in
`src/app/changelog.ts` before committing. `npm run check:release` (also run in CI)
fails when those fall out of sync, or when files under `public/assets` were added,
removed or renamed without a bump — a cached client still requests the old names.

A stylesheet-only change that should ship without a bump: restamp
`config/shipped-assets.json` at the current version in the same commit.

`check:release` also compares the client's table bindings with
`config/subscribed-schema.json`. A column added to or removed from a table the
client reads needs a `PROTOCOL_VERSION` bump (old tabs cannot decode the new
rows and retry forever); new tables only need
`node scripts/subscribed-schema.mjs --stamp`.

`release:prepare` / `release:rollout` / `release:cancel` are the staged mobile
release flow, not the web version bump. `spacetime:publish:cloud` is the raw CLI
publish with no preflight — prefer `spacetime:publish:live`.

## Verification

Before handing anything over, run all of these, and say plainly what they do not
cover — none of them sees layout, feel or a running game. `npm run dev:local`
serves the client against the local `wildwood-balance-local` database for that.

There is no `npm run typecheck`. Use:

    npx vitest run
    npm run typecheck:coop
    npm run typecheck:balance
    npm run spacetime:build
    npm run check:release
    npm run build:client

`check:release` includes `npm run check:code-health`: the size ratchets on
`src/main.ts`, `src/wildstat-coop.ts` and `spacetimedb/src/index.ts` and the
import-cycle checks. Extract a module to pass them; never pack lines.

## Tests

- **Default: add no test.** Most changes need none.
- **Core tests** (exact, beside the module) only for rules where a mistake hurts
  silently: server validation and anti-cheat bounds, reward, price, odds and
  balance math, data migrations, sign-in and tokens, and data-loss paths.
- **Scenarios** (`tests/scenarios/`) for flows a player sees: one high-level test
  driving the real game and real reducers, not one test per module.
- Never mock our own modules. Fake only what is outside the repo (network,
  clock, storage, browser APIs).
- Never assert wording, markup, CSS classes, diagnostic strings, default flag
  values, call order or source text.
- Layout and art are checked with `tools/visual-check`, not tests.
- Opt-in runners (`npm run test:balance`, `npm run sim:autofarm`) stay out of
  the default suite (`vitest.config.ts`).
- Delete an old test file only in the same change that adds the scenario
  replacing it.

## Conventions

- Reducers are the only mutation path; kills are client claims bounded server-side.
- Large or risky server refactors go on a branch so the hook does not deploy them.
- `local-data/**` is gitignored — moderation records and player data live there and
  must never be committed.
- Developer-gated reducers need a logged-in game session; the CLI cannot invoke them.
