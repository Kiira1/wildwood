# Player stats

## Where to read the real stats

1. The formulas live in `shared/player-stats.ts` (`computePlayerStats`); the four core stats (max HP, damage, armor, regen) come from `shared/player-power.ts` `playerStatFactors`, which leaderboard power and the server use too.
2. While playing, `src/game/runtime/player-stats-runtime.ts` feeds it from the live player, the bag and the coop session: `playerStats.stats()` in `src/main.ts` returns every final stat with its sources.
3. The profile Stats tab (`src/ui/profile.ts` `profileStatDisplayRows`) shows the same numbers for a saved profile, through `profileStatInputs`.
4. Inputs are plain data: the run's stats with the soul's share added, the worn gear (`shared/item-level.ts` `itemLevelFor` gives tier and refine), research, perks and cards in play.
5. `src/game/runtime/player-stats-golden.test.ts` pins every client path's numbers for three players (new, mid-campaign, endgame); read it to see real values.

## The formulas

| Stat | Formula (`shared/player-stats.ts`) |
|---|---|
| Max HP | base × (1 + gear health) × (1 + Vitality × 2%) × health cards |
| Damage | base × (1 + gear damage) × Class Set × (1 + Warcraft × 2%) × attack cards |
| Armor | base × Warrior Boots × (1 + Precision × 2%) × armor cards; Block = `combat.ts` `armorDamageReduction` (a map may install its own rule) |
| Regen/s | base × (1 + gear regen) × (1 + Regeneration × 2%) × regen cards |
| Move speed | ((base × Move Speed research + Utility) × (1 + Fleet Foot + cards) + Black Boots 25) × armor class × Ranger Boots × (1 + Tailwind) |
| Attack interval | max(cap, run interval); a staff fires at × `STAFF_CAST_INTERVAL_FACTOR` (`weaponInterval`) |
| Range | the range in play (saved range, which holds Utility research and Long Shot, plus Long Shot cards and Archery) through `weaponAttackRange` |
| Crit chance | Critical Chance rank × 1% + Keen Edge + crit cards |
| Crit multiplier | `critical-damage.ts` `criticalDamage` (research, Keen Edge, soul, run rating, cap rank, cards) |
| Reflect / Double Strike / Split Shot | the perk's chance + the cards' chance (`procChance`) |
| Skill chance factor | Magic armor × Mystic Boots |
| Gold chance | (1 + Treasure cards) × Gold Luck (`gearLuck` rank) |
| Stat gain | Tech × Prestige × Guild (cards add per stat: `cardStatGainFactor`) |

What the enemies on the player cost (damage and blows a second, net of regen) is `src/game/runtime/chasers-summary.ts` `chasersSummary`, on the auto-farm kite model; `enemy-threat.ts` `listChasers` picks them.

Gear bonuses already hold the slot tier (4% of the base bonus a tier) and the refine; `sources` splits them into Equipment, Slot Upgrade and Refine for the profile.

## Inventory: where each stat is computed

C = client world, P = profile, A = auto-farm and sims, S = server. "Same" means it goes through `playerStatFactors` or `computePlayerStats`.

