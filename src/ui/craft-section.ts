import { itemDisplayName, itemStats } from "../../shared/items";
import { CRAFTED_REFINE, CRAFT_MAX_LEVEL, CRAFT_SKILL_NAMES, MATERIAL_NAMES, type CraftSkill } from "../../shared/crafting";
import {
  CRAFT_LINES, craftMaterialsShort, craftProgress, gradeCraftAction, gradeCraftLevel, gradeCraftMaterials, gradeCraftNeed, gradeCraftOffer, gradeCraftSkill,
  type GradeCraftAction,
} from "../../shared/grade-craft";
import { ARMOR_CLASS_DETAILS, ARMOR_CLASS_NAMES, GEAR_GRADE_NAMES, GRADE_MASTERY_LEVEL, type GearGrade } from "../../shared/gear-grades";
import { armorClassOf, gradeEquipmentKindOf, gradeOf, type GradeItemId } from "../../shared/grade-equipment";
import { gradeShopItemId, gradeShopNeed, gradeShopOpen, masteryLevels, type GradeShopLine, type MasteryLevels } from "../../shared/grade-shop";
import { bagSlotsWithOres } from "../../shared/ore-bag";
import { bagSlotCapacity } from "../../shared/gems";
import type { OreId } from "../../shared/refine";
import { SCHOOL_DETAILS, type WeaponSchool } from "../../shared/weapon-mastery";
import { itemArtMarkup } from "../game/item-presentation";
import { itemInspectionButtonLabel } from "./item-inspection-controller";
import { formatEquipmentStat } from "./equipment-stat-format";
import { refineStars } from "./refine-badge";
import { oreIconSource } from "./ore-icon";

type Result = { ok: boolean; error?: string } | undefined;
type Ores = Readonly<Partial<Record<OreId, number>>>;
/** One thing a piece needs, met or not: "Lv 20 Archery". */
export type GradeNeed = { text: string; met: boolean };
const KIND_NAMES = { bow: "Bow", sword: "Sword", staff: "Staff", helmet: "Helmet", armor: "Armor" } as const;
/** Where each craft is done. */
const CRAFT_STATIONS: Readonly<Record<CraftSkill, string>> = {
  smithing: "The Smith", fletching: `The ${SCHOOL_DETAILS.archery.building}`, enchanting: `The ${SCHOOL_DETAILS.sorcery.building}`,
};
const nameOf = (itemId: string) => itemInspectionButtonLabel(itemDisplayName(itemId));
const count = (value: number) => Math.floor(value).toLocaleString("en-US");

/** Where a piece is crafted: "Craft At The Archery Range". */
export function craftStationHint(itemId: GradeItemId) {
  const skill = gradeCraftSkill(itemId);
  return skill ? `Craft At ${CRAFT_STATIONS[skill]}` : "";
}

/** The Mastery a piece's grade needs, or none at Common. */
export function masteryNeed(itemId: GradeItemId, levels: MasteryLevels): GradeNeed[] {
  return GRADE_MASTERY_LEVEL[gradeOf(itemId)!] > 0 ? [{ text: gradeShopNeed(itemId), met: gradeShopOpen(itemId, levels) }] : [];
}

/** What an offer works toward, muted: "Next: Heroic at Lv 8 Archery". None past the top grade. */
export function nextNeed(next: GradeItemId | undefined, needs: (itemId: GradeItemId) => readonly GradeNeed[]): GradeNeed[] {
  if (!next) return [];
  const unmet = needs(next).filter(need => !need.met).map(need => need.text);
  return unmet.length ? [{ text: `Next: ${GEAR_GRADE_NAMES[gradeOf(next)!]} at ${unmet.join(" · ")}`, met: true }] : [];
}

/**
 * A graded piece's row as the Smith and the stations list it: art, then its name on a line of its own, grade and
 * kind, stat and class perk, and what it needs. The caller fills the deal under it, one line per way to get it.
 */
