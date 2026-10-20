import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { bagFullFor, craftDepsFor, type CraftSectionDeps } from "./craft-section";
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
/** The Smith with crafting and no shop: a row per line, each its craft line. */
function crafts(deps: CraftSectionDeps) {
  const document = setup();
  const smith = createSmithController({ inTown: () => true, items: () => [], refine: vi.fn(), showMessage: vi.fn(), refineLevel: () => 0, slotTier: () => 0, ores: () => ({}), craft: deps });
  const dialog = document.querySelector(".smith-sheet")! as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  smith.open();
  const row = (line: string) => dialog.querySelector<HTMLElement>(`.smith-shop-row[data-item-id$="_${line}"]`)!;
  const view = (line: string) => {
    const each = row(line);
    return {
      itemId: each.dataset.itemId,
      next: each.querySelector(".craft-next")?.textContent ?? null,
      label: each.querySelector(".craft-label")!.textContent,
      grade: each.querySelector(".craft-grade-name")!.textContent,
      button: each.querySelector(".smith-shop-buy")!.textContent,
      enabled: !each.querySelector<HTMLButtonElement>(".smith-shop-buy")!.disabled,
    };
  };
  const step = (line: string, which: "Lower Grade" | "Higher Grade") => row(line).querySelector<HTMLButtonElement>(`.craft-grade-step[aria-label="${which}"]`)!;
  const skill = (name: CraftSkill) => {
    const item = dialog.querySelector<HTMLElement>(`.craft-skill[data-skill="${name}"]`)!;
    return [item.querySelector(".craft-name")!.textContent, item.querySelector(".craft-level")!.textContent, item.querySelector(".craft-points")!.textContent];
  };
  return { smith, dialog, row, view, step, skill, rows: () => [...dialog.querySelectorAll<HTMLElement>(".smith-shop-row")] };
}

it("offers each line's best open grade by its craft's level, steps to any other, and names what the button makes", () => {
  const state: State = {
    experience: { fletching: BigInt(craftExperienceForLevel(10)) }, ores: plenty(), levels: { archery: 5 },
    held: ["crude_bow", "common_bow", "superior_light_helmet", "fine_light_armor"], full: false,
  };
  const view = crafts(craftDeps(state).deps);
  const next = "Superior needs Fletching Lv 15";
  expect(["bow", "light_helmet", "light_armor", "ranger_boots"].map(view.view)).toEqual([
    { itemId: "fine_bow", next, label: "Craft", grade: "Fine", button: "Craft Fine Bow ★2", enabled: true },
    // Below the best held is open to craft, for the craft's level.
    { itemId: "fine_light_helmet", next, label: "Craft", grade: "Fine", button: "Craft Fine Helmet ★2", enabled: true },
    { itemId: "fine_light_armor", next, label: "Craft", grade: "Fine", button: "Owned", enabled: false },
    { itemId: "fine_ranger_boots", next, label: "Craft", grade: "Fine", button: "Craft Fine Boots ★2", enabled: true },
  ]);
  // The row names nothing the craft line already says.
  expect(view.row("bow").querySelector(".craft-needs")).toBeNull();
  // Each line goes by its own craft: Smithing at level 1 opens only Crude.
  expect(view.view("sword")).toMatchObject({ itemId: "crude_sword", next: "Common needs Smithing Lv 3", button: "Craft Crude Sword ★2" });
  expect(view.step("bow", "Higher Grade").disabled).toBe(true);
  // Down to a bow already held: Reforge, which rolls its skills again.
  view.step("bow", "Lower Grade").click();
  view.step("bow", "Lower Grade").click();
  expect(view.view("bow")).toMatchObject({ itemId: "common_bow", grade: "Common", button: "Reforge Your Common Bow", enabled: true });
  expect(view.row("bow").querySelector(".craft-hint")!.textContent).toBe("Re-roll its skills, keeping the better roll");
  view.step("bow", "Lower Grade").click();
  expect([view.view("bow").itemId, view.step("bow", "Lower Grade").disabled]).toEqual(["crude_bow", true]);
  // Short of a material, then a full bag: a Reforge needs no room.
  state.ores = { pine_log: 10_000, copper_ore: 1 };
  view.smith.render();
  expect([view.view("light_helmet").button, view.view("bow").button]).toEqual(["Need More For Fine Helmet", "Need More To Reforge"]);
  state.ores = plenty(); state.full = true;
  view.smith.render();
  expect(["bow", "light_helmet", "light_armor", "ranger_boots"].map(line => view.view(line).button))
    .toEqual(["Reforge Your Crude Bow", "Bag Full", "Owned", "Bag Full"]);
  // Mastery plays no part: none at all leaves every grade the craft opens.
  state.levels = {};
  state.full = false;
  view.smith.render();
  expect(["bow", "light_helmet", "light_armor", "ranger_boots"].map(line => view.view(line).itemId))
    .toEqual(["crude_bow", "fine_light_helmet", "fine_light_armor", "fine_ranger_boots"]);
});

