import { CAMPAIGN_UNLOCK_FIELDS, equipmentMapRequirement, highestCampaignMap, type CampaignAccess } from "./equipment-access";
import { LEGACY_EQUIPMENT_BONUSES } from "./legacy-equipment-bonuses";
import { LEGACY_PROGRESS_CURVE, REBALANCED_PROGRESS_CURVE } from "./progression-rebase-curves";
import { effectivePlayerPower, playerPowerForStats, type PlayerPowerProgress, type PlayerPowerResearch } from "./player-power";
import { canonicalItemId, itemDefinition, isCosmeticOnlyItem, STARTER_BOW } from "./items";
import { endlessScaling } from "./endless-balance";

type Progress = PlayerPowerProgress & CampaignAccess & { inventoryJson: string; equippedFeet: string; bossRewardClaims: number };
type Levels = (item: string) => number;

/** Frozen additive percentage calculation, never used for new gameplay. */
export function legacyProgressPower(progress: PlayerPowerProgress, research: PlayerPowerResearch | null | undefined, level: Levels) {
  const bonus = (id: string | undefined, stat: number) => (LEGACY_EQUIPMENT_BONUSES[canonicalItemId(id) ?? ""]?.[stat] ?? 0)
    * (1 + Math.max(0, Math.min(10, level(id ?? ""))) * .08);
  const head = progress.equippedHead, chest = progress.equippedChest, weapon = progress.equippedRightHand || progress.equippedLeftHand;
  return playerPowerForStats({ ...progress,
    damage: progress.damage * (1 + (research?.warcraft ?? 0) * .02 + bonus(weapon, 0) + bonus(head, 0) + bonus(chest, 0)),
    maxHp: progress.maxHp * (1 + bonus(head, 1) + bonus(chest, 1)),
    armor: progress.armor * (1 + (research?.precision ?? 0) * .02),
    regen: progress.regen * (1 + (research?.regeneration ?? 0) * .02 + bonus(head, 2) + bonus(chest, 2)),
  });
}

/** Equivalent effort, not lifetime connected time (which includes idle time).
 * Legacy Endless repeated a 3x map with approximately the final campaign's
 * duration. This extrapolation is explicit so the policy can be audited. */
export function legacyEarnedSeconds(power: number) {
  const curve = LEGACY_PROGRESS_CURVE;
  for (let i = 1; i < curve.length; i++) {
    const [t0, p0] = curve[i - 1], [t1, p1] = curve[i];
    if (power <= p1) return t0 + (t1 - t0) * Math.max(0, Math.log(Math.max(power, p0) / p0)) / Math.log(p1 / p0);
  }
  const [lastTime, lastPower] = curve[curve.length - 1];
  const duration = lastTime - curve[curve.length - 2][0];
  return lastTime + duration * Math.log(power / lastPower) / Math.log(3);
}

export function rebalancedProgressAt(seconds: number) {
  const curve = REBALANCED_PROGRESS_CURVE;
  for (let i = 1; i < curve.length; i++) {
    const [t0, p0] = curve[i - 1], [t1, p1] = curve[i];
    if (seconds < t1) return { mapIndex: i - 1, completedEndless: 0,
      power: p0 * (p1 / p0) ** Math.max(0, (seconds - t0) / (t1 - t0)) };
  }
  const [time, power] = curve[curve.length - 1];
  const duration = time - curve[curve.length - 2][0];
  let remaining = seconds - time, number = 1;
  while (number < 10_000) {
    const scale = endlessScaling(number);
    const mapDuration = duration * scale.endurance / scale.rewards;
    if (remaining < mapDuration) return { mapIndex: 15, completedEndless: number - 1,
      power: power * (1 + .2 * (number - 1 + remaining / mapDuration)) };
    remaining -= mapDuration; number++;
  }
  throw new RangeError("Progression conversion exceeds supported legacy effort");
}

export function rebaseProgressByEffort<T extends Progress>(progress: T, research: PlayerPowerResearch | null | undefined, level: Levels, completedEndless = 0) {
  const beforePower = legacyProgressPower(progress, research, level);
  const earnedSeconds = legacyEarnedSeconds(beforePower);
  if (!progress.desertUnlocked) return { progress, beforePower, afterPower: effectivePlayerPower(progress, research, level),
    earnedSeconds, mapIndex: 0, completedEndless: 0 };
  const target = rebalancedProgressAt(earnedSeconds);
  const oldMap = (progress.bossRewardClaims & (1 << 14)) ? 15 : highestCampaignMap(progress);
  const mapIndex = Math.min(oldMap, target.mapIndex);
  const next = { ...progress };
  CAMPAIGN_UNLOCK_FIELDS.forEach((field, index) => { next[field] = Boolean(progress[field] && index + 1 <= mapIndex); });
  next.bossRewardClaims &= (1 << Math.min(mapIndex, 15)) - 1;
  const inventory: string[] = JSON.parse(progress.inventoryJson);
  const owned = [...new Set(inventory)];
  // Preserve every owned item, including locked equipment. Always leave a usable weapon.
  if (!owned.some(id => itemDefinition(id)?.slot === "HAND" && !equipmentMapRequirement(id, next))) owned.push(STARTER_BOW);
  next.inventoryJson = JSON.stringify(owned);
  for (const [field, slot] of [["equippedRightHand", "HAND"], ["equippedHead", "HEAD"], ["equippedChest", "CHEST"], ["equippedFeet", "FEET"]] as const) {
    const current = next[field] ?? "";
    if (current && !equipmentMapRequirement(current, next)) continue;
    next[field] = "";
    let best = -1;
    for (const id of owned) {
      if (isCosmeticOnlyItem(id) || itemDefinition(id)?.slot !== slot || equipmentMapRequirement(id, next)) continue;
      const score = effectivePlayerPower({ ...next, [field]: id }, research, level);
      if (score > best) { best = score; next[field] = id; }
    }
  }
  next.equippedLeftHand = "";
  const naked = { ...next, equippedHead: "", equippedChest: "", equippedRightHand: "", equippedLeftHand: "" };
  const earnedPower = effectivePlayerPower(naked, research);
  const gearPower = effectivePlayerPower({ ...next, damage: 0, maxHp: 0, armor: 0, regen: 0 }, research, level);
  const factor = earnedPower > 0 ? Math.min(1, Math.max(1, target.power - gearPower) / earnedPower) : 1;
  if (factor < 1) {
    next.damage = Math.fround(Math.max(1, next.damage * factor));
    next.maxHp = Math.fround(Math.max(1, next.maxHp * factor));
    next.armor = Math.fround(next.armor * factor); next.regen = Math.fround(next.regen * factor);
  }
  return { progress: next, beforePower, afterPower: effectivePlayerPower(next, research, level), earnedSeconds, mapIndex,
    completedEndless: mapIndex === 15 ? Math.min(completedEndless, target.completedEndless) : 0 };
}