export function gradeItemRow(itemId: GradeItemId, refine = 0, needs: readonly GradeNeed[] = []) {
  const row = document.createElement("article");
  row.className = "smith-shop-row";
  row.setAttribute("role", "listitem");
  row.dataset.itemId = itemId;
  const armorClass = armorClassOf(itemId), kind = KIND_NAMES[gradeEquipmentKindOf(itemId)!];
  row.innerHTML = `<span class="smith-shop-art" aria-hidden="true">${itemArtMarkup(itemId)}</span>`
    + `<span class="smith-shop-copy"><strong></strong><span class="smith-shop-grade"></span><span class="smith-shop-stat"></span></span>`
    + `<div class="smith-shop-deal"></div>`;
  row.querySelector("strong")!.textContent = `${nameOf(itemId)} ${refineStars(refine)}`.trim();
  row.querySelector(".smith-shop-grade")!.textContent = `${GEAR_GRADE_NAMES[gradeOf(itemId)!]} · ${armorClass ? `${ARMOR_CLASS_NAMES[armorClass]} ${kind}` : kind}`;
  const [stat] = itemStats(itemId, refine ? { tier: 0, refine } : 0);
  row.querySelector(".smith-shop-stat")!.textContent = [formatEquipmentStat(itemInspectionButtonLabel(stat ?? "")), armorClass ? ARMOR_CLASS_DETAILS[armorClass].perk : ""]
    .filter(Boolean).join(" · ");
  if (needs.length) {
    // Unmet needs stand out; met ones step back.
    const line = document.createElement("span");
    line.className = "craft-needs";
    needs.forEach((need, index) => {
      if (index) line.append(" · ");
      const part = document.createElement("span");
      part.className = need.met ? "is-met" : "is-unmet";
      part.textContent = need.text;
      line.append(part);
    });
    row.querySelector(".smith-shop-copy")!.append(line);
  }
  return { row, deal: row.querySelector<HTMLElement>(".smith-shop-deal")! };
}

/** Steps through the open grades, lowest to best; two buttons big enough for a thumb. Shared by craft and shop rows. */
export function gradeStepperElement(grades: readonly GearGrade[], grade: GearGrade,
  options: { label: string; busy: boolean; name?: string; onPick: (grade: GearGrade) => void }) {
  const group = document.createElement("span");
  group.className = "craft-grade";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", options.label);
  const at = grades.indexOf(grade);
  const step = (by: number, symbol: string, label: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "craft-grade-step";
    button.textContent = symbol;
    button.setAttribute("aria-label", label);
    const to = grades[at + by];
    button.disabled = !to || options.busy;
    button.addEventListener("click", () => { if (to) options.onPick(to); });
    return button;
  };
  const name = document.createElement("span");
  name.className = "craft-grade-name";
  name.textContent = options.name ?? GEAR_GRADE_NAMES[grade];
  group.append(step(-1, "‹", "Lower Grade"), name, step(1, "›", "Higher Grade"));
  return group;
}

/** The top grade, already held: its row says Owned in place of a price. */
export function ownedRow(itemId: GradeItemId) {
  const made = gradeItemRow(itemId);
  const owned = document.createElement("span");
  owned.className = "smith-shop-owned";
  owned.textContent = "Owned";
  made.row.querySelector(".smith-shop-copy")!.append(owned);
  return made;
}

/** One way to get a piece: its terms (a price, materials) on the left, its button on the right. */
export function offerLine(terms: readonly Node[], button: HTMLButtonElement) {
  const line = document.createElement("div");
  line.className = "smith-offer";
  const left = document.createElement("span");
  left.className = "smith-offer-terms";
  left.append(...terms);
  line.append(left, button);
  return line;
}

