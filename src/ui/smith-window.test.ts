import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createSmithController, createSmithRuntime, equipWhenHeld, type SmithItem } from "./smith-window";
import { IRON_BOW, STARTER_BOW, STARTER_STONE, WOODEN_ARMOR, itemDisplayName } from "../../shared/items";
import { GRADE_BONUS_PERCENT, GRADE_GOLD_PRICE } from "../../shared/gear-grades";
import { itemInspectionButtonLabel } from "./item-inspection-controller";
import { refineSuccessChance, type OreId } from "../../shared/refine";
import type { CraftSectionDeps } from "./craft-section";
import { craftExperienceForLevel } from "../../shared/crafting";
import type { WornLoadout } from "./smith-upgrades";
afterEach(() => vi.unstubAllGlobals());

// The server rolls every try (refine_item); the window shows the odds, sends the level the player saw, and shows the verdict.
function smith(options: { inTown?: boolean; ores?: Partial<Record<OreId, number>>; mining?: number; refineLuck?: number; woodcutting?: number } = {}) {
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", window.HTMLElement);
  const levels: Record<string, number> = { [`${STARTER_BOW}:0`]: 7, [`${WOODEN_ARMOR}:0`]: 2 };
  const items: SmithItem[] = [
    { itemId: WOODEN_ARMOR, copyId: 0n, equipped: false },
    { itemId: STARTER_STONE, copyId: 0n, equipped: false },
    { itemId: IRON_BOW, copyId: 4n, equipped: false },
    { itemId: STARTER_BOW, copyId: 0n, equipped: true },
  ];
  const refine = vi.fn(async () => ({ ok: true }));
  const showMessage = vi.fn();
  const controller = createSmithController({
    inTown: () => options.inTown ?? true, items: () => items, refine, showMessage,
    mining: () => options.mining ?? 0, woodcutting: () => options.woodcutting ?? 0,
    refineLevel: (itemId, copyId) => levels[`${itemId}:${copyId}`] ?? 0, slotTier: () => 0,
    ores: () => options.ores ?? { copper_ore: 3 }, refineLuck: () => options.refineLuck ?? 0,
  });
  const dialog = document.querySelector("dialog") as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  const q = (selector: string) => dialog.querySelector(selector) as unknown as HTMLElement;
  const facts = () => Object.fromEntries([...dialog.querySelectorAll(".smith-facts div")].map(row => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]));
  const choices = () => [...dialog.querySelectorAll<HTMLElement>(".smith-choice")];
  return { controller, dialog, q, facts, choices, refine, showMessage, levels };
}

it("lists only gear the Smith can refine, worn first, and shows a risky try's odds and its cost", () => {
  const view = smith();
  view.controller.open();
  expect(view.choices().map(choice => choice.getAttribute("aria-label"))).toEqual(["Bow ★7, worn", "Stone Bow", "Wooden Armor ★2"]);
  expect(view.q(".smith-item strong").textContent).toBe("Bow ★7");
  // The starter bow is safe to ★7 (grade 1); +8 is the first risky step.
  expect(view.facts()).toEqual({ Chance: "60%", "Safe to": "★7", Costs: "1 Copper Ore" });
  expect(view.q(".smith-stat").textContent).toMatch(/^Damage \+[\d.]+% → \+[\d.]+%$/);
  const button = view.q(".smith-refine") as HTMLButtonElement;
  expect([button.textContent, button.disabled]).toEqual(["Refine", false]);
});

it("shows Refine Luck's raise to the decimal, never rounded away", () => {
  const view = smith({ refineLuck: 1 });
  view.controller.open();
  const shown = `${Number((refineSuccessChance(STARTER_BOW, 8, 1) * 100).toFixed(1))}%`;
  expect(shown).not.toBe("60%");
  expect(view.facts().Chance).toBe(shown);
});

it("calls a safe try safe, with nothing to lose", () => {
  const view = smith();
  view.controller.open();
  view.choices()[2].click();
  expect(view.q(".smith-item strong").textContent).toBe("Wooden Armor ★2");
  expect(view.facts()).toEqual({ Chance: "Safe", "Safe to": "★4", Costs: "1 Copper Ore" });
});

it("says which ore is missing instead of letting a try go", () => {
  const view = smith({ ores: {} });
  view.controller.open();
  const button = view.q(".smith-refine") as HTMLButtonElement;
  expect([button.textContent, button.disabled]).toEqual(["Need Copper Ore", true]);
});

