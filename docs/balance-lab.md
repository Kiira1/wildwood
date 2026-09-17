# Balance Lab

Run `npm run balance:lab`. The primary cards describe ordinary fight length, hits survived, longest wait for +10% power, and boss duration/payout. Start there, then inspect the enemy table for the offending role. The power chart and advanced controls are supporting diagnostics.

`shared/progression.ts` generates real game stats. Lab sliders are temporary what-if adjustments; they do not write source values. The stat graph (`npm run balance:stat-graph`) reads the same runtime definitions and actual spawn composition.

```sh
npm run balance:simulate -- --trials 20 --duration 8h --strategy mixed
npm run balance:simulate -- --trials 3 --duration 8h --research off --equipment-strength 0
npm run balance:audit
```

The audit compares mixed, no-gear/no-research, nearby, and boss-rush campaigns and tests mirror duels using each exit build. It emits JSON with fight time, survival, boss share, and stalled stationary encounters. Runs use fixed seed 7331. Mirror duels intentionally draw; their purpose is to reveal duration and regeneration problems, not matchmaking quality.

Defaults: 52-minute Desert hypothesis, adding 76 minutes per later map, 3× reference stat step, 90-second boss readiness, balanced research, and one initial spawn-site clear. Readiness additionally requires surviving a strongest boss hit with at least 70% health left. The runtime does not enforce those simulator policies. Config storage version 8 resets stale saved scenarios for the current catalog.

Deaths, dodging, crowd combat, recovery routes, multiplayer boss contributions, and active idle time remain unmodeled. Incoming damage is diagnostic. A stationary danger flag is not proof that a player cannot kite an enemy. A completed forecast is not proof that every player survives.

The clock starts at Forest arrival after completing the private tutorial (+1 damage, +0.2 regen); tutorial reading time is excluded. Equipment drops and eligibility come directly from `shared/regular-map-loot.ts` and `shared/enemy-defeats.ts`, including Desert elite exclusions and all campaign equipment. Black Boots use their five-second combat delay and flat +25 movement speed. Loot delivery is immediate in the model rather than waiting for the server batch. Equipment rolls are seeded, upgrades and flat equipment bonuses use shared rules, research advances on its timers, and regular/boss respawns consume time. Boss repeats are separated from first-clear map duration. Core progress must remain possible without a lucky equipment roll.

See [progression-scaling.md](progression-scaling.md) for the current authoring contract and [balance-diagnosis.md](balance-diagnosis.md) for the historical investigation.

Equipment now adds fixed stats after research (`base × tech + item bonus`). The Forest bow adds 5 damage and its armor/helmet add 25 health each. Desert items start at 480 damage, 400 health per defensive piece, and 12 regen where present; later source-map tiers triple those fixed amounts. Rare Frost/Lava boss drops and Fire Metal Bow receive 20% extra. Each upgrade adds 8% of the item's original amount, up to +80% at level 10. Owning older gear never multiplies future farming rewards. Item IDs, ownership, upgrade levels, earned stats, drop odds, and research are retained.

Flat-stat combat is protocol 106. Publish it with matching web/native clients and root/map servers; percentage-based clients are intentionally incompatible with the new boss-DPS checks. No database schema migration is required.
