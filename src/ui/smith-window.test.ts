import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createSmithController, type SmithItem } from "./smith-window";
import { IRON_BOW, STARTER_BOW, STARTER_STONE, WOODEN_ARMOR } from "../../shared/items";
import { refineSuccessChance, type OreId } from "../../shared/refine";
import type { CraftSectionDeps } from "./craft-section";
afterEach(() => vi.unstubAllGlobals());

// The server rolls every try (refine_item); the window shows the odds, sends the level the player saw, and shows the verdict.
function smith(options: { inTown?: boolean; ores?: Partial<Record<OreId, number>>; pickaxe?: boolean; mining?: number; refineLuck?: number; hatchet?: boolean; woodcutting?: number } = {}) {
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
  let pickaxe = options.pickaxe ?? false;
  const claimPickaxe = vi.fn(async () => { pickaxe = true; return { ok: true }; });
  let hatchet = options.hatchet ?? false;
  const claimHatchet = vi.fn(async () => { hatchet = true; return { ok: true }; });
  const controller = createSmithController({
    inTown: () => options.inTown ?? true, items: () => items, refine, showMessage,
    hasPickaxe: () => pickaxe, claimPickaxe, mining: () => options.mining ?? 0,
    hasHatchet: () => hatchet, claimHatchet, woodcutting: () => options.woodcutting ?? 0,
    refineLevel: (itemId, copyId) => levels[`${itemId}:${copyId}`] ?? 0, slotTier: () => 0,
    ores: () => options.ores ?? { copper_ore: 3 }, refineLuck: () => options.refineLuck ?? 0,
  });
  const dialog = document.querySelector("dialog") as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  const q = (selector: string) => dialog.querySelector(selector) as unknown as HTMLElement;
  const facts = () => Object.fromEntries([...dialog.querySelectorAll(".smith-facts div")].map(row => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]));
  const choices = () => [...dialog.querySelectorAll<HTMLElement>(".smith-choice")];
  return { controller, dialog, q, facts, choices, refine, showMessage, levels, claimPickaxe, claimHatchet, setPickaxe: (value: boolean) => { pickaxe = value; } };
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

it("hands over the free pickaxe once, and then shows Mining instead", async () => {
  const view = smith();
  view.controller.open();
  const button = view.q(".smith-pickaxe") as HTMLButtonElement;
  expect([button.hidden, view.q(".smith-mining-text").textContent]).toEqual([false, "Ore is in the Copper Hills, east of Town."]);
  button.click();
  await vi.waitFor(() => expect(button.hidden).toBe(true));
  expect(view.claimPickaxe).toHaveBeenCalledTimes(1);
  expect(view.showMessage).toHaveBeenCalledWith("The Smith hands you a pickaxe. Walk east to the Copper Hills.", "#ffd75e");
  expect(view.q(".smith-mining-text").textContent).toBe("Mining 0 · Ore is in the Copper Hills, east of Town");
  const miner = smith({ pickaxe: true, mining: 40 });
  miner.controller.open();
  expect([(miner.q(".smith-pickaxe") as HTMLButtonElement).hidden, miner.q(".smith-mining-text").textContent])
    .toEqual([true, "Mining 40 · Ore is in the Copper Hills, east of Town"]);
});

it("hands over the free hatchet once, beside the pickaxe, and then shows Woodcutting instead", async () => {
  const view = smith();
  view.controller.open();
  const button = view.q(".smith-hatchet") as HTMLButtonElement;
  expect([button.hidden, button.textContent, view.q(".smith-woodcutting-text").textContent])
    .toEqual([false, "Take a Hatchet", "Wood is in Timberwood, north of the Copper Hills."]);
  button.click();
  await vi.waitFor(() => expect(button.hidden).toBe(true));
  expect(view.claimHatchet).toHaveBeenCalledTimes(1);
  expect(view.claimPickaxe).not.toHaveBeenCalled();
  expect(view.showMessage).toHaveBeenCalledWith("The Smith hands you a hatchet. Timberwood is north of the Copper Hills.", "#ffd75e");
  const woodcutter = smith({ hatchet: true, woodcutting: 12 });
  woodcutter.controller.open();
  expect([(woodcutter.q(".smith-hatchet") as HTMLButtonElement).hidden, woodcutter.q(".smith-woodcutting-text").textContent])
    .toEqual([true, "Woodcutting 12 · Wood is in Timberwood, north of the Copper Hills"]);
});