it("sends the level the player saw, and shows the server's verdict either way", async () => {
  const view = smith();
  view.controller.open();
  view.q(".smith-refine").click();
  await vi.waitFor(() => expect(view.refine).toHaveBeenCalledWith(STARTER_BOW, 0n, 7));
  view.levels[`${STARTER_BOW}:0`] = 8;
  view.controller.showResult({ itemId: STARTER_BOW, copyId: 0n, fromLevel: 7, toLevel: 8, succeeded: true });
  expect(view.q(".smith-outcome").textContent).toBe("Success! Bow ★8");
  expect(view.showMessage).toHaveBeenLastCalledWith("Refined · Bow ★8", "#ffd75e");
  view.controller.showResult({ itemId: STARTER_BOW, copyId: 0n, fromLevel: 8, toLevel: 8, succeeded: false });
  expect(view.q(".smith-outcome").textContent).toBe("It failed. Nothing lost but the ore.");
});

it("shows the server's refusal where the player is looking", async () => {
  const view = smith();
  view.refine.mockResolvedValueOnce({ ok: false, error: "Talk to the Smith first." } as never);
  view.controller.open();
  view.q(".smith-refine").click();
  await vi.waitFor(() => expect(view.q(".smith-outcome")?.textContent).toBe("Talk to the Smith first."));
  expect(view.showMessage).toHaveBeenCalledWith("Talk to the Smith first.", "#ff9b91");
});

it("opens only in the Town", () => {
  const view = smith({ inTown: false });
  view.controller.open();
  expect(view.dialog.open).toBe(false);
});

it("offers no pickaxe, hatchet or staff to take: every player holds the tools, and shows Mining and Woodcutting by where they are", () => {
  const view = smith({ mining: 40, woodcutting: 12 });
  view.controller.open();
  expect(view.dialog.querySelector(".smith-pickaxe, .smith-hatchet, .smith-staff, .smith-staff-row")).toBeNull();
  expect([...view.dialog.querySelectorAll("button")].map(button => button.textContent)).not.toContain("Take a Pickaxe");
  expect(view.dialog.textContent).not.toMatch(/Take a (Pickaxe|Hatchet|Staff)/);
  expect([view.q(".smith-mining-text").textContent, view.q(".smith-woodcutting-text").textContent])
    .toEqual(["Mining 40 · Ore is in the Copper Hills, east of Town", "Woodcutting 12 · Wood is in Timberwood, north of the Copper Hills"]);
  const fresh = smith();
  fresh.controller.open();
  expect(fresh.q(".smith-mining-text").textContent).toBe("Mining 0 · Ore is in the Copper Hills, east of Town");
});

it("lists only the ores a refine takes, not the crafting wood", () => {
  const view = smith({ ores: { copper_ore: 3, pine_log: 40 } });
  view.controller.open();
  expect(view.q(".smith-ores").textContent).toBe("Copper Ore 3 · Iron Ore 0 · Mithril Ore 0 · Adamant Ore 0 · Starshard 0");
});

it("filters the gear as the bag does and sorts it by tier, worn first", () => {
  const view = smith();
  view.controller.open();
  const label = () => view.choices().map(choice => choice.getAttribute("aria-label"));
  const filter = (name: string) => [...view.dialog.querySelectorAll<HTMLElement>(".smith-filters .inventory-filter")].find(button => button.textContent === name)!;
  expect([...view.dialog.querySelectorAll(".smith-filters .inventory-filter")].map(button => button.textContent)).toEqual(["All", "Weapons", "Armor", "Helmets", "Boots"]);
  expect(filter("All").getAttribute("aria-pressed")).toBe("true");
  filter("Armor").click();
  expect(label()).toEqual(["Wooden Armor ★2"]);
  // The picked gear follows the filter, so the focus never shows something the list hides.
  expect(view.q(".smith-item strong").textContent).toBe("Wooden Armor ★2");
  filter("Helmets").click();
  expect(label()).toEqual([]);
  expect(view.q(".smith-filter-empty").hidden).toBe(false);
  expect(view.q(".smith-filter-empty").textContent).toBe("No helmets to bring");
  filter("Boots").click();
  expect(view.q(".smith-filter-empty").textContent).toBe("No boots to bring");
  filter("Weapons").click();
  expect(label()[0]).toBe("Bow ★7, worn");
  expect(view.q(".smith-filter-empty").hidden).toBe(true);
});

it("refines only: no Cards tab, no card slots on gear", () => {
  const view = smith();
  view.controller.open();
  expect(view.dialog.querySelector(".smith-tabs")).toBeNull();
  expect(view.dialog.querySelector(".smith-cards, .smith-slot, .smith-slot-pips")).toBeNull();
  expect(view.dialog.textContent).not.toMatch(/slot/i);
  expect(view.q(".smith-intro").textContent).toContain("Refine gear with ore");
});

// Gear for gold (buy_grade_gear): a row per line with the highest grade Mastery opens above the best one held.
const nameOf = (itemId: string) => itemInspectionButtonLabel(itemDisplayName(itemId));
/** A device's storage, as the window keeps its views. */
function memoryStorage(values: Record<string, string> = {}) {
  const map = new Map(Object.entries(values));
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, map };
}

