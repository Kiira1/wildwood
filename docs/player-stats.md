# Player stats

## Where to read the real stats

1. The formulas live in `shared/player-stats.ts` (`computePlayerStats`); the four core stats (max HP, damage, armor, regen) come from `shared/player-power.ts` `playerStatFactors`, which leaderboard power and the server use too.
2. While playing, `src/game/runtime/player-stats-runtime.ts` feeds it from the live player, the bag and the coop session: `playerStats.stats()` in `src/main.ts` returns every final stat with its sources.
3. The profile Stats tab (`src/ui/profile.ts` `profileStatDisplayRows`) shows the same numbers for a saved profile, through `profileStatInputs`; profile power is `playerStatPower`, the server's power formula.
4. Another player's bonuses in play (research, perks, soul, card slots, attack cap, Mastery) come from their public rows through `shared/bonuses-in-play.ts` `bonusesInPlay`, as the server reads its own: profiles and remote combat (`remote-combat-stats-service.ts`) both use it.
5. Inputs are plain data: the run's stats with the soul's share added, the worn gear (`shared/item-level.ts` `itemLevelFor` gives tier and refine), research, perks and cards in play.
6. `src/game/runtime/player-stats-golden.test.ts` pins every client path's numbers for three players (new, mid-campaign, endgame) and checks that the paths agree with the world; read it to see real values. `spacetimedb/src/power-stats.test.ts` checks the server's two power writers and guild fighters.

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
| Max HP | C `player-stats-runtime.ts` healthMultiplierBonus → `player-health.ts` applyPlayerMaxHealthMultiplierBonus; P `profile.ts` profileStatDisplayRows; HUD `stat-tracker-source.ts`; remote `remote-combat-stats-service.ts` | `auto-farm-build.ts` createFarmEvaluator, `virtual-player.ts` (runtime, no cards, untiered) | `progress-helpers.ts` maxHealthForProgress, `player-power.ts` effectivePowerStatsForProgress | sims only, on purpose (7) |
| Damage | C `player-combat-controller.ts` weaponDamage (`items.ts` equipmentDamage × research-controller damageMultiplier); P; HUD; remote | as max HP | `player-power.ts` researchedDamage, `boss-combat.ts` damageLoadout (kill bound), `duel-runtime.ts` duelSide (duels and guild fighters) | sims only (7) |
| Armor | C `research-controller.ts` effectiveArmor; P; HUD; popups; remote | as max HP | `player-power.ts` researchedArmor | sims only (7) |
| Regen/s | C `player-stats-runtime.ts` regenerationPerSecond; P; HUD; remote | as max HP | `player-power.ts` researchedRegen, `duel-runtime.ts` | sims only (7) |
| Move speed | C `player-stats-runtime.ts` moveSpeed (combat's moveSpeedFactor uses the same `gearMoveSpeedFactor`); P | VP (runtime); `simulator.ts` simulationTravelSeconds | `player-speed.ts` effectiveMovementSpeedForProgress (saved), `movement-requests.ts` setPlayerSpeed (allowance) | server saved speed omits gear factors by design (allowance covers them) |
| Attack interval | C `player-combat-controller.ts` (weaponAttackInterval / techniques); P; remote | evaluator, simulator (older floor, 8) | `player-speed.ts` attackIntervalForProgress, `prestige.ts` attackCapInPlay, `duel-runtime.ts` duelSide | sims only (7) |
| Range | C `progress-controller.ts` addedRange + `weaponAttackRange`; P (cards and Archery added the same way); remote | VP (Archery only) | `player-speed.ts` savedAttackRange | server omits Long Shot cards (never validated) |
| Crit chance | C `research-controller.ts` criticalChance (→ `critChanceFor`); P; remote | evaluator; `simulator.ts` (rank only) | `crit-power.ts`, `duel-runtime.ts` | `simulator.ts` (7) |
| Crit multiplier | C research-controller criticalDamageMultiplier; P; HUD; remote | evaluator | `crit-power.ts`, `duel-runtime.ts`, `boss-combat.ts` | `simulator.ts` (7) |
| Reflect / DS / SS | C combat (`procChance`); P | none | `duel-runtime.ts` (reflect clamped to 1), `boss-combat.ts` | no |
| Skill chance | C combat (`skillChanceFactor`) | combat in VP | `boss-combat.ts`, `duel-runtime.ts` | no |
| Gold luck | not shown on the client | VP (`luckMultiplier`) | `gold.ts` goldChanceMultiplier | no |
| Stat gain | C research-controller rewardMultiplier, `reward-display.ts`; P | evaluator | `prestige.ts` statRewardMultiplier | no |

## Disagreements fixed in 0.916.13

These were pinned in `player-stats-golden.test.ts` and are now assertions that every path agrees ("every path agrees with the world").

1. Auto Farm now prices kills with the active cards (`auto-farm-wiring.ts` passes `activeCardTotals` to createFarmEvaluator), so power, DPS, map and boss readiness match the shown power.
2. Profile power is `shared/player-stats.ts` `playerStatPower` with research, perks, cards, soul and cap in play (`bonusesInPlay`, reading the public `player_bonus_toggle` row), the server's formula; other players' Stats rows also use their bonuses in play.
3. Remote combat shadows come from `computePlayerStats` with refines, cards, soul, Keen Edge, crit rating and Archery's range from public rows. Not public, so still left out: Tailwind's live share, Swordplay's Guard and the Mastery techniques (they shape only how others' fights are drawn on your screen).
4. Guild fighters are built by `duel-runtime.ts` duelSide, as duel sides are: a staff's bolt factor and cast interval and the Mastery fold. A crowd has no one opponent, so Parry and Ranged Slayer stay out, and Guard and Mana Shield count as extra health (max health and regen divided by the share of a hit let through).
5. Armor reward popups pass the boots (`shared/reward-display.ts`).
6. Profile Move Speed counts Black Boots (`countBlackBoots` is gone) and profile Range adds Long Shot cards and Archery's range as the world does.
7. The sims stay simpler on purpose: the virtual player plays untiered gear without cards, and `simulator.ts` (the Balance Lab) uses an older attack-interval floor and no perks. They feed balance tuning, not live decisions.
8. `spacetimedb/src/weapon-mastery.ts` bonusMoveSpeedFactor normalizes the boots' refine.

Server: S1, the kill reducer's power and `powerFieldsForProgress` both price power through `spacetimedb/src/power-stats.ts` `powerStatsFrom` (crit and research in play counted). S2, the duel's stored reflect chances are clamped to 1 (the roll already clamped them).

## Server, next

The server still has its own copies. `shared/` already compiles into the module (the server imports `shared/player-power.ts`, `items.ts`, `card-effects.ts` and more; no DOM or node APIs there), so these can call `computePlayerStats` or `playerStatFactors` next:

- `spacetimedb/src/player-power.ts` researchedDamage / researchedArmor / researchedRegen, and `progress-helpers.ts` maxHealthForProgress
- `spacetimedb/src/crit-power.ts` critPowerFrom and `duel-runtime.ts` duelCrit (critChanceFor, criticalDamage)
- `spacetimedb/src/player-speed.ts` effectiveMovementSpeedForProgress and savedAttackRange
- `spacetimedb/src/boss-combat.ts` damageLoadout / skillFactor (skillChanceFactor), and `gold.ts` goldChanceMultiplier
- `spacetimedb/src/progress-helpers.ts` itemLevelFor and `boss-combat.ts` levelFor (`shared/item-level.ts`)