it("lists only the ores a refine takes, not the crafting wood", () => {
  const view = smith({ ores: { copper_ore: 3, pine_log: 40 } });
  view.controller.open();
  expect(view.q(".smith-ores").textContent).toBe("Copper Ore 3 · Iron Ore 0 · Mithril Ore 0 · Adamant Ore 0 · Starshard 0");
});

it("offers the pickaxe again once the server no longer has it (a reset save takes it back)", async () => {
  const view = smith();
  view.controller.open();
  const button = view.q(".smith-pickaxe") as HTMLButtonElement;
  button.click();
  await vi.waitFor(() => expect(button.hidden).toBe(true));
  view.controller.close();
  view.setPickaxe(false);
  view.controller.open();
  expect([button.hidden, view.q(".smith-mining-text").textContent]).toEqual([false, "Ore is in the Copper Hills, east of Town."]);
});

it("keeps the pickaxe on offer when the server refuses, and says why", async () => {
  const view = smith();
  view.claimPickaxe.mockResolvedValueOnce({ ok: false, error: "Talk to the Smith first." } as never);
  view.controller.open();
  const button = view.q(".smith-pickaxe") as HTMLButtonElement;
  button.click();
  await vi.waitFor(() => expect(view.showMessage).toHaveBeenCalledWith("Talk to the Smith first.", "#ff9b91"));
  expect([button.hidden, button.disabled]).toEqual([false, false]);
});