function shop(options: { gold?: bigint; levels?: Partial<Record<"archery" | "swordplay" | "sorcery", number>>; held?: string[]; bagFull?: boolean; craft?: CraftSectionDeps;
  shown?: "yours" | "all"; worn?: WornLoadout; refines?: Record<string, number>; equip?: (itemId: string) => boolean | Promise<boolean>; storage?: ReturnType<typeof memoryStorage> } = {}) {
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", window.HTMLElement);
  // Every line unless a test looks at the player's own.
  const storage = options.storage ?? memoryStorage(options.shown === "yours" ? {} : { "wildstat.smithGearShown": "all" });
  vi.stubGlobal("localStorage", storage);
  const held = [...(options.held ?? [])];
  const buyGear = vi.fn(async (_itemId: string, _price: number) => ({ ok: true }));
  const showMessage = vi.fn();
  const state = { gold: options.gold ?? 0n, bagFull: options.bagFull ?? false, worn: options.worn ?? {} };
  const controller = createSmithController({
    inTown: () => true, items: () => [], refine: vi.fn(), showMessage, refineLevel: itemId => options.refines?.[itemId] ?? 0, slotTier: () => 0, ores: () => ({}),
    gold: () => state.gold, masteryLevels: () => options.levels ?? {}, heldItems: () => held, bagFull: () => state.bagFull, buyGear,
    craft: options.craft, worn: () => state.worn, equip: options.equip,
  });
  const dialog = document.querySelector("dialog") as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  const rows = () => [...dialog.querySelectorAll<HTMLElement>(".smith-shop-row")];
  const row = (itemId: string) => rows().find(each => each.dataset.itemId === itemId)!;
  const button = (itemId: string) => row(itemId).querySelector<HTMLButtonElement>(".smith-shop-buy")!;
  const unmet = (itemId: string) => [...row(itemId).querySelectorAll(".craft-needs .is-unmet")].map(need => need.textContent).join(" · ");
  const pill = (label: string) => [...dialog.querySelectorAll<HTMLButtonElement>(".inventory-filter")].find(button => button.textContent === label)!;
  const upgrade = () => dialog.querySelector<HTMLButtonElement>(".smith-upgrade-all-button")!;
  return { controller, dialog, rows, row, button, unmet, buyGear, showMessage, held, state, pill, upgrade, storage };
}

it("lists a row per line, each offering the highest grade Mastery opens above the best one held", () => {
  const view = shop({ gold: 50_000n, levels: { archery: 5 }, held: ["crude_bow", "common_bow", "eternal_sword", "rare_light_helmet"] });
  view.controller.open();
  expect(view.rows().map(row => row.dataset.itemId)).toEqual([
    "rare_bow", "eternal_sword", "crude_staff",
    "exquisite_light_helmet", "rare_light_armor", "crude_medium_helmet", "crude_medium_armor",
    "rare_heavy_helmet", "rare_heavy_armor", "crude_magic_helmet", "crude_magic_armor",
    "rare_ranger_boots", "crude_warrior_boots", "crude_mystic_boots",
  ]);
  expect(view.dialog.querySelector(".smith-gold strong")!.textContent).toBe("50,000");
  const bow = view.row("rare_bow");
  expect(view.dialog.querySelector("#smithShopTitle")!.textContent).toBe("All Gear");
  expect(bow.querySelector("strong")!.textContent).toBe("Forked Bow");
  expect(bow.querySelector(".smith-shop-grade")!.textContent).toBe("Rare · Bow");
  expect(bow.querySelector(".smith-shop-stat")!.textContent).toBe(`Damage +${GRADE_BONUS_PERCENT.rare}%`);
  expect(bow.querySelector(".smith-shop-price")!.textContent).toBe(String(GRADE_GOLD_PRICE.rare));
  expect(bow.querySelector(".smith-shop-art img, .smith-shop-art .inventory-item-art")).not.toBeNull();
  expect(view.row("rare_light_armor").querySelector(".smith-shop-stat")!.textContent).toBe("Max Health +28.8% · +3% Move Speed");
  expect(view.row("crude_medium_armor").querySelector(".smith-shop-stat")!.textContent).toBe("Max Health +8%");
  expect(view.row("crude_magic_helmet").querySelector(".smith-shop-stat")!.textContent).toBe("Regen +6.4% · +3% Skill Chance");
  // Boots: a style per school, each with its school's stat.
  expect(view.row("rare_ranger_boots").querySelector(".smith-shop-grade")!.textContent).toBe("Rare · Ranger Boots");
  expect(view.row("rare_ranger_boots").querySelector(".smith-shop-stat")!.textContent).toBe("Move Speed +8%");
  expect(view.row("crude_warrior_boots").querySelector(".smith-shop-stat")!.textContent).toBe("Armor +8%");
  expect(view.row("crude_mystic_boots").querySelector(".smith-shop-stat")!.textContent).toBe("Skill Chance +2%");
  // An open offer names the next grade and its Mastery, muted; a locked one what it waits for.
  expect(bow.querySelector(".craft-needs")!.textContent).toBe("Next: Exquisite at Lv 6 Archery");
  expect(bow.querySelector(".craft-needs .is-unmet")).toBeNull();
  expect(view.row("crude_staff").querySelector(".craft-needs")!.textContent).toBe("Next: Common at Lv 1 Sorcery");
  expect([view.button("exquisite_light_helmet").textContent, view.unmet("exquisite_light_helmet")]).toEqual(["Locked", "Lv 6 Archery"]);
  // The top grade held shows as Owned, with no price.
  expect(view.row("eternal_sword").querySelector(".smith-shop-owned")!.textContent).toBe("Owned");
  expect(view.row("eternal_sword").querySelector("button")).toBeNull();
  expect(view.row("eternal_sword").querySelector(".smith-shop-price")).toBeNull();
});

