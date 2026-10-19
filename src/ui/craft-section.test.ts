import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { bagFullFor, craftDepsFor, createCraftSection, type CraftSectionDeps } from "./craft-section";
import { createSchoolWindowController } from "./school-window";
import { createSmithController } from "./smith-window";
import { craftExperienceForLevel, type CraftSkill } from "../../shared/crafting";
import type { MasteryLevels } from "../../shared/grade-shop";
import { GRADE_EQUIPMENT_IDS } from "../../shared/grade-equipment";
import { itemDisplayName } from "../../shared/items";
import { itemInspectionButtonLabel } from "./item-inspection-controller";
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
const nameOf = (itemId: string) => itemInspectionButtonLabel(itemDisplayName(itemId));
const plenty = () => Object.fromEntries(["copper_ore", "iron_ore", "mithril_ore", "pine_log", "oak_log", "arcane_crystal"].map(id => [id, 10_000]));
const rowsOf = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(".craft-rows .smith-shop-row")].map(row => ({
  itemId: row.dataset.itemId,
  name: row.querySelector("strong")!.textContent,
  needs: row.querySelector(".craft-needs")?.textContent ?? null,
  unmet: [...row.querySelectorAll(".craft-needs .is-unmet")].map(need => need.textContent).join(" · "),
  grade: row.querySelector(".craft-grade-name")!.textContent,
  button: row.querySelector(".smith-shop-buy")!.textContent,
  enabled: !row.querySelector<HTMLButtonElement>(".smith-shop-buy")!.disabled,
}));
const step = (root: ParentNode, index: number, which: "Lower Grade" | "Higher Grade") =>
  root.querySelectorAll(".craft-rows .smith-shop-row")[index].querySelector<HTMLButtonElement>(`.craft-grade-step[aria-label="${which}"]`)!;

it("offers each line's best open grade, steps to any other, and says Craft, Reforge or Owned", () => {
  setup();
  const state: State = {
    experience: { fletching: BigInt(craftExperienceForLevel(10)) }, ores: plenty(), levels: { archery: 5 },
    held: ["crude_bow", "common_bow", "superior_light_helmet", "fine_light_armor"], full: false,
  };
  const section = createCraftSection(craftDeps(state).deps);
  section.render("fletching");
  expect(section.element.querySelector(".craft-name")!.textContent).toBe("Fletching");
  expect(section.element.querySelector(".craft-level")!.textContent).toBe("Lv 10");
  const next = "Next: Superior at Lv 15 Fletching";
  expect(rowsOf(section.element)).toEqual([
    { itemId: "fine_bow", name: `${nameOf("fine_bow")} ★2`, needs: next, unmet: "", grade: "Fine", button: "Craft", enabled: true },
    // Below the best held is open to craft, for the craft's level.
    { itemId: "fine_light_helmet", name: `${nameOf("fine_light_helmet")} ★2`, needs: next, unmet: "", grade: "Fine", button: "Craft", enabled: true },
    { itemId: "fine_light_armor", name: nameOf("fine_light_armor"), needs: next, unmet: "", grade: "Fine", button: "Owned", enabled: false },
    { itemId: "fine_ranger_boots", name: `${nameOf("fine_ranger_boots")} ★2`, needs: next, unmet: "", grade: "Fine", button: "Craft", enabled: true },
  ]);
  expect(step(section.element, 0, "Higher Grade").disabled).toBe(true);
  // Down to a bow already held: Reforge, which rolls its skills again.
  step(section.element, 0, "Lower Grade").click();
  step(section.element, 0, "Lower Grade").click();
  expect(rowsOf(section.element)[0]).toMatchObject({ itemId: "common_bow", name: nameOf("common_bow"), grade: "Common", button: "Reforge", enabled: true });
  expect(section.element.querySelector(".craft-rows .smith-shop-row .craft-hint")!.textContent).toBe("Rolls its skills again, keeping the higher");
  step(section.element, 0, "Lower Grade").click();
  expect([rowsOf(section.element)[0].itemId, step(section.element, 0, "Lower Grade").disabled]).toEqual(["crude_bow", true]);
  // Short of a material, then a full bag: a Reforge needs no room.
  state.ores = { pine_log: 10_000, copper_ore: 1 };
  section.render();
  expect(rowsOf(section.element)[1].button).toBe("Need More");
  state.ores = plenty(); state.full = true;
  section.render();
  expect(rowsOf(section.element).map(row => row.button)).toEqual(["Reforge", "Bag Full", "Owned", "Bag Full"]);
  // A grade Mastery no longer opens falls back to the best open.
  state.levels = { archery: 0 };
  state.full = false;
  section.render();
  expect(rowsOf(section.element).map(row => row.itemId)).toEqual(["crude_bow", "crude_light_helmet", "crude_light_armor", "crude_ranger_boots"]);
  section.reset();
});

