# Balance: who owns which number

Since 0.915 the game has one balance, the curve, and it lives in the repo.
Everything under `shared/` is compiled into both the client and the server
module, so a change there reaches players only after a client release **and** a
server publish (`npm run ship` does both, in the right order). The server
resolves a map's numbers with `resolveMapBalance` (`shared/map-balance.ts`) and
pins the snapshot to each map visit; the client installs it before combat starts
(`src/game/runtime/map-balance-loader.ts`).

Effective value = the map's damage camp on the curve × its role's multiple × the
Balance Lab factor (1 unless tweaked), resolved on the server.

| Numbers | Owner (edit here) | How to change it |
|---|---|---|
| Steps per map (health, damage, reward) and the hit level from map 2 | `shared/curve-steps.ts` | edit; release + publish |
| The Forest's damage camp, each role's multiple of it, boss health and attack shares | `shared/curve-shape.ts` | edit; release + publish |
| Deliberate per-map tweaks | `shared/balance-tweaks.json` | `npm run balance:adopt` copies live Lab tweaks here |
| Enemy speed, attack speed, radius, aggro, reward type; the Forest's Spitter (off the curve) | `shared/enemy-base-values.ts` (Endless-only art rows: `shared/endless-enemies.ts`) | edit the row; release + publish |
| Bosses pay nothing; boss rule names | `shared/rules.ts` (`*_MAX_HP`, `*_REWARD_*`) | the resolver overwrites the values |
| Boss regeneration | `shared/boss-regeneration.ts` | edit; release + publish |
| Respawn timers, player base stats, chase-speed cap | `shared/rules.ts` | edit; release + publish |
| Spawn camps per map | `shared/map-designs.json` (fallback `shared/enemy-camps.ts`) | `npm run map:editor`; release + publish |
| Arrival, boss, portal and bench positions | `shared/map-editor-overrides.ts`, **generated** from `shared/map-designs.json` | save from the map editor |
| Map duration targets | `shared/campaign-pacing.ts` | Balance Lab only, not read by the game |
| Live Lab factors | database: `map_balance_version` rows, `map_balance_head` the current one | Settings → Developer tools → Balance ([live-map-balancing.md](live-map-balancing.md)) |
| Snapshot of the live factors | `src/balance/live-balance.ts`, **generated** by `npm run balance:sync` | rerun `balance:sync`; never hand-edit |

The Balance Lab, its scorecard and the Auto Farm sims read the repo's balance
(`src/balance/game-balance.ts`). `npm run ship` refuses while the live head
differs from it; adopt the live tweaks or put the head back first.

Revisions saved before the curve (no `curveVersion: 2`) are refused: migration
60 moved the head and every pinned visit onto the curve as revision 80.
`tests/fixtures/balance-revision-79.json`, the last revision before it, is kept
for that migration's tests.

## Checks

- `shared/map-balance.test.ts` checks the curve itself: each step map over map,
  every role a fixed multiple of its damage camp, bosses a fixed multiple, Endless
  carrying on by the same steps, and the map 1 Spitter baseline (8 health, 1.5
  damage reward).
- `shared/campaign-balance-invariants.test.ts` holds the design rules: each
  enemy track grows map over map, elites out-pay their camp, each boss out-lasts
  the last, map time grows.
- `scripts/generated-balance-files.test.ts` checks the generated files above are
  exactly what their generators write.