it("says what stands in the way: Mastery, then gold, then the bag", () => {
  // Enough for a Crude piece, short of every grade above it.
  const view = shop({ gold: BigInt(GRADE_GOLD_PRICE.crude), levels: { archery: 5, sorcery: 0 }, held: ["rare_bow", "crude_staff", "crude_heavy_helmet"] });
  view.controller.open();
  expect([view.button("exquisite_bow").textContent, view.unmet("exquisite_bow")]).toEqual(["Locked", "Lv 6 Archery"]);
  expect([view.button("common_staff").textContent, view.unmet("common_staff")]).toEqual(["Locked", "Lv 1 Sorcery"]);
  expect([view.button("rare_heavy_helmet").textContent, view.button("rare_heavy_helmet").disabled]).toEqual(["Need Gold", true]);
  expect(view.unmet("rare_heavy_helmet")).toBe("");
  expect([view.button("crude_magic_armor").textContent, view.button("crude_magic_armor").disabled]).toEqual(["Buy", false]);
  view.state.bagFull = true;
  view.controller.render();
  expect([view.button("crude_magic_armor").textContent, view.button("crude_magic_armor").disabled]).toEqual(["Bag Full", true]);
  expect(view.button("exquisite_bow").textContent).toBe("Locked");
});

it("steps the Buy line through every open grade, starting at the best the gold covers", async () => {
  const view = shop({ gold: BigInt(GRADE_GOLD_PRICE.rare), levels: { archery: 8 }, held: ["crude_bow"] });
  view.controller.open();
  // Heroic is open but out of reach: the row starts at Rare, the best the gold covers.
  const bow = () => view.rows()[0];
  const step = (which: string) => bow().querySelector<HTMLButtonElement>(`.buy-offer .craft-grade-step[aria-label="${which}"]`)!;
  expect(bow().dataset.itemId).toBe("rare_bow");
  expect(bow().querySelector(".buy-offer .craft-grade-name")!.textContent).toBe("Rare");
  expect(bow().querySelector(".craft-needs")!.textContent).toBe("Next: Legendary at Lv 9 Archery");
  step("Higher Grade").click();
  expect(bow().dataset.itemId).toBe("exquisite_bow");
  expect([view.button("exquisite_bow").textContent, view.button("exquisite_bow").disabled]).toEqual(["Need Gold", true]);
  expect(view.row("exquisite_bow").querySelector(".smith-shop-price")!.textContent).toBe(String(GRADE_GOLD_PRICE.exquisite));
  step("Higher Grade").click(); step("Higher Grade").click();
  expect([bow().dataset.itemId, step("Higher Grade").disabled]).toEqual(["heroic_bow", true]);
  for (let index = 0; index < 8; index++) step("Lower Grade").click();
  // The lowest open grade above the best held.
  expect([bow().dataset.itemId, step("Lower Grade").disabled]).toEqual(["common_bow", true]);
  view.button("common_bow").click();
  expect(view.buyGear).toHaveBeenCalledWith("common_bow", GRADE_GOLD_PRICE.common);
  // Bought: the line starts over from the best the gold covers above it.
  await vi.waitFor(() => expect(bow().dataset.itemId).toBe("rare_bow"));
});

it("shows the highest open grade with Need Gold when the gold covers none", () => {
  const view = shop({ gold: 0n, levels: { archery: 8 }, held: ["crude_bow", "crude_sword", "epic_sword"] });
  view.controller.open();
  expect([view.button("heroic_bow").textContent, view.button("heroic_bow").disabled]).toEqual(["Need Gold", true]);
  // One open grade: shown, with nothing to step to. A locked line has no grade to pick.
  expect(view.row("crude_staff").querySelectorAll(".craft-grade-step:not(:disabled)").length).toBe(0);
  expect(view.row("heroic_sword").querySelector(".craft-grade")).toBeNull();
  expect(view.button("heroic_sword").textContent).toBe("Locked");
});

