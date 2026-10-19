import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { bagFullFor, craftDepsFor, createCraftSection, type CraftSectionDeps } from "./craft-section";
import { createSchoolWindowController } from "./school-window";
import { createSmithController } from "./smith-window";
import { craftExperienceForLevel, type CraftSkill } from "../../shared/crafting";
import type { MasteryLevels } from "../../shared/grade-shop";
import { GRADE_EQUIPMENT_IDS } from "../../shared/grade-equipment";
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", window.HTMLElement);
  return document;
}

type State = { experience: Partial<Record<CraftSkill, bigint>>; ores: Record<string, number>; levels: MasteryLevels; held: string[]; full: boolean };
function craftDeps(state: State, craft = vi.fn(async (_itemId: string) => ({ ok: true }))) {
  const showMessage = vi.fn();
  const deps: CraftSectionDeps = {
    craftSkills: () => state.experience, ores: () => state.ores, masteryLevels: () => state.levels,
    heldItems: () => state.held, bagFull: () => state.full, craft, showMessage,
  };
  return { deps, craft, showMessage };
}
const plenty = () => Object.fromEntries(["copper_ore", "iron_ore", "mithril_ore", "pine_log", "oak_log", "arcane_crystal"].map(id => [id, 10_000]));
const rowsOf = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(".craft-rows .smith-shop-row")].map(row => ({
  itemId: row.dataset.itemId,
  name: row.querySelector("strong")!.textContent,
  needs: row.querySelector(".craft-needs")?.textContent ?? null,
  unmet: [...row.querySelectorAll(".craft-needs .is-unmet")].map(need => need.textContent).join(" · "),
  button: row.querySelector("button")!.textContent,
  enabled: !row.querySelector("button")!.disabled,
}));

it("lists the craft's lines at the next grade, with what each needs (the unmet marked) and a short button", () => {
  setup();
  const state: State = { experience: { fletching: BigInt(craftExperienceForLevel(10)) }, ores: plenty(), levels: { archery: 10 }, held: ["common_bow", "uncommon_bow", "common_light_helmet"], full: false };
  const section = createCraftSection(craftDeps(state).deps);
  section.render("fletching");
  expect(section.element.querySelector(".craft-name")!.textContent).toBe("Fletching");
  expect(section.element.querySelector(".craft-level")!.textContent).toBe("Lv 10");
  expect(rowsOf(section.element)).toEqual([
    { itemId: "rare_bow", name: "Rare Steel Bow ★2", needs: "Lv 20 Fletching · Lv 10 Archery", unmet: "Lv 20 Fletching", button: "Locked", enabled: false },
    { itemId: "uncommon_light_helmet", name: "Uncommon Ranger Hood ★2", needs: "Lv 10 Fletching · Lv 5 Archery", unmet: "", button: "Craft", enabled: true },
    { itemId: "common_light_armor", name: "Common Ranger Jerkin ★2", needs: "Lv 1 Fletching", unmet: "", button: "Craft", enabled: true },
  ]);
  // Short of Mastery locks it too.
  state.levels = { archery: 4 };
  section.render();
  expect([rowsOf(section.element)[1].button, rowsOf(section.element)[1].unmet]).toEqual(["Locked", "Lv 5 Archery"]);
  // Short of a material, then a full bag.
  state.levels = { archery: 10 };
  state.ores = { pine_log: 10_000, copper_ore: 1 };
  section.render();
  expect(rowsOf(section.element)[2].button).toBe("Need More");
  state.ores = plenty(); state.full = true;
  section.render();
  expect(rowsOf(section.element)[2].button).toBe("Bag Full");
});

