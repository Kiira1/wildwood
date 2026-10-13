import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createSmithController, type SmithItem } from "./smith-window";
import { IRON_BOW, STARTER_BOW, STARTER_STONE, WOODEN_ARMOR } from "../../shared/items";
import type { OreId } from "../../shared/refine";
afterEach(() => vi.unstubAllGlobals());

// The server rolls every try (refine_item); the window shows the odds, sends the level the player saw, and shows the verdict.
function smith(options: { inTown?: boolean; ores?: Partial<Record<OreId, number>>; pickaxe?: boolean; mining?: number } = {}) {
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
  const controller = createSmithController({
    inTown: () => options.inTown ?? true, items: () => items, refine, showMessage,
    hasPickaxe: () => pickaxe, claimPickaxe, mining: () => options.mining ?? 0,
    refineLevel: (itemId, copyId) => levels[`${itemId}:${copyId}`] ?? 0, slotTier: () => 0,
    ores: () => options.ores ?? { copper_ore: 3 },
  });
  const dialog = document.querySelector("dialog") as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  const q = (selector: string) => dialog.querySelector(selector) as unknown as HTMLElement;
  const facts = () => Object.fromEntries([...dialog.querySelectorAll(".smith-facts div")].map(row => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]));
  const choices = () => [...dialog.querySelectorAll<HTMLElement>(".smith-choice")];
  return { controller, dialog, q, facts, choices, refine, showMessage, levels, claimPickaxe };
}

it("lists only gear the Smith can refine, worn first, and shows a risky try's odds and what a fail costs", () => {
  const view = smith();
  view.controller.open();
  expect(view.choices().map(choice => choice.getAttribute("aria-label"))).toEqual(["Bow ★7, worn", "Iron Bow", "Wooden Armor ★2"]);
  expect(view.q(".smith-item strong").textContent).toBe("Bow ★7");
  // The starter bow is safe to ★7 (grade 1); +8 is the first risky step.
  expect(view.facts()).toEqual({ Chance: "60%", "Safe to": "★7", "If it fails": "Drops to ★6", Costs: "1 Copper Ore" });
  expect(view.q(".smith-stat").textContent).toMatch(/^Damage \+[\d.]+% → \+[\d.]+%$/);
  const button = view.q(".smith-refine") as HTMLButtonElement;
  expect([button.textContent, button.disabled]).toEqual(["Refine", false]);
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
  view.levels[`${STARTER_BOW}:0`] = 7;
  view.controller.showResult({ itemId: STARTER_BOW, copyId: 0n, fromLevel: 8, toLevel: 7, succeeded: false });
  expect(view.q(".smith-outcome").textContent).toBe("It failed. Dropped to ★7.");
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

it("keeps the pickaxe on offer when the server refuses, and says why", async () => {
  const view = smith();
  view.claimPickaxe.mockResolvedValueOnce({ ok: false, error: "Talk to the Smith first." } as never);
  view.controller.open();
  const button = view.q(".smith-pickaxe") as HTMLButtonElement;
  button.click();
  await vi.waitFor(() => expect(view.showMessage).toHaveBeenCalledWith("Talk to the Smith first.", "#ff9b91"));
  expect([button.hidden, button.disabled]).toEqual([false, false]);
});