it("Heavy opens at the best school's level", () => {
  const view = shop({ gold: 1_000_000n, levels: { sorcery: 5 }, held: ["common_heavy_armor"] });
  view.controller.open();
  expect(view.button("rare_heavy_armor").textContent).toBe("Buy");
  const more = shop({ gold: 1_000_000n, levels: { swordplay: 1 }, held: ["common_heavy_armor"] });
  more.controller.open();
  expect([more.button("sturdy_heavy_armor").textContent, more.unmet("sturdy_heavy_armor")]).toEqual(["Locked", "Lv 2 Any School"]);
});

it("buys at the price shown, and offers the next grade before the server's row arrives", async () => {
  const view = shop({ gold: 1_000n });
  view.controller.open();
  view.button("crude_bow").click();
  expect(view.buyGear).toHaveBeenCalledWith("crude_bow", GRADE_GOLD_PRICE.crude);
  await vi.waitFor(() => expect(view.showMessage).toHaveBeenCalledWith(`Bought · ${nameOf("crude_bow")}. Equip it from your bag.`, "#ffd75e"));
  expect(view.row("common_bow")).toBeTruthy();
  expect(view.button("common_bow").textContent).toBe("Locked");
});

it("shows Buying… and holds every row while a buy is on its way, and the refusal after", async () => {
  const view = shop({ gold: 1_000n });
  let settle: (value: { ok: boolean; error?: string }) => void = () => {};
  view.buyGear.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  view.controller.open();
  view.button("crude_bow").click();
  expect([view.button("crude_bow").textContent, view.button("crude_bow").disabled]).toEqual(["Buying…", true]);
  expect(view.button("crude_sword").disabled).toBe(true);
  settle({ ok: false, error: "Talk to the Smith first." });
  await vi.waitFor(() => expect(view.showMessage).toHaveBeenCalledWith("Talk to the Smith first.", "#ff9b91"));
  expect([view.button("crude_bow").textContent, view.button("crude_bow").disabled]).toEqual(["Buy", false]);
});

it("hides the shop when there is no way to buy", () => {
  const view = smith();
  view.controller.open();
  expect(view.q(".smith-shop").hidden).toBe(true);
});

it("gives every line a Craft line under Buy, by the craft that makes it, with the three crafts' levels above the list", async () => {
  const craft = vi.fn(async (_itemId: string) => ({ ok: true }));
  const view = shop({
    gold: 1_000n, levels: {}, held: [],
    craft: {
      craftSkills: () => ({ smithing: 0n, fletching: BigInt(craftExperienceForLevel(4)) }), ores: () => ({ copper_ore: 8, pine_log: 100 }), masteryLevels: () => ({}),
      heldItems: () => [], bagFull: () => false, craft, showMessage: vi.fn(),
    },
  });
  const deals = (itemId: string) => [...view.row(itemId).querySelectorAll(".smith-shop-buy")].map(button => button.textContent);
  view.controller.open();
  // The three crafts head the list, in one card; there is no second list of rows.
  const card = view.dialog.querySelector(".smith-shop .craft-card")!;
  expect([...card.querySelectorAll(".craft-skill")].map(skill => `${skill.querySelector(".craft-name")!.textContent} ${skill.querySelector(".craft-level")!.textContent}`))
    .toEqual(["Smithing Lv 1", "Fletching Lv 4", "Enchanting Lv 1"]);
  expect(view.dialog.querySelector(".craft-section")!.nextElementSibling!.className).toBe("smith-shop-head");
  expect(view.dialog.querySelectorAll(".smith-shop-row").length).toBe(14);
  expect(view.dialog.querySelector(".craft-hint")).toBeNull();
  // Every line has Buy and Craft: bows, staffs, swords and armor of every class.
  for (const itemId of ["crude_bow", "crude_staff", "crude_light_armor", "crude_magic_armor", "crude_heavy_helmet", "crude_ranger_boots", "crude_mystic_boots"]) {
    expect(deals(itemId)[0]).toBe("Buy");
    expect(view.row(itemId).querySelector(".craft-offer .smith-shop-buy")).toBeTruthy();
  }
  expect(deals("crude_warrior_boots")).toEqual(["Buy", "Craft"]);
  expect(deals("crude_bow")).toEqual(["Buy", "Craft"]);
  expect([...view.row("crude_bow").querySelectorAll(".craft-material")].map(item => item.textContent)).toEqual(["100 / 10 Pine Log", "8 / 2 Copper Ore"]);
  expect(deals("crude_staff")).toEqual(["Buy", "Need More"]);
  const sword = view.row("crude_sword"), helm = view.row("crude_medium_helmet");
  expect(deals("crude_sword")).toEqual(["Buy", "Need More"]);
  expect(sword.querySelector(".craft-material")!.textContent).toBe("8 / 10 Copper Ore");
  expect(sword.querySelector(".craft-needs")!.textContent).toBe("Next: Common at Lv 1 Swordplay");
  expect(sword.querySelector(".craft-offer .craft-grade-name")!.textContent).toBe("Crude ★2");
  expect(deals("crude_medium_helmet")).toEqual(["Buy", "Craft"]);
  // A craft moves the line on before the server's row arrives: the next grade to buy, the crafted helmet Owned.
  helm.querySelector<HTMLButtonElement>(".craft-offer .smith-shop-buy")!.click();
  expect(craft).toHaveBeenCalledWith("crude_medium_helmet");
  await vi.waitFor(() => expect(view.row("common_medium_helmet")).toBeTruthy());
  expect(deals("common_medium_helmet")).toEqual(["Locked", "Owned"]);
});