it("shows each material held against needed, and every craft's level and progress side by side", () => {
  const state: State = { experience: { enchanting: 200n, smithing: BigInt(craftExperienceForLevel(99)) }, ores: { pine_log: 4, arcane_crystal: 9 }, levels: {}, held: [], full: false };
  const view = crafts(craftDeps(state).deps);
  const staff = view.row("staff");
  const materials = [...staff.querySelectorAll<HTMLElement>(".craft-material")].map(item => [item.dataset.material, item.textContent, item.classList.contains("is-short")]);
  // Enchanting 9 opens Sturdy, Mastery or not.
  expect(view.view("staff")).toMatchObject({ itemId: "sturdy_staff", next: "Fine needs Enchanting Lv 10" });
  expect(materials).toEqual([["pine_log", "4 / 9 Pine Log", true], ["arcane_crystal", "9 / 2 Arcane Crystal", false]]);
  expect(view.skill("smithing")).toEqual(["Smithing", "Lv 99 · Max", "Max Level"]);
  expect(view.skill("fletching")).toEqual(["Fletching", "Lv 1", `0 / ${craftExperienceForLevel(2)}`]);
  expect(view.skill("enchanting")).toEqual(["Enchanting", "Lv 9", "23 / 87"]);
  const bar = view.dialog.querySelector('.craft-skill[data-skill="enchanting"] .craft-bar')!;
  expect([bar.getAttribute("role"), bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax"), bar.getAttribute("aria-label")])
    .toEqual(["progressbar", "23", "87", "Enchanting progress"]);
});

it("crafts, shows Crafting… meanwhile, and turns the line to Reforge before the server's row arrives", async () => {
  const state: State = { experience: {}, ores: plenty(), levels: {}, held: [], full: false };
  let finish: (value: { ok: boolean; error?: string }) => void = () => undefined;
  const craft = vi.fn((_itemId: string) => new Promise<{ ok: boolean; error?: string }>(resolve => { finish = resolve; }));
  const { deps, showMessage } = craftDeps(state, craft);
  const view = crafts(deps);
  const sword = () => view.row("sword").querySelector<HTMLButtonElement>(".smith-shop-buy")!;
  sword().click();
  expect(craft).toHaveBeenCalledWith("crude_sword");
  expect(sword().textContent).toBe("Crafting…");
  expect(view.rows().every(row => row.querySelector<HTMLButtonElement>(".smith-shop-buy")!.disabled)).toBe(true);
  finish({ ok: true });
  await vi.waitFor(() => expect(showMessage).toHaveBeenCalledWith(`Crafted · ${nameOf("crude_sword")} ★2. Equip it from your bag.`, "#ffd75e"));
  expect(sword().textContent).toBe("Reforge Your Crude Sword");
  sword().click();
  expect(sword().textContent).toBe("Reforging…");
  finish({ ok: true });
  await vi.waitFor(() => expect(showMessage).toHaveBeenLastCalledWith(`Reforged · ${nameOf("crude_sword")}. Each skill kept the higher roll.`, "#ffd75e"));
  // A refusal is shown and leaves the row as it was.
  sword().click();
  finish({ ok: false, error: "Talk to the Smith first." });
  await vi.waitFor(() => expect(showMessage).toHaveBeenLastCalledWith("Talk to the Smith first.", "#ff9b91"));
  expect(sword().textContent).toBe("Reforge Your Crude Sword");
});

it("crafts every line at the Smith, and nothing at the schools: they keep Mastery only", () => {
  const state: State = { experience: {}, ores: plenty(), levels: {}, held: [], full: false };
  const view = crafts(craftDeps(state).deps);
  expect(view.rows().map(row => row.dataset.itemId)).toEqual([
    "crude_bow", "crude_sword", "crude_staff", "crude_light_helmet", "crude_light_armor", "crude_medium_helmet", "crude_medium_armor",
    "crude_heavy_helmet", "crude_heavy_armor", "crude_magic_helmet", "crude_magic_armor", "crude_ranger_boots", "crude_warrior_boots", "crude_mystic_boots",
  ]);
  expect(view.rows().every(row => row.querySelector(".craft-offer .smith-shop-buy")!.textContent!.match(/^Craft Crude (Bow|Sword|Staff|Helmet|Armor|Boots) ★2$/))).toBe(true);
  expect(view.dialog.querySelector(".craft-hint")).toBeNull();
  const document = view.dialog.ownerDocument;
  const school = createSchoolWindowController({ inTown: () => true, points: () => ({}) });
  const dialog = document.querySelector(".school-window")! as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  for (const each of ["archery", "swordplay", "sorcery"] as const) {
    school.open(each);
    expect([dialog.querySelector(".craft-section"), dialog.querySelector(".smith-views"), dialog.querySelector(".smith-shop-row")]).toEqual([null, null, null]);
    expect(dialog.querySelector(".school-window-techniques")).toBeTruthy();
  }
  school.close();
});

it("reads the coop session for the Smith's crafting: skills, Mastery, the bench's pieces and the bag as the server counts it", async () => {
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