it("filters the gear as the bag does and sorts it by tier, worn first", () => {
  const view = smith();
  view.controller.open();
  const label = () => view.choices().map(choice => choice.getAttribute("aria-label"));
  const filter = (name: string) => [...view.dialog.querySelectorAll<HTMLElement>(".smith-filters .inventory-filter")].find(button => button.textContent === name)!;
  expect([...view.dialog.querySelectorAll(".smith-filters .inventory-filter")].map(button => button.textContent)).toEqual(["All", "Weapons", "Armor", "Helmets"]);
  expect(filter("All").getAttribute("aria-pressed")).toBe("true");
  filter("Armor").click();
  expect(label()).toEqual(["Wooden Armor ★2"]);
  // The picked gear follows the filter, so the focus never shows something the list hides.
  expect(view.q(".smith-item strong").textContent).toBe("Wooden Armor ★2");
  filter("Helmets").click();
  expect(label()).toEqual([]);
  expect(view.q(".smith-filter-empty").hidden).toBe(false);
  expect(view.q(".smith-filter-empty").textContent).toBe("No helmets to bring");
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

// Gear for gold (buy_grade_gear): a row per line with the grade after the best one held.
function shop(options: { gold?: bigint; levels?: Partial<Record<"archery" | "swordplay" | "sorcery", number>>; held?: string[]; bagFull?: boolean; craft?: CraftSectionDeps } = {}) {
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", window.HTMLElement);
  const held = [...(options.held ?? [])];
  const buyGear = vi.fn(async (_itemId: string, _price: number) => ({ ok: true }));
  const showMessage = vi.fn();
  const state = { gold: options.gold ?? 0n, bagFull: options.bagFull ?? false };
  const controller = createSmithController({
    inTown: () => true, items: () => [], refine: vi.fn(), showMessage, refineLevel: () => 0, slotTier: () => 0, ores: () => ({}),
    gold: () => state.gold, masteryLevels: () => options.levels ?? {}, heldItems: () => held, bagFull: () => state.bagFull, buyGear,
    craft: options.craft,
  });
  const dialog = document.querySelector("dialog") as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  const rows = () => [...dialog.querySelectorAll<HTMLElement>(".smith-shop-row")];
  const row = (itemId: string) => rows().find(each => each.dataset.itemId === itemId)!;
  const button = (itemId: string) => row(itemId).querySelector<HTMLButtonElement>(".smith-shop-buy")!;
  const unmet = (itemId: string) => [...row(itemId).querySelectorAll(".craft-needs .is-unmet")].map(need => need.textContent).join(" · ");
  return { controller, dialog, rows, row, button, unmet, buyGear, showMessage, held, state };
}

it("lists a row per line, each offering the grade after the best one held", () => {
  const view = shop({ gold: 50_000n, levels: { archery: 12 }, held: ["common_bow", "uncommon_bow", "mythic_sword", "rare_light_helmet"] });
  view.controller.open();
  expect(view.rows().map(row => row.dataset.itemId)).toEqual([
    "rare_bow", "mythic_sword", "common_staff",
    "epic_light_helmet", "common_light_armor", "common_medium_helmet", "common_medium_armor",
    "common_heavy_helmet", "common_heavy_armor", "common_magic_helmet", "common_magic_armor",
  ]);
  expect(view.dialog.querySelector(".smith-gold strong")!.textContent).toBe("50,000");
  const bow = view.row("rare_bow");
  expect(view.dialog.querySelector("#smithShopTitle")!.textContent).toBe("Gear");
  expect(bow.querySelector("strong")!.textContent).toBe("Rare Steel Bow");
  expect(bow.querySelector(".smith-shop-grade")!.textContent).toBe("Rare · Bow");
  expect(bow.querySelector(".smith-shop-stat")!.textContent).toBe("Damage +30%");
  expect(bow.querySelector(".smith-shop-price")!.textContent).toBe("5,000");
  expect(bow.querySelector(".smith-shop-art img, .smith-shop-art .inventory-item-art")).not.toBeNull();
  expect(view.row("common_light_armor").querySelector(".smith-shop-stat")!.textContent).toBe("Max Health +4.8% · +3% Move Speed");
  expect(view.row("common_medium_armor").querySelector(".smith-shop-stat")!.textContent).toBe("Max Health +6%");
  expect(view.row("common_magic_helmet").querySelector(".smith-shop-stat")!.textContent).toBe("Regen +4.8% · +3% Skill Chance");
  // Common needs no Mastery; a later grade names it.
  expect(view.row("common_staff").querySelector(".craft-needs")).toBeNull();
  expect(bow.querySelector(".craft-needs")!.textContent).toBe("Lv 10 Archery");
  // The top grade held shows as Owned, with no price.
  expect(view.row("mythic_sword").querySelector(".smith-shop-owned")!.textContent).toBe("Owned");
  expect(view.row("mythic_sword").querySelector("button")).toBeNull();
  expect(view.row("mythic_sword").querySelector(".smith-shop-price")).toBeNull();
});

it("says what stands in the way: Mastery, then gold, then the bag", () => {
  const view = shop({ gold: 500n, levels: { archery: 12, sorcery: 3 }, held: ["rare_bow", "common_staff", "common_heavy_helmet"] });
  view.controller.open();
  expect([view.button("epic_bow").textContent, view.unmet("epic_bow")]).toEqual(["Locked", "Lv 20 Archery"]);
  expect([view.button("uncommon_staff").textContent, view.unmet("uncommon_staff")]).toEqual(["Locked", "Lv 5 Sorcery"]);
  expect([view.button("uncommon_heavy_helmet").textContent, view.button("uncommon_heavy_helmet").disabled]).toEqual(["Need Gold", true]);
  expect(view.unmet("uncommon_heavy_helmet")).toBe("");
  expect([view.button("common_magic_armor").textContent, view.button("common_magic_armor").disabled]).toEqual(["Buy", false]);
  view.state.bagFull = true;
  view.controller.render();
  expect([view.button("common_magic_armor").textContent, view.button("common_magic_armor").disabled]).toEqual(["Bag Full", true]);
  expect(view.button("epic_bow").textContent).toBe("Locked");
});

it("Heavy opens at the best school's level", () => {
  const view = shop({ gold: 1_000_000n, levels: { sorcery: 10 }, held: ["uncommon_heavy_armor"] });
  view.controller.open();
  expect(view.button("rare_heavy_armor").textContent).toBe("Buy");
  const more = shop({ gold: 1_000_000n, levels: { swordplay: 4 }, held: ["common_heavy_armor"] });
  more.controller.open();
  expect([more.button("uncommon_heavy_armor").textContent, more.unmet("uncommon_heavy_armor")]).toEqual(["Locked", "Lv 5 Any School"]);
});

it("buys at the price shown, and offers the next grade before the server's row arrives", async () => {
  const view = shop({ gold: 1_000n });
  view.controller.open();
  view.button("common_bow").click();
  expect(view.buyGear).toHaveBeenCalledWith("common_bow", 100);
  await vi.waitFor(() => expect(view.showMessage).toHaveBeenCalledWith("Bought · Common Shortbow. Equip it from your bag.", "#ffd75e"));
  expect(view.row("uncommon_bow")).toBeTruthy();
  expect(view.button("uncommon_bow").textContent).toBe("Locked");
});

it("shows Buying… and holds every row while a buy is on its way, and the refusal after", async () => {
  const view = shop({ gold: 1_000n });
  let settle: (value: { ok: boolean; error?: string }) => void = () => {};
  view.buyGear.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
  view.controller.open();
  view.button("common_bow").click();
  expect([view.button("common_bow").textContent, view.button("common_bow").disabled]).toEqual(["Buying…", true]);
  expect(view.button("common_sword").disabled).toBe(true);
  settle({ ok: false, error: "Talk to the Smith first." });
  await vi.waitFor(() => expect(view.showMessage).toHaveBeenCalledWith("Talk to the Smith first.", "#ff9b91"));
  expect([view.button("common_bow").textContent, view.button("common_bow").disabled]).toEqual(["Buy", false]);
});

it("hides the shop when there is no way to buy", () => {
  const view = smith();
  view.controller.open();
  expect(view.q(".smith-shop").hidden).toBe(true);
});

it("gives the lines Smithing makes a Craft line under Buy, and the rest a hint where they are crafted", async () => {
  const craft = vi.fn(async (_itemId: string) => ({ ok: true }));
  const view = shop({
    gold: 1_000n, levels: {}, held: [],
    craft: {
      craftSkills: () => ({ smithing: 0n }), ores: () => ({ copper_ore: 15 }), masteryLevels: () => ({}), heldItems: () => [],
      bagFull: () => false, craft, showMessage: vi.fn(),
    },
  });
  view.controller.open();
  // Smithing's level heads the list, in one card; there is no second list of rows.
  expect(view.dialog.querySelector(".smith-shop .craft-card .craft-name")!.textContent).toBe("Smithing");
  expect(view.dialog.querySelectorAll(".smith-shop-row").length).toBe(11);
  const sword = view.row("common_sword"), helm = view.row("common_medium_helmet");
  expect([...sword.querySelectorAll("button")].map(button => button.textContent)).toEqual(["Buy", "Need More"]);
  expect(sword.querySelector(".craft-material")!.textContent).toBe("15 / 20 Copper Ore");
  expect(sword.querySelector(".craft-needs")!.textContent).toBe("Lv 1 Smithing");
  expect(sword.querySelector(".craft-offer .craft-stars")!.textContent).toBe("★2");
  expect([...helm.querySelectorAll("button")].map(button => button.textContent)).toEqual(["Buy", "Craft"]);
  expect(view.row("common_bow").querySelector(".craft-hint")!.textContent).toBe("Craft At The Archery Range");
  expect(view.row("common_magic_armor").querySelector(".craft-hint")!.textContent).toBe("Craft At The Mage Tower");
  expect(view.row("common_bow").querySelectorAll("button").length).toBe(1);
  // A craft moves the line on before the server's row arrives.
  helm.querySelector<HTMLButtonElement>(".craft-offer button")!.click();
  expect(craft).toHaveBeenCalledWith("common_medium_helmet");
  await vi.waitFor(() => expect(view.row("uncommon_medium_helmet")).toBeTruthy());
});