it("crafts any grade Smithing opens on the line, and reforges a sword already held", () => {
  const held: string[] = [];
  const view = shop({
    gold: 1_000n, levels: { swordplay: 5 }, held,
    craft: {
      craftSkills: () => ({ smithing: 0n }), ores: () => ({ copper_ore: 100 }), masteryLevels: () => ({ swordplay: 5 }), heldItems: () => held,
      bagFull: () => false, craft: vi.fn(), showMessage: vi.fn(),
    },
  });
  view.controller.open();
  const sword = () => view.row("rare_sword");
  expect(sword().querySelector(".craft-offer .craft-grade-name")!.textContent).toBe("Crude ★2");
  expect([...sword().querySelectorAll(".smith-shop-buy")].map(button => button.textContent)).toEqual(["Buy", "Craft"]);
  expect(sword().querySelector(".craft-needs")!.textContent).toBe("Next: Exquisite at Lv 6 Swordplay");
  held.push("crude_sword"); view.held.push("crude_sword");
  view.controller.render();
  expect(sword().querySelector(".craft-offer .craft-grade-name")!.textContent).toBe("Crude");
  expect([...sword().querySelectorAll(".smith-shop-buy")].map(button => button.textContent)).toEqual(["Buy", "Reforge"]);
  expect(sword().querySelector(".craft-offer .craft-hint")!.textContent).toBe("Rolls its skills again, keeping the higher");
});

it("opens on Gear when the Smith sells, keeps the view picked on the device, and hides the bar with one view", () => {
  const view = shop({ gold: 100n });
  view.controller.open();
  const shownView = () => [...view.dialog.querySelectorAll<HTMLElement>(".smith-view")].filter(section => !section.hidden).map(section => section.dataset.view);
  expect(shownView()).toEqual(["gear"]);
  expect([...view.dialog.querySelectorAll(".smith-views .inventory-filter")].map(button => button.textContent)).toEqual(["Gear", "Refine"]);
  view.pill("Refine").click();
  expect(shownView()).toEqual(["refine"]);
  expect(view.storage.map.get("wildstat.smithView")).toBe("refine");
  const refineAndTools = smith();
  refineAndTools.controller.open();
  expect([...refineAndTools.dialog.querySelectorAll(".smith-views .inventory-filter")].map(button => button.textContent)).toEqual(["Refine", "Tools"]);
  // Refining only: one view, no bar.
  createSmithController({ inTown: () => true, items: () => [], refine: vi.fn(), showMessage: vi.fn(), refineLevel: () => 0, slotTier: () => 0, ores: () => ({}) });
  const dialogs = document.querySelectorAll("dialog");
  expect((dialogs[dialogs.length - 1].querySelector(".smith-views-bar") as unknown as HTMLElement).hidden).toBe(true);
});

it("lists the weapon in hand's lines under For Your Bow until All Gear is picked, and remembers the pick", () => {
  const storage = memoryStorage();
  const view = shop({ gold: 100n, shown: "yours", storage, worn: { equippedRightHand: "crude_bow" }, held: ["crude_bow"] });
  view.controller.open();
  expect(view.dialog.querySelector("#smithShopTitle")!.textContent).toBe("For Your Bow");
  expect(view.rows().map(row => row.dataset.itemId)).toEqual(["common_bow", "crude_light_helmet", "crude_light_armor", "crude_ranger_boots"]);
  expect(view.pill("Yours").getAttribute("aria-pressed")).toBe("true");
  view.pill("All Gear").click();
  expect(view.rows().length).toBe(14);
  expect(view.dialog.querySelector("#smithShopTitle")!.textContent).toBe("All Gear");
  expect(storage.map.get("wildstat.smithGearShown")).toBe("all");
  // A swordsman's own lines: the sword, Medium and Warrior.
  const sword = shop({ gold: 100n, shown: "yours", storage: memoryStorage(), worn: { equippedRightHand: "crude_sword" } });
  sword.controller.open();
  expect(sword.dialog.querySelector("#smithShopTitle")!.textContent).toBe("For Your Sword");
  expect(sword.rows().map(row => row.dataset.itemId)).toEqual(["crude_sword", "crude_medium_helmet", "crude_medium_armor", "crude_warrior_boots"]);
  // The pick carries to the next visit on the device.
  const again = shop({ gold: 100n, storage });
  again.controller.open();
  expect(again.rows().length).toBe(14);
});

