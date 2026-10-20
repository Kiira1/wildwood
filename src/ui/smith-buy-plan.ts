import {
  bootArmorFactor, bootMoveSpeedFactor, bootSkillChanceFactor, itemDamageMultiplierBonus, itemDefinition, itemMaxHealthMultiplierBonus,
  itemRegenerationMultiplierBonus, type ItemLevel,
} from "../../shared/items";
import {
  ARMOR_CLASSES, ARMOR_CLASS_DETAILS, ARMOR_CLASS_NAMES, BOOT_STYLES, BOOT_STYLE_NAMES, BOOT_STYLE_SCHOOL, BOOT_STYLE_STAT, GEAR_GRADE_NAMES,
  GEAR_GRADES, GRADE_GOLD_PRICE, type GearGrade,
} from "../../shared/gear-grades";
import { GRADE_ARMOR_KINDS, armorClassOf, bootStyleOf, gradeEquipmentKindOf, gradeOf, type GradeItemId, type GradeWeaponKind } from "../../shared/grade-equipment";
import { gradeShopItemId, gradeShopNeed, gradeShopOffer, type GradeShopLine, type MasteryLevels } from "../../shared/grade-shop";
import type { WeaponSchool } from "../../shared/weapon-mastery";

/** What the player wears, as the bag saves it. */
export type WornLoadout = { equippedRightHand?: string; equippedLeftHand?: string; equippedHead?: string; equippedChest?: string; equippedFeet?: string };

const SCHOOL_WEAPON: Readonly<Record<WeaponSchool, GradeWeaponKind>> = { archery: "bow", swordplay: "sword", sorcery: "staff" };
const KIND_NAMES = { bow: "Bow", sword: "Sword", staff: "Staff", helmet: "Helmet", armor: "Armor", boots: "Boots" } as const;

/** "For Your Bow": the weapon a school fights with. */
export const schoolWeaponName = (school: WeaponSchool) => KIND_NAMES[SCHOOL_WEAPON[school]];

/** A school's lines, in the shop's order: its weapon, its armor class's helmet and armor, its boots. */
export function schoolLines(school: WeaponSchool): GradeShopLine[] {
  const armorClass = ARMOR_CLASSES.find(each => ARMOR_CLASS_DETAILS[each].school === school)!;
  const bootStyle = BOOT_STYLES.find(each => BOOT_STYLE_SCHOOL[each] === school)!;
  return [{ kind: SCHOOL_WEAPON[school] }, ...GRADE_ARMOR_KINDS.map(kind => ({ kind, armorClass })), { kind: "boots", bootStyle }];
}

/** A graded piece's kind with its class or style: "Bow", "Light Helmet", "Ranger Boots". */
export function gradeKindName(itemId: GradeItemId) {
  const armorClass = armorClassOf(itemId), bootStyle = bootStyleOf(itemId), kind = KIND_NAMES[gradeEquipmentKindOf(itemId)!];
  const variant = armorClass ? `${ARMOR_CLASS_NAMES[armorClass]} ` : bootStyle ? `${BOOT_STYLE_NAMES[bootStyle]} ` : "";
  return `${variant}${kind}`;
}

/** A graded piece by grade and kind: "Rare Bow", "Rare Light Helmet", "Rare Ranger Boots". */
export const gradeShortName = (itemId: GradeItemId) => `${GEAR_GRADE_NAMES[gradeOf(itemId)!]} ${gradeKindName(itemId)}`;

/** The worn piece in an item's slot. */
export function wornInSlot(worn: WornLoadout, itemId: string) {
  const slot = itemDefinition(itemId)?.slot;
  if (slot === "HAND") return worn.equippedRightHand || worn.equippedLeftHand || "";
  return (slot === "HEAD" ? worn.equippedHead : slot === "CHEST" ? worn.equippedChest : slot === "FEET" ? worn.equippedFeet : "") ?? "";
}

/** The stat a piece is judged by, in percent at `level`: damage, regen, max health, or its boots' own stat. */
function slotStat(itemId: string, level: ItemLevel, bootStat?: "moveSpeed" | "armor" | "skillChance") {
  const slot = itemDefinition(itemId)?.slot;
  if (slot === "HAND") return { label: "Damage", value: itemDamageMultiplierBonus(itemId, level) * 100 };
  if (slot === "HEAD") return { label: "Regen", value: itemRegenerationMultiplierBonus(itemId, level) * 100 };
  if (slot === "CHEST") return { label: "Max Health", value: itemMaxHealthMultiplierBonus(itemId, level) * 100 };
  if (bootStat === "moveSpeed") return { label: "Move Speed", value: (bootMoveSpeedFactor(itemId, level) - 1) * 100 };
  if (bootStat === "armor") return { label: "Armor", value: (bootArmorFactor(itemId, level) - 1) * 100 };
  return { label: "Skill Chance", value: (bootSkillChanceFactor(itemId, level) - 1) * 100 };
}