it("shows each material held against needed, and the craft's progress", () => {
  setup();
  const state: State = { experience: { enchanting: 200n }, ores: { pine_log: 4, arcane_crystal: 9 }, levels: {}, held: [], full: false };
  const section = createCraftSection(craftDeps(state).deps);
  section.render("enchanting");
  const staff = section.element.querySelector<HTMLElement>('[data-item-id="common_staff"]')!;
  const materials = [...staff.querySelectorAll<HTMLElement>(".craft-material")].map(item => [item.dataset.material, item.textContent, item.classList.contains("is-short")]);
  expect(materials).toEqual([["pine_log", "4 / 10 Pine Log", true], ["arcane_crystal", "9 / 2 Arcane Crystal", false]]);
  // The name carries ★2 here; the Smith's rows put it on the craft line.
  expect(staff.querySelector(".craft-stars")).toBeNull();
  expect(section.element.querySelector(".craft-level")!.textContent).toBe("Lv 9");
  expect(section.element.querySelector(".craft-points")!.textContent).toBe("23 / 87");
  const bar = section.element.querySelector(".craft-bar")!;
  expect([bar.getAttribute("role"), bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual(["progressbar", "23", "87"]);
});

it("crafts, shows Crafting… meanwhile, and moves the line on before the server's row arrives", async () => {
  setup();
  const state: State = { experience: {}, ores: plenty(), levels: {}, held: [], full: false };
  let finish: (value: { ok: boolean; error?: string }) => void = () => undefined;
  const craft = vi.fn((_itemId: string) => new Promise<{ ok: boolean; error?: string }>(resolve => { finish = resolve; }));
  const { deps, showMessage } = craftDeps(state, craft);
  const section = createCraftSection(deps);
  section.render("smithing");
  const sword = () => section.element.querySelector<HTMLButtonElement>('[data-item-id$="_sword"] button')!;
  sword().click();
  expect(craft).toHaveBeenCalledWith("common_sword");
  expect(sword().textContent).toBe("Crafting…");
  expect(rowsOf(section.element).every(row => !row.enabled)).toBe(true);
  finish({ ok: true });
  await vi.waitFor(() => expect(showMessage).toHaveBeenCalledWith("Crafted · Common Iron Blade ★2. Equip it from your bag.", "#ffd75e"));
  expect(section.element.querySelector('[data-item-id$="_sword"]')!.getAttribute("data-item-id")).toBe("uncommon_sword");
  // A refusal is shown and leaves the row as it was.
  sword().click();
  finish({ ok: false, error: "You need Lv 5 Swordplay." });
  await vi.waitFor(() => expect(showMessage).toHaveBeenLastCalledWith("You need Lv 5 Swordplay.", "#ff9b91"));
  expect(sword().textContent).toBe("Locked");
});

it("puts Smithing on the Smith's rows, and Fletching and Enchanting in their schools' windows", () => {
  const document = setup();
  const state: State = { experience: {}, ores: plenty(), levels: {}, held: [], full: false };
  const smith = createSmithController({
    inTown: () => true, items: () => [], refine: vi.fn(), showMessage: vi.fn(), refineLevel: () => 0, slotTier: () => 0, ores: () => ({}),
    craft: craftDeps(state).deps,
  });
  const smithDialog = document.querySelector(".smith-sheet")!;
  Object.assign(smithDialog, { showModal() { smithDialog.setAttribute("open", ""); } });
  smith.open();
  expect(smithDialog.querySelector(".craft-name")!.textContent).toBe("Smithing");
  expect(smithDialog.querySelector(".craft-rows")).toBeNull();
  const smithRows = [...smithDialog.querySelectorAll<HTMLElement>(".smith-shop-row")];
  expect(smithRows.map(row => row.dataset.itemId)).toEqual(["common_sword", "common_medium_helmet", "common_medium_armor", "common_heavy_helmet", "common_heavy_armor"]);
  expect(smithRows.every(row => row.querySelector(".craft-offer button")!.textContent === "Craft")).toBe(true);
  const school = createSchoolWindowController({ inTown: () => true, points: () => ({}), craft: craftDeps(state).deps });
  const dialog = document.querySelector(".school-window")! as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  school.open("archery");
  expect(rowsOf(dialog).map(row => row.itemId)).toEqual(["common_bow", "common_light_helmet", "common_light_armor"]);
  school.open("swordplay");
  expect(dialog.querySelector<HTMLElement>(".craft-section")!.hidden).toBe(true);
  school.open("sorcery");
  expect(dialog.querySelector<HTMLElement>(".craft-section")!.hidden).toBe(false);
  expect(rowsOf(dialog).map(row => row.itemId)).toEqual(["common_staff", "common_magic_helmet", "common_magic_armor"]);
  school.close();
});

it("reads the coop session for a station: skills, Mastery, the bench's pieces and the bag as the server counts it", async () => {
  setup();
  const craftGradeGear = vi.fn(async () => ({ ok: true }));
  const coop = {
    craftSkills: () => ({ smithing: 5n, fletching: 0n, enchanting: 0n }), craftGradeGear, ores: () => ({ copper_ore: 3 }),
    weaponMastery: () => ({ archery: 0n, swordplay: 0n, sorcery: 0n }), activeItemUpgrades: () => [{ itemId: "rare_sword" }],
    inventorySlotsUnlocked: () => 0, research: () => ({}), equipmentCopies: () => [],
  };
  const inventory = { itemIds: ["common_bow"], equippedHead: "", equippedChest: "", equippedRightHand: "common_bow", equippedLeftHand: "" };
  const deps = craftDepsFor(() => coop, inventory, vi.fn());
  expect(deps.craftSkills().smithing).toBe(5n);
  expect(deps.heldItems()).toEqual(["common_bow", "rare_sword"]);
  expect(deps.bagFull()).toBe(false);
  expect(await deps.craft("common_sword")).toEqual({ ok: true });
  expect(craftGradeGear).toHaveBeenCalledWith("common_sword");
  expect(await craftDepsFor(() => null, inventory, vi.fn()).craft("common_sword")).toEqual({ ok: false, error: "Not Connected" });
  expect(bagFullFor(coop, { ...inventory, itemIds: [...GRADE_EQUIPMENT_IDS] })).toBe(true);
});
