# Balance Lab

Double-click `tools/run-balance-lab.command`, run `npm run balance:lab`, or follow **Open Balance Lab** from the reward/health graph. The lab simulates progression over active play time; the reward/health graph shows static payout efficiency, not elapsed time.

Start with five seeded trials, balanced research, and mixed farming. The browser defaults to a 30-day window with Endless 1–15 available after Ion. It waits for **Run simulation**, so reopening the page does not launch expensive work. Strategy comparisons are optional; **Cancel run** stops the worker immediately. **Stop after last selected map’s boss** avoids post-completion farming. If selected maps finish early, the remaining timeline holds the final power; that flat tail is a stopped run, not measured farming. Increase the Endless count to inspect a continuing late-game curve. Unreached maps remain marked as such.

The median campaign is calibrated toward roughly seven days of active play before Endless. Forest targets about one hour and Desert about 90 minutes, then a rounded duration reference increases the farming time. A 90% payout reduction starts at Endless 1 for regular enemies and bosses. Sixth-power Endless endurance makes later health requirements outgrow slowly increasing rewards. The game does not enforce completion timers. Incoming damage, survival, boss reward share, and time spent on each stat explain the causes behind the curve.

## Kill-budget comparison

The table compares current boss readiness against configurable damage- and health-kill targets. Counts use the representative trial's actual map-entry build and the highest reward per kill in each local lane, including elites. It accounts for current gear, research reward bonuses, attack interval, and boss regeneration. It holds those factors and armor fixed while calculating how many damage kills meet the fight-time target and how many health kills reduce the strongest hit to 30% of HP. This is not a globally optimal route across armor, attack-speed, or future gear choices, and it does not guarantee surviving all boss attacks without dodging.

The default run uses the released, fixed boss stats. Enable **Scale bosses to kill targets** to run the sandbox scenario. It scales boss HP and strongest hit from each trial's entry build; regular enemies, item odds, and rewards retain their values. Target kill counts grow by configurable campaign and Endless multipliers. Run current balance first, then the scenario: the chart retains the previous run for comparison. The full event simulation lets research, gear, upgrades, and mixed farming change the actual kills and elapsed time. These controls never write game rules or live saves.

## CLI and source data

```sh
npm run balance:simulate -- --trials 5 --duration 30d --endless 15 --stop-after-campaign
npm run balance:simulate -- --trials 3 --duration 30d --endless 5 --kill-budget --damage-kills 25 --health-kills 25 --kill-growth 1.45 --endless-kill-growth 1.25 --stop-after-campaign
npm run balance:reward-health
```

`shared/progression.ts` and `shared/endless-balance.ts` generate real game stats. Lab tuning is temporary. Weapons, chests, and helmets grant 5%–40% damage, health, and regeneration at base level, up to 72% at +10. Upgrades add 8% of the item's original bonus per level. Both regular enemies and bosses roll the local regular equipment pool; Frost/Lava bosses retain their exclusive drops. Loot is delivered immediately in this model rather than waiting for server batching.

The clock begins at Forest arrival with private tutorial rewards. It includes travel, combat, respawn waits, research, and equipment upgrades. Upgrading temporarily removes an item and can reduce effective power. It excludes deaths, dodging, recovery routes, multiplayer contributions, and idle time. Readiness and initial camp clears are player-strategy assumptions. Existing earned stats, inventory, and upgrade levels are retained in the game.

See [progression-scaling.md](progression-scaling.md) for the authoring contract and [reward-health-graph.md](reward-health-graph.md) for payout inspection.


Release 0.740 calibration: seven mixed-route trials (seed 7331), steady upgrades,
balanced research, and authored bosses reached 1m power at a median 22.4 hours,
Ion at 1.18qd power, and Endless 1 at day 6.96. Median map durations were
14.2 hours for Ion, 6.13 days for Endless 1, and 11.45 days for Endless 2.
These are active-play forecasts with the model limits above, not calendar-day promises.
