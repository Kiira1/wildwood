# Balance Lab

Double-click `tools/run-balance-lab.command`, run `npm run balance:lab`, or follow **Open Balance Lab** from the reward/health graph. The lab simulates progression over active play time; the reward/health graph shows static payout efficiency, not elapsed time.

Start with five seeded trials, balanced research, and mixed farming. The browser defaults to a 30-day window with Endless 1–15 available after Ion. It waits for **Run simulation**, so reopening the page does not launch expensive work. Strategy comparisons are optional; **Cancel run** stops the worker immediately. **Stop after last selected map’s boss** avoids post-completion farming. If selected maps finish early, the remaining timeline holds the final power; that flat tail is a stopped run, not measured farming. Increase the Endless count to inspect a continuing late-game curve. Unreached maps remain marked as such.

The browser and CLI default to the captured maincloud balance settings, resolved against the current checkout’s game rules. The source selector shows the captured revision and date; choose **Authored defaults** to compare without server overrides. Temporary sliders apply on top of the selected source. The captured revision is a snapshot, not an automatic live subscription. A 90% payout reduction starts at Endless 1 for regular enemies and bosses, and sixth-power endurance increases later health requirements. Duration and kill-budget controls are sandbox comparisons only.

## Refresh from the game

```sh
npm run balance:sync
npm run balance:lab
```

The sync command reads only the live balance head and settings from `wildwood-coop`, validates them, and updates `src/balance/live-balance.ts`. It never writes server data. It needs the database owner's existing SpacetimeDB CLI login. If the command fails, the previous capture remains intact. Reload the lab after refreshing; saved live-mode controls use the new capture. Old simulation preferences were reset for this model update so old sandbox values do not silently masquerade as current balance.

Campaign and Endless enemies, boss HP, attacks, rewards, regeneration, respawns, and regular-drop odds now use the same `resolveMapBalance` contract as the game. This includes live boss payout overrides and the Ion health multiplier. Campaign bosses and Endless bosses use their respective respawn timers. The global enemy-respawn control is a base value before each map's respawn multiplier. Enemy movement speed is resolved but enemy pursuit/dodging is not simulated.

Both regular enemies and personal bosses use research critical-hit expected damage. This is an average-damage approximation, not a seeded simulation of individual critical rolls or exact expected discrete kill times. The source-level simulator API retains authored defaults when no `balanceSettings` are supplied; the browser and CLI explicitly pass the capture.

## Kill-budget comparison

The table compares current boss readiness against configurable damage- and health-kill targets. Counts use the representative trial's actual map-entry build and the highest reward per kill in each local lane, including elites. It accounts for current gear, research reward bonuses, attack interval, and boss regeneration. It holds those factors and armor fixed while calculating how many damage kills meet the fight-time target and how many health kills reduce the strongest hit to 30% of HP. This is not a globally optimal route across armor, attack-speed, or future gear choices, and it does not guarantee surviving all boss attacks without dodging.

The default run uses the released, fixed boss stats. Enable **Scale bosses to kill targets** to run the sandbox scenario. It scales boss HP and strongest hit from each trial's entry build; regular enemies, item odds, and rewards retain their values. Target kill counts grow by configurable campaign and Endless multipliers. Run current balance first, then the scenario: the chart retains the previous run for comparison. The full event simulation lets research, gear, upgrades, and mixed farming change the actual kills and elapsed time. These controls never write game rules or live saves.

## CLI and source data

```sh
npm run balance:sync
npm run balance:simulate -- --trials 5 --duration 30d --endless 15 --stop-after-campaign
npm run balance:simulate -- --trials 3 --duration 30d --endless 5 --kill-budget --damage-kills 25 --health-kills 25 --kill-growth 1.45 --endless-kill-growth 1.25 --stop-after-campaign
npm run balance:reward-health
```

`shared/progression.ts` and `shared/endless-balance.ts` generate real game stats. Lab tuning is temporary. Weapons, chests, and helmets grant 5%–40% damage, health, and regeneration at base level, up to 72% at +10. Upgrades add 8% of the item's original bonus per level. Regular drops use the selected configuration and shared loot eligibility; boss drops use the current shared item pools. Loot is delivered immediately in this model rather than waiting for server batching.

The clock begins at Forest arrival with private tutorial rewards. It includes travel, combat, respawn waits, research, and equipment upgrades. Upgrading temporarily removes an item and can reduce effective power. It excludes deaths, dodging, recovery routes, multiplayer contributions, and idle time. Readiness and initial camp clears are player-strategy assumptions. Existing earned stats, inventory, and upgrade levels are retained in the game.

See [progression-scaling.md](progression-scaling.md) for the authoring contract and [reward-health-graph.md](reward-health-graph.md) for payout inspection.
