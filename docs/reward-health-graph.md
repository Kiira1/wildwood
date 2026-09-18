# Reward per health graph

Double-click `tools/run-reward-health-graph.command` in Finder, or run:

```sh
npm run balance:reward-health
```

The browser opens a local graph of **reward per kill / enemy max HP**, with a distinct color for damage, health, armor, regeneration, and attack speed. Circles are regular enemies (including elites); squares are bosses. Each enemy and each boss reward stat is represented separately. Identical spawns share one point. Hover, tap, or focus a point to inspect exact values; the table lists every payout.

The default view includes all 15 campaign maps and Endless 1–15. Choose campaign only, an Endless range, or an individual map. Endless uses actual generated enemy and boss health/rewards, including the stronger damage-camp lane. Change the start and count to inspect up to 100 Endless maps at a time. Health, reward, and the ratio appear together in the table, making it possible to see health outgrow rewards.

Logarithmic scale is the default for inspecting values across many orders of magnitude; equal vertical steps represent equal multiplication factors. Linear scale is optional: twice the height means twice the reward per HP. Filter to one stat or a few maps if small values crowd the bottom of the linear graph.

Use stat checkboxes, regular/boss filters, and reward per 1 or 1,000 HP. Sort by efficiency to find outliers. Compare the same stat across enemies; raw units of different stats have different gameplay value. CSV export preserves exact values for the filtered rows, always as reward per 1 HP.

These are current source values before player research and stat caps. The ratio does not include respawn/travel time, enemy armor, boss regeneration, or equipment drops. It is a reward/health diagnostic, not a simulated reward-per-hour estimate. Attack-speed reward means attacks per second gained.

Build both graph tools with `npm run build:reward-health`; the new page is `dist/balance-stat-graph/reward-health-graph.html`. The existing map-multiplier graph links to it.