export type GearComparison = { delta: number; label: string; text: string };

/**
 * What an offer changes against what the player wears in its slot, in points of its stat: "+12% Damage vs Now".
 * The offer arrives unrefined at the slot's tier; the worn piece counts its refine.
 */
export function gearComparison(offerId: GradeItemId, worn: WornLoadout, levels: { tier: number; wornRefine: number }): GearComparison {
  const style = bootStyleOf(offerId), bootStat = style ? BOOT_STYLE_STAT[style] : undefined;
  const offer = slotStat(offerId, { tier: levels.tier, refine: 0 }, bootStat);
  const current = wornInSlot(worn, offerId);
  // Boots of another style, or Black Boots, raise a different stat: no number compares them, so Upgrade All leaves them on.
  if (style && current && bootStyleOf(current) !== style) return { delta: 0, label: offer.label, text: "Different Stat from Now" };
  const now = current ? slotStat(current, { tier: levels.tier, refine: levels.wornRefine }, bootStat).value : 0;
  const delta = Math.round((offer.value - now) * 10) / 10;
  const text = delta === 0 ? "Same as Now" : `${delta > 0 ? "+" : "-"}${Math.abs(delta)}% ${offer.label} vs Now`;
  return { delta, label: offer.label, text };
}

export type UpgradePick = { itemId: GradeItemId; price: number };
export type UpgradePlan = { picks: UpgradePick[]; total: number; next: string };

/**
 * Upgrade All: one piece a line, spread over the lines: the line furthest behind (by the grade it would end on, or
 * holds) goes up a grade while the gold left covers the difference, until no line can. Each pick is open, above the
 * best held on its line and better than what is worn. With nothing to buy, `next` says what comes soonest: the
 * cheapest such upgrade's price, else the Mastery the next grade waits for.
 */
export function upgradeAllPlan(options: {
  lines: readonly GradeShopLine[];
  held: ReadonlySet<string>;
  levels: MasteryLevels;
  gold: number;
  beats: (itemId: GradeItemId) => boolean;
}): UpgradePlan {
  let locked: GradeItemId | null = null;
  // Each line's affordable-in-principle upgrades, cheapest first, and the grade it stands at now.
  const ladders = options.lines.flatMap(line => {
    const offer = gradeShopOffer(line, options.held, options.levels);
    if (offer.owned) return [];
    if (!offer.open) { locked ??= offer.itemId; return []; }
    const better = offer.grades.map(grade => gradeShopItemId(line, grade)).filter(options.beats);
    if (!better.length) { if (offer.next) locked ??= offer.next; return []; }
    return [{ better, chosen: -1, standing: gradeRank(better[0]) - 1 }];
  });
  let left = options.gold;
  for (;;) {
    const steps = ladders
      .filter(ladder => ladder.chosen + 1 < ladder.better.length)
      .map(ladder => {
        const from = ladder.chosen < 0 ? 0 : price(ladder.better[ladder.chosen]);
        return { ladder, cost: price(ladder.better[ladder.chosen + 1]) - from, at: ladder.chosen < 0 ? ladder.standing : gradeRank(ladder.better[ladder.chosen]) };
      })
      .filter(step => step.cost <= left)
      .sort((a, b) => a.at - b.at || a.cost - b.cost);
    const step = steps[0];
    if (!step) break;
    step.ladder.chosen += 1;
    left -= step.cost;
  }
  const picks: UpgradePick[] = ladders.filter(ladder => ladder.chosen >= 0)
    .map(ladder => ({ itemId: ladder.better[ladder.chosen], price: price(ladder.better[ladder.chosen]) }));
  const cheapest = picks.length ? null : ladders.map(ladder => ({ itemId: ladder.better[0], price: price(ladder.better[0]) }))
    .sort((a, b) => a.price - b.price)[0] ?? null;
  const total = picks.reduce((sum, pick) => sum + pick.price, 0);
  const next = cheapest ? `Next: ${gradeShortName(cheapest.itemId)} at ${cheapest.price.toLocaleString("en-US")} Gold`
    : locked ? `Next: ${gradeShortName(locked)} at ${gradeShopNeed(locked)}` : "Top Grade on Every Line";
  return { picks, total, next };
}

const gradeRank = (itemId: GradeItemId) => GEAR_GRADES.indexOf(gradeOf(itemId) as GearGrade);
const price = (itemId: GradeItemId) => GRADE_GOLD_PRICE[gradeOf(itemId) as GearGrade];