it("says what each offer changes against what is worn, from the items' stats", () => {
  const view = shop({
    gold: 100n, levels: { archery: 5 }, held: ["common_bow", "crude_ranger_boots", "legendary_heavy_helmet"],
    worn: { equippedRightHand: "common_bow", equippedFeet: "crude_ranger_boots", equippedHead: "legendary_heavy_helmet" },
  });
  view.controller.open();
  const tag = (itemId: string) => view.row(itemId).querySelector(".smith-compare")!;
  expect(tag("rare_bow").textContent).toBe(`+${GRADE_BONUS_PERCENT.rare - GRADE_BONUS_PERCENT.common}% Damage vs Now`);
  expect(tag("rare_bow").className).toContain("is-better");
  // Nothing worn on the body: the whole stat.
  expect(tag("rare_light_armor").textContent).toBe("+28.8% Max Health vs Now");
  expect(tag("rare_ranger_boots").textContent).toBe("+6% Move Speed vs Now");
  // A stronger helmet worn: the offer is worse, and says so.
  expect(tag("rare_light_helmet").textContent).toMatch(/^-[\d.]+% Regen vs Now$/);
  expect(tag("rare_light_helmet").className).toContain("is-worse");
});

it("counts the worn piece's refine in the comparison", () => {
  const view = shop({ gold: 100n, held: ["crude_bow"], worn: { equippedRightHand: "crude_bow" }, refines: { crude_bow: 5 } });
  view.controller.open();
  const plain = GRADE_BONUS_PERCENT.common - GRADE_BONUS_PERCENT.crude;
  const shown = Number(/^\+([\d.]+)%/.exec(view.row("common_bow").querySelector(".smith-compare")!.textContent!)![1]);
  expect(shown).toBeLessThan(plain);
});

it("Upgrade All spreads the gold over the player's lines, puts each new piece on, and says what it did", async () => {
  const equip = vi.fn(async (_itemId: string) => true);
  const view = shop({ gold: 600n, levels: { archery: 6 }, shown: "yours", held: ["common_bow", "crude_light_helmet", "crude_light_armor"], equip,
    worn: { equippedRightHand: "common_bow", equippedHead: "crude_light_helmet", equippedChest: "crude_light_armor" } });
  view.controller.open();
  // The boots line, furthest behind, catches up first; then every line rises together to Sturdy.
  expect(view.upgrade().textContent).toBe("Upgrade All · 600 GoldBuys and Equips 4 Pieces");
  expect([...view.dialog.querySelectorAll(".smith-upgrade-all-picks li")].map(item => item.textContent))
    .toEqual(["Sturdy Bow", "Sturdy Light Helmet", "Sturdy Light Armor", "Sturdy Ranger Boots"]);
  expect(view.upgrade().disabled).toBe(false);
  view.upgrade().click();
  await vi.waitFor(() => expect(view.showMessage).toHaveBeenCalledWith("Upgraded · Sturdy Bow, Sturdy Light Helmet, Sturdy Light Armor, Sturdy Ranger Boots", "#ffd75e"));
  expect(view.buyGear.mock.calls).toEqual([
    ["sturdy_bow", GRADE_GOLD_PRICE.sturdy], ["sturdy_light_helmet", GRADE_GOLD_PRICE.sturdy], ["sturdy_light_armor", GRADE_GOLD_PRICE.sturdy],
    ["sturdy_ranger_boots", GRADE_GOLD_PRICE.sturdy],
  ]);
  expect(equip.mock.calls.map(([itemId]) => itemId)).toEqual(["sturdy_bow", "sturdy_light_helmet", "sturdy_light_armor", "sturdy_ranger_boots"]);
});

it("Upgrade All stops at a refusal and says how far it got", async () => {
  const equip = vi.fn(() => true);
  const view = shop({ gold: 1_000n, levels: { archery: 1 }, shown: "yours", equip, worn: { equippedRightHand: "starter_bow" } });
  view.buyGear.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "Your bag is full. Free a slot first." } as never);
  view.controller.open();
  view.upgrade().click();
  await vi.waitFor(() => expect(view.showMessage).toHaveBeenCalledWith("Bought 1 of 4 · Your bag is full. Free a slot first.", "#ff9b91"));
  expect(view.buyGear).toHaveBeenCalledTimes(2);
  expect(equip).toHaveBeenCalledTimes(1);
  expect(view.upgrade().disabled).toBe(false);
});