| Stat | Client | Auto-farm / sims | Server | Can disagree? |
|---|---|---|---|---|
| Max HP | C `player-stats-runtime.ts` healthMultiplierBonus → `player-health.ts` applyPlayerMaxHealthMultiplierBonus; P `profile.ts` profileStatDisplayRows; HUD `stat-tracker-source.ts` | `auto-farm-build.ts` createFarmEvaluator, `forecast-inputs.ts` forecastBuild, `virtual-player.ts` (runtime, no cards, untiered) | `progress-helpers.ts` maxHealthForProgress, `player-power.ts` effectivePowerStatsForProgress | A: yes (bug 1, 8) |
| Damage | C `player-combat-controller.ts` weaponDamage (`items.ts` equipmentDamage × research-controller damageMultiplier); P; HUD | as max HP | `player-power.ts` researchedDamage, `boss-combat.ts` damageLoadout (kill bound), `duel-runtime.ts` | A: yes (bug 1); guild fighter (bug 4) |
| Armor | C `research-controller.ts` effectiveArmor; P; HUD | as max HP | `player-power.ts` researchedArmor | popups (bug 5), A (bug 1) |
| Regen/s | C `player-stats-runtime.ts` regenerationPerSecond; P; HUD | as max HP | `player-power.ts` researchedRegen, `duel-runtime.ts` | A (bug 1) |
| Move speed | C `player-stats-runtime.ts` moveSpeed (combat's moveSpeedFactor uses the same `gearMoveSpeedFactor`); P | VP (runtime); `forecast-compare.ts`, `simulator.ts` simulationTravelSeconds | `player-speed.ts` effectiveMovementSpeedForProgress (saved), `movement-requests.ts` setPlayerSpeed (allowance) | P (bug 6); server saved speed omits gear factors by design (allowance covers them) |
| Attack interval | C `player-combat-controller.ts` (weaponAttackInterval / techniques); P | evaluator, forecast, simulator (older floor, bug 8) | `player-speed.ts` attackIntervalForProgress, `prestige.ts` attackCapInPlay | guild fighter (bug 4) |
| Range | C `progress-controller.ts` addedRange + `weaponAttackRange`; P | VP (Archery only) | `player-speed.ts` savedAttackRange | P (bug 6); server omits Long Shot cards (never validated) |
| Crit chance | C `research-controller.ts` criticalChance (→ `critChanceFor`); P | evaluator; `forecast-soul.ts`; `simulator.ts` (rank only) | `crit-power.ts`, `duel-runtime.ts` | remote players (bug 3), sims (bug 7, 8) |
| Crit multiplier | C research-controller criticalDamageMultiplier; P; HUD | evaluator; `forecast-soul.ts` (no Keen Edge) | `crit-power.ts`, `duel-runtime.ts`, `boss-combat.ts` | bug 3, 7; server kill-report power (S1) |
| Reflect / DS / SS | C combat (`procChance`); P | forecast perks (no cards) | `duel-runtime.ts`, `boss-combat.ts` | duel reflect not clamped to 1 (S2) |
| Skill chance | C combat (`skillChanceFactor`) | combat in VP | `boss-combat.ts`, `duel-runtime.ts` | no |
| Gold luck | not shown on the client | VP (`luckMultiplier`) | `gold.ts` goldChanceMultiplier | no |
| Stat gain | C research-controller rewardMultiplier, `reward-display.ts`; P | evaluator | `prestige.ts` statRewardMultiplier | no |

## Known disagreements (bugs for the owner)

Pinned in `player-stats-golden.test.ts` ("known disagreements") or listed here; nothing below was changed.

1. Auto-farm prices kills without the active cards' stat factors: `main.ts` createAutoFarmProgress passes `equipment()` with no `activeCards`, so power, DPS, map and boss readiness read below the shown power when cards are worn. Crit is the exception (it comes from the research controller).
2. Profile power uses the raw perk ranks (`profile.ts` profilePower), so it ignores bonus toggles and Aggro, even on your own profile; the Stats rows use the perks in play. Other players' rows also use raw research and perks, while the server uses the ones in play.
3. `remote-combat-stats-service.ts` remoteCombatStatsFromRows (other players fighting on your screen) drops refines, cards, soul, Keen Edge and mastery.
4. Guild fighters (`spacetimedb/src/index.ts` guildFighterFor) skip weaponHitFactor, weaponAttackInterval and the mastery fold that duels apply.
5. Armor reward popups leave Warrior Boots out (`shared/reward-display.ts` passes no feet), while the armor they raise counts them.
6. Profile Move Speed leaves Black Boots out (`countBlackBoots: false` keeps it so), and profile Range leaves Long Shot cards and Archery's range out (it reads the saved range).
7. `forecast-soul.ts` crit damage omits Keen Edge while its crit chance includes it.
8. The sims are simpler on purpose but undocumented: the virtual player plays untiered gear without cards, and `simulator.ts` uses an older attack-interval floor and no perks.
9. `spacetimedb/src/weapon-mastery.ts` bonusMoveSpeedFactor reads the boots' refine without normalizing it.

Server-only: S1, the kill reducer's `boss-combat.ts` powerFields passes no crit and uses the raw research row, so `player.powerLevel` it writes differs from `powerFieldsForProgress`. S2, the duel's reflect chance (`duel-runtime.ts`) is not clamped to 1.

Cosmetic follow-ups: bug 6 is display only; bug 2 changes only the profile's numbers.

## Server, next

The server still has its own copies. `shared/` already compiles into the module (the server imports `shared/player-power.ts`, `items.ts`, `card-effects.ts` and more; no DOM or node APIs there), so these can call `computePlayerStats` or `playerStatFactors` next:

- `spacetimedb/src/player-power.ts` researchedDamage / researchedArmor / researchedRegen, and `progress-helpers.ts` maxHealthForProgress
- `spacetimedb/src/crit-power.ts` critPowerFields and `duel-runtime.ts` duelCrit (critChanceFor, criticalDamage)
- `spacetimedb/src/player-speed.ts` effectiveMovementSpeedForProgress and savedAttackRange
- `spacetimedb/src/boss-combat.ts` damageLoadout / skillFactor (skillChanceFactor), and `gold.ts` goldChanceMultiplier
- `spacetimedb/src/progress-helpers.ts` itemLevelFor and `boss-combat.ts` levelFor (`shared/item-level.ts`)
