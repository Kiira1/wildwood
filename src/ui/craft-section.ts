import { itemDisplayName, itemStats } from "../../shared/items";
import { CRAFTED_REFINE, CRAFT_MAX_LEVEL, CRAFT_SKILL_NAMES, MATERIAL_NAMES, type CraftSkill } from "../../shared/crafting";
import { CRAFT_LINES, craftMaterialsShort, craftProgress, gradeCraftLevel, gradeCraftMaterials, gradeCraftNeed } from "../../shared/grade-craft";
import { ARMOR_CLASS_DETAILS, ARMOR_CLASS_NAMES, GEAR_GRADE_NAMES, GRADE_MASTERY_LEVEL } from "../../shared/gear-grades";
import { armorClassOf, gradeEquipmentKindOf, gradeOf, type GradeItemId } from "../../shared/grade-equipment";
import { gradeShopNeed, gradeShopOffer, gradeShopOpen, masteryLevels, type MasteryLevels } from "../../shared/grade-shop";
import { bagSlotsWithOres } from "../../shared/ore-bag";
import { bagSlotCapacity } from "../../shared/gems";
import type { OreId } from "../../shared/refine";
import type { WeaponSchool } from "../../shared/weapon-mastery";
import { itemArtMarkup } from "../game/item-presentation";
import { itemInspectionButtonLabel } from "./item-inspection-controller";
import { formatEquipmentStat } from "./equipment-stat-format";
import { refineStars } from "./refine-badge";
import { oreIconSource } from "./ore-icon";

type Result = { ok: boolean; error?: string } | undefined;
type Ores = Readonly<Partial<Record<OreId, number>>>;
const KIND_NAMES = { bow: "Bow", sword: "Sword", staff: "Staff", helmet: "Helmet", armor: "Armor" } as const;
const nameOf = (itemId: string) => itemInspectionButtonLabel(itemDisplayName(itemId));
const count = (value: number) => Math.floor(value).toLocaleString("en-US");

/** A graded piece's row as the Smith's shop lists it: art, name, grade and kind, stat; the caller fills the deal. */
export function gradeItemRow(itemId: GradeItemId, refine = 0) {
  const row = document.createElement("article");
  row.className = "smith-shop-row";
  row.setAttribute("role", "listitem");
  row.dataset.itemId = itemId;
  const armorClass = armorClassOf(itemId), kind = KIND_NAMES[gradeEquipmentKindOf(itemId)!];
  row.innerHTML = `<span class="smith-shop-art" aria-hidden="true">${itemArtMarkup(itemId)}</span>`
    + `<span class="smith-shop-copy"><strong></strong><span class="smith-shop-grade"></span><span class="smith-shop-stat"></span></span>`
    + `<span class="smith-shop-deal"></span>`;
  row.querySelector("strong")!.textContent = `${nameOf(itemId)} ${refineStars(refine)}`.trim();
  row.querySelector(".smith-shop-grade")!.textContent = `${GEAR_GRADE_NAMES[gradeOf(itemId)!]} · ${armorClass ? `${ARMOR_CLASS_NAMES[armorClass]} ${kind}` : kind}`;
  const [stat] = itemStats(itemId, refine ? { tier: 0, refine } : 0);
  row.querySelector(".smith-shop-stat")!.textContent = [formatEquipmentStat(itemInspectionButtonLabel(stat ?? "")), armorClass ? ARMOR_CLASS_DETAILS[armorClass].perk : ""]
    .filter(Boolean).join(" · ");
  return { row, deal: row.querySelector<HTMLElement>(".smith-shop-deal")! };
}

export type CraftSectionDeps = {
  craftSkills: () => Readonly<Partial<Record<CraftSkill, bigint>>>;
  ores: () => Ores;
  masteryLevels: () => MasteryLevels;
  /** Every item held, worn or on the Upgrade Bench. */
  heldItems: () => readonly string[];
  bagFull: () => boolean;
  craft: (itemId: string) => Promise<Result>;
  showMessage: (text: string, color: string) => void;
};