it("shows each material held against needed, and the craft's progress", () => {
  setup();
  const state: State = { experience: { enchanting: 200n }, ores: { pine_log: 4, arcane_crystal: 9 }, levels: {}, held: [], full: false };
  const section = createCraftSection(craftDeps(state).deps);
  section.render("enchanting");
  const staff = section.element.querySelector<HTMLElement>('[data-item-id="crude_staff"]')!;
  const materials = [...staff.querySelectorAll<HTMLElement>(".craft-material")].map(item => [item.dataset.material, item.textContent, item.classList.contains("is-short")]);
  expect(materials).toEqual([["pine_log", "4 / 5 Pine Log", true], ["arcane_crystal", "9 / 1 Arcane Crystal", false]]);
  // The name carries ★2 here; the Smith's rows put it on the craft line.
  expect(staff.querySelector(".craft-stars")).toBeNull();
  expect(section.element.querySelector(".craft-level")!.textContent).toBe("Lv 9");
  expect(section.element.querySelector(".craft-points")!.textContent).toBe("23 / 87");
  const bar = section.element.querySelector(".craft-bar")!;
  expect([bar.getAttribute("role"), bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual(["progressbar", "23", "87"]);
});

it("crafts, shows Crafting… meanwhile, and turns the line to Reforge before the server's row arrives", async () => {
  setup();
  const state: State = { experience: {}, ores: plenty(), levels: {}, held: [], full: false };
  let finish: (value: { ok: boolean; error?: string }) => void = () => undefined;
  const craft = vi.fn((_itemId: string) => new Promise<{ ok: boolean; error?: string }>(resolve => { finish = resolve; }));
  const { deps, showMessage } = craftDeps(state, craft);
  const section = createCraftSection(deps);
  section.render("smithing");
  const sword = () => section.element.querySelector<HTMLButtonElement>('[data-item-id$="_sword"] .smith-shop-buy')!;
  sword().click();
  expect(craft).toHaveBeenCalledWith("crude_sword");
  expect(sword().textContent).toBe("Crafting…");
  expect(rowsOf(section.element).every(row => !row.enabled)).toBe(true);
  finish({ ok: true });
  await vi.waitFor(() => expect(showMessage).toHaveBeenCalledWith(`Crafted · ${nameOf("crude_sword")} ★2. Equip it from your bag.`, "#ffd75e"));
  expect(sword().textContent).toBe("Reforge");
  sword().click();
  expect(sword().textContent).toBe("Reforging…");
  finish({ ok: true });
  await vi.waitFor(() => expect(showMessage).toHaveBeenLastCalledWith(`Reforged · ${nameOf("crude_sword")}. Each skill kept the higher roll.`, "#ffd75e"));
  // A refusal is shown and leaves the row as it was.
  sword().click();
  finish({ ok: false, error: "Talk to the Smith first." });
  await vi.waitFor(() => expect(showMessage).toHaveBeenLastCalledWith("Talk to the Smith first.", "#ff9b91"));
  expect(sword().textContent).toBe("Reforge");
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
  expect(smithRows.map(row => row.dataset.itemId)).toEqual(["crude_sword", "crude_medium_helmet", "crude_medium_armor", "crude_heavy_helmet", "crude_heavy_armor", "crude_warrior_boots"]);
  expect(smithRows.every(row => row.querySelector(".craft-offer .smith-shop-buy")!.textContent === "Craft")).toBe(true);
  const school = createSchoolWindowController({ inTown: () => true, points: () => ({}), craft: craftDeps(state).deps });
  const dialog = document.querySelector(".school-window")! as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  school.open("archery");
  expect(rowsOf(dialog).map(row => row.itemId)).toEqual(["crude_bow", "crude_light_helmet", "crude_light_armor", "crude_ranger_boots"]);
  school.open("swordplay");
  expect(dialog.querySelector<HTMLElement>(".craft-section")!.hidden).toBe(true);
  school.open("sorcery");
  expect(dialog.querySelector<HTMLElement>(".craft-section")!.hidden).toBe(false);
  expect(rowsOf(dialog).map(row => row.itemId)).toEqual(["crude_staff", "crude_magic_helmet", "crude_magic_armor", "crude_mystic_boots"]);
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
