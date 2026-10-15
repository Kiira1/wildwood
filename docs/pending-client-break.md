# Changes waiting for a client-breaking release

SpacetimeDB marks any change to row-level visibility rules (`clientVisibilityFilter`) as
breaking every client: publishing them disconnects every player once. `npm run
spacetime:publish:live` refuses such a plan unless it is run with `--allow-client-break`, so
these are batched and shipped together in a release that breaks clients anyway.

## Waiting (from 0.907.0)

These tables are declared but nothing reads or writes them since 0.907.0. Empty them on live, then
remove their declarations, in the next release that breaks clients:

- `player_balance_version`: every save was at version 9 (2026-10-15); world entry stopped reading it.
  Old migrations in `module-migrations.ts` and `markPlayerBalanceCurrent` (`player-power.ts`) still
  name it; make them skip a missing table, as the 0.907.0 drops did.
- `prestige_expansion`: the countdown ended on 2026-09-30.
- `player_wide_stats`, `player_combat_rating`: copied onto `player_progress` by migration 57.
  `deleteProgressExtras` (`wide-stats.ts`) still clears them on account removal.
- `leaderboard_position`, `leaderboard_prestige_position`, `leaderboard_prestige_rank_page` (0.908.0):
  the per-prestige-level boards. The first full snapshot empties them; also drop the
  `getPrestigeLeaderboardPage`, `getLeaderboardPage` and `getLeaderboardWindow` procedures older tabs
  still call (0.908.2 clients use `getLeaderboardRanks`).

    spacetime sql -s maincloud wildwood-coop "DELETE FROM player_balance_version"

(and the same for each table), run by Rymel just before that publish.