it("Upgrade All tells the player to equip from the bag when a piece could not go on", async () => {
  const view = shop({ gold: 120n, shown: "yours", worn: { equippedRightHand: "starter_bow" }, equip: () => false });
  view.controller.open();
  view.upgrade().click();
  await vi.waitFor(() => expect(view.showMessage).toHaveBeenCalledWith("Upgraded · Crude Bow. Equip it from your bag.", "#ffd75e"));
});

it("Upgrade All waits with a reason: what comes next and its price, the Mastery it needs, or the bag", () => {
  const poor = shop({ gold: 50n, levels: { archery: 6 }, shown: "yours", worn: { equippedRightHand: "starter_bow" } });
  poor.controller.open();
  expect(poor.upgrade().disabled).toBe(true);
  expect(poor.dialog.querySelector(".smith-upgrade-all-title")!.textContent).toBe("Nothing To Upgrade Yet");
  expect(poor.dialog.querySelector(".smith-upgrade-all-sub")!.textContent).toBe(`Next: Crude Bow at ${GRADE_GOLD_PRICE.crude} Gold`);
  expect(poor.controller.upgradeReady()).toBe(false);
  const locked = shop({ gold: 1_000n, shown: "yours", held: ["crude_bow", "crude_light_helmet", "crude_light_armor", "crude_ranger_boots"],
    worn: { equippedRightHand: "crude_bow", equippedHead: "crude_light_helmet", equippedChest: "crude_light_armor", equippedFeet: "crude_ranger_boots" } });
  locked.controller.open();
  expect(locked.dialog.querySelector(".smith-upgrade-all-sub")!.textContent).toBe("Next: Common Bow at Lv 1 Archery");
  const full = shop({ gold: 1_000n, bagFull: true, shown: "yours", worn: { equippedRightHand: "starter_bow" } });
  full.controller.open();
  expect([full.upgrade().disabled, full.dialog.querySelector(".smith-upgrade-all-title")!.textContent]).toEqual([true, "Bag Full"]);
  expect(full.controller.upgradeReady()).toBe(true);
});

it("dots the Gear view while Upgrade All has something to buy", () => {
  const view = shop({ gold: 1_000n, worn: { equippedRightHand: "starter_bow" }, storage: memoryStorage({ "wildstat.smithView": "refine" }) });
  view.controller.open();
  const dot = view.dialog.querySelector<HTMLElement>(".smith-upgrade-dot")!;
  expect(dot.hidden).toBe(false);
  view.state.gold = 0n;
  view.controller.render();
  expect(dot.hidden).toBe(true);
});

it("puts a bought piece on once the server's row has brought it into the bag, and gives up after a while", async () => {
  const inventory = { itemIds: ["starter_bow"] };
  const equip = vi.fn(() => true);
  let waits = 0;
  const wait = async () => { if (++waits === 3) inventory.itemIds.push("rare_ranger_boots"); };
  await expect(equipWhenHeld(inventory, "rare_ranger_boots", equip, wait)).resolves.toBe(true);
  expect(equip).toHaveBeenCalledWith("rare_ranger_boots", "FEET");
  await expect(equipWhenHeld(inventory, "rare_bow", equip, async () => {})).resolves.toBe(false);
  inventory.itemIds.push("rare_bow");
  await equipWhenHeld(inventory, "rare_bow", equip, async () => {});
  expect(equip).toHaveBeenLastCalledWith("rare_bow", "RIGHT_HAND");
});

it("shows the Town button's dot only while Upgrade All has something to buy", () => {
  const { document, window } = parseHTML("<html><body><button id=\"techTreeBtn\"></button></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("localStorage", memoryStorage());
  let gold = 1_000n;
  const runtime = createSmithRuntime({
    coop: () => ({ gold: () => gold, weaponMastery: () => ({ archery: 0n, swordplay: 0n, sorcery: 0n }), buyGradeGear: async () => ({ ok: true }) }),
    inventory: { itemIds: ["starter_bow"], equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: "starter_bow", equippedLeftHand: "" },
    showMessage: vi.fn(), inTown: () => true,
  });
  const dot = document.querySelector<HTMLElement>("#techTreeBtn .smith-upgrade-notice")!;
  expect(dot.hidden).toBe(true);
  runtime.refreshNotice();
  expect(dot.hidden).toBe(false);
  gold = 0n;
  runtime.refreshNotice();
  expect(dot.hidden).toBe(true);
});