export function offerButton(text: string, enabled: boolean, onClick: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "farm-start smith-refine smith-shop-buy";
  button.textContent = text;
  button.disabled = !enabled;
  button.addEventListener("click", onClick);
  return button;
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
 * A station's Craft section: the craft's level and progress in a card, then a row per line it makes, offering the
 * best grade Mastery and the craft's level open, with a stepper to pick any other open grade (gradeCraftOffer), its
 * materials and a button: Craft for a new piece, Reforge for a weapon already held, Owned for armor already held.
 * The Smith lists no rows of its own: his shop rows take each line's craft line (craftLine). The server decides
 * (craft_grade_gear).
 */
export function createCraftSection(deps: CraftSectionDeps, options: { rows?: boolean; onChange?: () => void } = {}) {
  const listsRows = options.rows ?? true;
  const section = document.createElement("section");
  section.className = "smith-shop craft-section";
  section.setAttribute("aria-label", "Craft");
  section.innerHTML = (listsRows ? `<h3 class="craft-title">Craft</h3>` : "")
    + `<div class="craft-card"><div class="craft-head"><strong class="craft-name"></strong><span class="craft-level"></span></div>`
    + `<div class="craft-bar" role="progressbar" aria-valuemin="0"><span></span></div><span class="craft-points"></span>`
    + `<p class="craft-note">Crafted gear starts at ${refineStars(CRAFTED_REFINE)}, and a crafted weapon rolls its skills with more luck. Reforge a weapon you have to roll its skills again.</p></div>`
    + (listsRows ? `<div class="smith-shop-rows craft-rows" role="list" aria-label="Gear to craft"></div>` : "");
  const nameText = section.querySelector<HTMLElement>(".craft-name")!, levelText = section.querySelector<HTMLElement>(".craft-level")!;
  const bar = section.querySelector<HTMLElement>(".craft-bar")!, fill = section.querySelector<HTMLElement>(".craft-bar span")!;
  const points = section.querySelector<HTMLElement>(".craft-points")!, rows = section.querySelector<HTMLElement>(".craft-rows");
  let skill: CraftSkill | null = null, crafting: string | null = null, rendered = "";
  /** Crafted here before the server's row arrives. */
  const justCrafted = new Set<string>();
  /** The grade picked on each line; the best open one until the player steps. */
  const picked = new Map<string, GearGrade>();
  const lineKey = (line: GradeShopLine) => `${line.kind}:${"armorClass" in line ? line.armorClass : ""}`;

  const held = () => new Set([...deps.heldItems(), ...justCrafted]);

  function state() {
    return JSON.stringify([skill, String(skill ? deps.craftSkills()[skill] ?? 0n : 0n), deps.ores(), deps.masteryLevels(),
      [...held()].filter(id => gradeOf(id)), deps.bagFull(), crafting, [...picked]]);
  }

  function render(which: CraftSkill | null = skill) {
    skill = which;
    section.hidden = !skill;
    if (!skill) return;
    const now = state();
    if (now === rendered) return;
    rendered = now;
    const { level, into, needed } = craftProgress(deps.craftSkills()[skill] ?? 0n), max = level >= CRAFT_MAX_LEVEL, name = CRAFT_SKILL_NAMES[skill];
    nameText.textContent = name;
    levelText.textContent = max ? `Lv ${level} · Max` : `Lv ${level}`;
    bar.setAttribute("aria-label", `${name} progress`);
    bar.setAttribute("aria-valuemax", String(max ? 1 : needed));
    bar.setAttribute("aria-valuenow", String(max ? 1 : into));
    fill.style.width = `${Math.round((max ? 1 : needed > 0 ? Math.min(1, into / needed) : 0) * 1000) / 10}%`;
    points.textContent = max ? "Max Level" : `${count(into)} / ${count(needed)}`;
    if (!rows) return;
    const owned = held();
    rows.replaceChildren(...CRAFT_LINES[skill].map(line => {
      const made = craftLine(line, owned, { stars: false })!;
      // A new piece shows at the refine it arrives with.
      const { row, deal } = gradeItemRow(made.itemId, made.action === "craft" ? CRAFTED_REFINE : 0, nextNeed(made.next, needsOf));
      deal.append(made.line);
      return row;
    }));
  }

  const skillLevel = () => skill ? craftProgress(deps.craftSkills()[skill] ?? 0n).level : 1;
  /** What a piece needs of this craft and of Mastery, met or not. */
  const needsOf = (itemId: GradeItemId): GradeNeed[] =>
    [{ text: gradeCraftNeed(itemId), met: skillLevel() >= gradeCraftLevel(itemId) }, ...masteryNeed(itemId, deps.masteryLevels())];

  /**
   * A line's craft line, at the grade picked (or the best open): a grade stepper, the materials held against
   * needed, and a button that says what it does or why it waits. ★2 follows the grade where the row's name does
   * not say so. None for a line this station does not make.
   */
  function craftLine(line: GradeShopLine, owned = held(), options: { stars?: boolean } = {}) {
    if (!skill || !CRAFT_LINES[skill].includes(line)) return null;
    const offer = gradeCraftOffer(line, deps.masteryLevels(), skillLevel()), choice = picked.get(lineKey(line));
    const grade = choice && offer.grades.includes(choice) ? choice : offer.grade, itemId = gradeShopItemId(line, grade);
    const action = gradeCraftAction(itemId, owned), ores = deps.ores(), materials = gradeCraftMaterials(itemId)!;
    const text = crafting === itemId ? (action === "reforge" ? "Reforging…" : "Crafting…") : action === "owned" ? "Owned"
      : craftMaterialsShort(materials, ores).length ? "Need More" : action === "craft" && deps.bagFull() ? "Bag Full"
        : action === "reforge" ? "Reforge" : "Craft";
    const button = offerButton(text, (text === "Craft" || text === "Reforge") && crafting === null, () => { void craft(itemId, action); });
    const terms: Node[] = [gradeStepper(line, offer.grades, grade, options.stars !== false && action === "craft"), materialList(materials, ores)];
    if (action === "reforge") terms.push(hint("Rolls its skills again, keeping the higher"));
    const element = offerLine(terms, button);
    element.classList.add("craft-offer");
    return { itemId, action, next: offer.next, line: element };
  }

  function gradeStepper(line: GradeShopLine, grades: readonly GearGrade[], grade: GearGrade, stars: boolean) {
    return gradeStepperElement(grades, grade, {
      label: "Grade to craft", busy: crafting !== null, name: stars ? `${GEAR_GRADE_NAMES[grade]} ${refineStars(CRAFTED_REFINE)}` : GEAR_GRADE_NAMES[grade],
      onPick: to => { picked.set(lineKey(line), to); changed(); },
    });
  }

  function materialList(materials: Readonly<Record<string, number>>, ores: Ores) {
    const list = document.createElement("ul");
    list.className = "craft-materials";
    list.setAttribute("aria-label", "Materials");
    list.append(...Object.entries(materials).map(([id, needCount]) => {
      const item = document.createElement("li"), have = ores[id as OreId] ?? 0;
      item.className = have >= needCount ? "craft-material" : "craft-material is-short";
      item.dataset.material = id;
      const icon = document.createElement("span");
      icon.className = "craft-material-icon";
      icon.setAttribute("aria-hidden", "true");
      const source = oreIconSource(id as OreId);
      if (source) icon.style.backgroundImage = `url(${source})`;
      const label = document.createElement("span");
      label.textContent = `${count(have)} / ${count(needCount)} ${MATERIAL_NAMES[id] ?? id}`;
      item.append(icon, label);
      return item;
    }));
    return list;
  }

  async function craft(itemId: GradeItemId, action: GradeCraftAction) {
    if (crafting) return;
    crafting = itemId;
    changed();
    try {
      const result = await deps.craft(itemId);
      if (result?.ok) {
        justCrafted.add(itemId);
        deps.showMessage(action === "reforge" ? `Reforged · ${nameOf(itemId)}. Each skill kept the higher roll.`
          : `Crafted · ${nameOf(itemId)} ${refineStars(CRAFTED_REFINE)}. Equip it from your bag.`, "#ffd75e");
      } else deps.showMessage(result?.error ?? "Not Connected", "#ff9b91");
    } finally {
      crafting = null;
      changed();
    }
  }

  function changed() {
    render();
    options.onChange?.();
  }

  return {
    element: section,
    render,
    craftLine,
    needsOf,
    /** What the rows show, for a window that lists them itself. */
    state,
    /** Pieces crafted here whose rows have not arrived yet. */
    crafted: () => [...justCrafted],
    /** Each visit goes by the server's word on the bag, and starts at each line's best grade. */
    reset() { justCrafted.clear(); picked.clear(); rendered = ""; },
  };
}

/** A short muted line of its own under an offer's terms. */
function hint(text: string) {
  const line = document.createElement("span");
  line.className = "craft-hint";
  line.textContent = text;
  return line;
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