/**
 * A station's Craft section: the craft's level and progress, then a row per line it makes, offering the grade after
 * the best one held (as the Smith's shop does) with its materials, needs and a Craft button. The server decides
 * (craft_grade_gear).
 */
export function createCraftSection(deps: CraftSectionDeps) {
  const section = document.createElement("section");
  section.className = "smith-shop craft-section";
  section.setAttribute("aria-label", "Craft");
  section.innerHTML = `<div class="smith-shop-head"><h3>Craft</h3><span class="craft-level"></span></div>`
    + `<div class="craft-bar" role="progressbar" aria-valuemin="0"><span></span></div><span class="craft-points"></span>`
    + `<p class="craft-note">Crafted gear starts at ${refineStars(CRAFTED_REFINE)}, and a crafted weapon rolls its skills with more luck.</p>`
    + `<div class="smith-shop-rows craft-rows" role="list" aria-label="Gear to craft"></div>`;
  const levelText = section.querySelector<HTMLElement>(".craft-level")!;
  const bar = section.querySelector<HTMLElement>(".craft-bar")!, fill = section.querySelector<HTMLElement>(".craft-bar span")!;
  const points = section.querySelector<HTMLElement>(".craft-points")!, rows = section.querySelector<HTMLElement>(".craft-rows")!;
  let skill: CraftSkill | null = null, crafting: string | null = null, rendered = "";
  /** Crafted here before the server's row arrives. */
  const justCrafted = new Set<string>();

  const held = () => new Set([...deps.heldItems(), ...justCrafted]);

  function render(which: CraftSkill | null = skill) {
    skill = which;
    section.hidden = !skill;
    if (!skill) return;
    const experience = deps.craftSkills()[skill] ?? 0n, ores = deps.ores(), levels = deps.masteryLevels(), owned = held(), full = deps.bagFull();
    const state = JSON.stringify([skill, String(experience), ores, levels, [...owned].filter(id => gradeOf(id)), full, crafting]);
    if (state === rendered) return;
    rendered = state;
    const { level, into, needed } = craftProgress(experience), max = level >= CRAFT_MAX_LEVEL, name = CRAFT_SKILL_NAMES[skill];
    levelText.textContent = `${name} Lv ${level}${max ? " · Max" : ""}`;
    bar.setAttribute("aria-label", `${name} progress`);
    bar.setAttribute("aria-valuemax", String(max ? 1 : needed));
    bar.setAttribute("aria-valuenow", String(max ? 1 : into));
    fill.style.width = `${Math.round((max ? 1 : needed > 0 ? Math.min(1, into / needed) : 0) * 1000) / 10}%`;
    points.textContent = max ? "Max Level" : `${count(into)} / ${count(needed)}`;
    rows.replaceChildren(...CRAFT_LINES[skill].map(line => {
      const offer = gradeShopOffer(line, owned), materials = gradeCraftMaterials(offer.itemId)!;
      const short = craftMaterialsShort(materials, ores);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "farm-start smith-refine smith-shop-buy";
      button.textContent = crafting === offer.itemId ? "Crafting…" : offer.owned ? "Owned"
        : !gradeShopOpen(offer.itemId, levels) ? `Need ${gradeShopNeed(offer.itemId)}`
          : level < gradeCraftLevel(offer.itemId) ? `Need ${gradeCraftNeed(offer.itemId)}`
            : short.length ? "Need Materials" : full ? "Bag Full" : "Craft";
      button.disabled = button.textContent !== "Craft" || crafting !== null;
      button.addEventListener("click", () => { void craft(offer.itemId); });
      const { row, deal } = gradeItemRow(offer.itemId, offer.owned ? 0 : CRAFTED_REFINE);
      deal.append(button);
      if (offer.owned) return row;
      // What it takes: the craft level, the Mastery that opens the grade, and each material held against needed.
      const needs = document.createElement("span");
      needs.className = "craft-needs";
      needs.textContent = [gradeCraftNeed(offer.itemId), GRADE_MASTERY_LEVEL[offer.grade] > 0 ? gradeShopNeed(offer.itemId) : ""].filter(Boolean).join(" · ");
      const list = document.createElement("ul");
      list.className = "craft-materials";
      list.setAttribute("aria-label", "Materials");
      list.append(...Object.entries(materials).map(([id, need]) => {
        const item = document.createElement("li"), have = ores[id as OreId] ?? 0;
        item.className = have >= need ? "craft-material" : "craft-material is-short";
        item.dataset.material = id;
        const icon = document.createElement("span");
        icon.className = "craft-material-icon";
        icon.setAttribute("aria-hidden", "true");
        const source = oreIconSource(id as OreId);
        if (source) icon.style.backgroundImage = `url(${source})`;
        const text = document.createElement("span");
        text.textContent = `${count(have)} / ${count(need)} ${MATERIAL_NAMES[id] ?? id}`;
        item.append(icon, text);
        return item;
      }));
      row.append(needs, list);
      return row;
    }));
  }

  async function craft(itemId: GradeItemId) {
    if (crafting) return;
    crafting = itemId;
    render();
    try {
      const result = await deps.craft(itemId);
      if (result?.ok) {
        justCrafted.add(itemId);
        deps.showMessage(`Crafted · ${nameOf(itemId)} ${refineStars(CRAFTED_REFINE)}. Equip it from your bag.`, "#ffd75e");
      } else deps.showMessage(result?.error ?? "Not Connected", "#ff9b91");
    } finally {
      crafting = null;
      render();
    }
  }

  return {
    element: section,
    render,
    /** Each visit goes by the server's word on the bag. */
    reset() { justCrafted.clear(); rendered = ""; },
  };
}

/** What a craft section reads from the coop session. */
export type CraftCoop = {
  craftSkills?: () => Readonly<Record<CraftSkill, bigint>>;
  craftGradeGear?: (itemId: string) => Promise<Result>;
  ores?: () => Ores;
  weaponMastery?: () => Readonly<Record<WeaponSchool, bigint>>;
  activeItemUpgrades?: () => readonly { itemId: string }[];
  inventorySlotsUnlocked?: () => number;
  research?: () => { inventorySlots?: number };
  equipmentCopies?: () => readonly { id: bigint; itemId: string }[];
};
export type CraftInventory = { itemIds: string[]; equippedHead: string; equippedChest: string; equippedFeet?: string; equippedRightHand: string; equippedLeftHand: string };

/** Every item held: the bag and worn, and the pieces on the Upgrade Bench. */
export const heldItemsFor = (coop: CraftCoop | null | undefined, inventory: CraftInventory) =>
  [...inventory.itemIds, ...(coop?.activeItemUpgrades?.() ?? []).map(active => active.itemId)];

/** The bag as the server counts it (freeBagSlots): items, kept copies, ore stacks. */
export function bagFullFor(coop: CraftCoop | null | undefined, inventory: CraftInventory) {
  const capacity = bagSlotCapacity(coop?.inventorySlotsUnlocked?.() ?? 0, coop?.research?.().inventorySlots ?? 0);
  const equipped = [inventory.equippedHead, inventory.equippedChest, inventory.equippedFeet ?? "", inventory.equippedRightHand, inventory.equippedLeftHand];
  return bagSlotsWithOres({ owned: inventory.itemIds, equipped, extraCopies: coop?.equipmentCopies?.().length ?? 0, ores: coop?.ores?.() ?? {}, capacity }) >= capacity;
}

/** A craft section's deps from the coop session and the bag. */
export function craftDepsFor(coop: () => CraftCoop | null | undefined, inventory: CraftInventory, showMessage: CraftSectionDeps["showMessage"]): CraftSectionDeps {
  return {
    craftSkills: () => coop()?.craftSkills?.() ?? {},
    ores: () => coop()?.ores?.() ?? {},
    masteryLevels: () => masteryLevels(coop()?.weaponMastery?.() ?? {}),
    heldItems: () => heldItemsFor(coop(), inventory),
    bagFull: () => bagFullFor(coop(), inventory),
    craft: async itemId => coop()?.craftGradeGear?.(itemId) ?? { ok: false, error: "Not Connected" },
    showMessage,
  };
}
