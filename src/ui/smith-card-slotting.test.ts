import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createSmithController, type SmithItem } from "./smith-window";
import { IRON_BOW, STARTER_BOW, WOODEN_ARMOR } from "../../shared/items";

vi.mock("./card-portrait", () => ({ cardPortrait: async () => "" }));
afterEach(() => vi.unstubAllGlobals());

function smith(extra: Partial<Parameters<typeof createSmithController>[0]> = {}) {
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  const held: Record<string, number> = { needle_card: 2, brood_card: 1 };
  const gear: Record<string, { slots: number; cards: string[] }> = {
    [`${STARTER_BOW}:0`]: { slots: 2, cards: ["needle_card"] },
    [`${IRON_BOW}:4`]: { slots: 1, cards: [] },
    [`${WOODEN_ARMOR}:0`]: { slots: 0, cards: [] },
  };
  const items: SmithItem[] = [
    { itemId: STARTER_BOW, copyId: 0n, equipped: true },
    { itemId: IRON_BOW, copyId: 4n, equipped: false },
    { itemId: WOODEN_ARMOR, copyId: 0n, equipped: false },
  ];
  const slotCard = vi.fn<(itemId: string, copyId: bigint, cardId: string, expectedCards: number) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true }));
  const showMessage = vi.fn();
  const controller = createSmithController({
    inTown: () => true, items: () => items, refineLevel: () => 0, slotTier: () => 0,
    ores: () => ({ copper_ore: 1 }), refine: async () => ({ ok: true }), showMessage,
    cards: () => held, gearSlots: (itemId, copyId) => gear[`${itemId}:${copyId}`], slotCard, ...extra,
  });
  const dialog = document.querySelector("dialog") as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  const q = (selector: string) => dialog.querySelector(selector) as unknown as HTMLButtonElement;
  const choices = () => [...dialog.querySelectorAll<HTMLButtonElement>(".smith-choice")];
  controller.open();
  q('[data-tab="cards"]').click();
  return { controller, dialog, q, choices, held, gear, slotCard, showMessage };
}

it("shows the chosen copy's cards and only owned cards that fit its slot", () => {
  const view = smith();
  expect(view.q(".smith-stat").textContent).toBe("Card Slots 1 / 2");
  expect(view.q(".smith-slot.is-filled").textContent).toBe("Needle Card");
  expect([...view.dialog.querySelectorAll("[data-card-id]")].map(card => card.getAttribute("data-card-id"))).toEqual(["needle_card"]);
  expect(view.q('[data-card-id="needle_card"]').getAttribute("aria-label")).toBe("Needle Card, 2");
  expect(view.q(".smith-focus .smith-refine")).toBeNull();
  view.q('[data-card-id="needle_card"]').click();
  expect(view.q(".smith-focus").textContent).toContain("A slotted card stays in for good.");
  expect(view.slotCard).not.toHaveBeenCalled();
  expect(view.q(".smith-ores").hidden).toBe(true);
  view.q('[data-tab="refine"]').click();
  expect(view.q(".smith-ores").hidden).toBe(false);
  expect(view.q(".smith-cards").hidden).toBe(true);
});

it("slots the exact kept copy once and waits for authoritative card rows", async () => {
  const view = smith();
  view.choices()[1].click();
  view.q('[data-card-id="needle_card"]').click();
  let finish!: (result: { ok: boolean }) => void;
  view.slotCard.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const slot = view.q(".smith-focus .smith-refine");
  slot.click();
  slot.click();
  expect(view.slotCard).toHaveBeenCalledExactlyOnceWith(IRON_BOW, 4n, "needle_card", 0);
  expect(view.q(".smith-focus .smith-refine").disabled).toBe(true);
  expect(view.q('[data-card-id="needle_card"]').disabled).toBe(true);
  expect(view.choices().every(choice => choice.disabled)).toBe(true);
  view.choices()[0].click();
  view.q('[data-tab="refine"]').click();
  expect(view.q(".smith-stat").textContent).toBe("Card Slots 0 / 1");
  // The reducer result is not an inventory update. Only rows change counts and slots.
  finish({ ok: true });
  await vi.waitFor(() => expect(view.q(".smith-outcome")?.textContent).toBe("Needle Card slotted into Stone Bow."));
  expect(view.held.needle_card).toBe(2);
  expect(view.gear[`${IRON_BOW}:4`].cards).toEqual([]);
  view.held.needle_card = 1;
  view.gear[`${IRON_BOW}:4`].cards = ["needle_card"];
  view.controller.render();
  expect(view.q(".smith-stat").textContent).toBe("Card Slots 1 / 1");
  expect(view.q(".smith-cards-note").textContent).toBe("Every slot in this gear is full.");
  expect(view.q(".smith-focus .smith-refine")).toBeNull();
});

it("reports a refusal and retries with the same observed slot count", async () => {
  const view = smith();
  view.slotCard.mockResolvedValueOnce({ ok: false, error: "Request timed out. Try again." });
  view.q('[data-card-id="needle_card"]').click();
  view.q(".smith-focus .smith-refine").click();
  await vi.waitFor(() => expect(view.q(".smith-outcome")?.textContent).toBe("Request timed out. Try again."));
  expect(view.q(".smith-focus .smith-refine").disabled).toBe(false);
  expect(view.held.needle_card).toBe(2);
  view.q(".smith-focus .smith-refine").click();
  await vi.waitFor(() => expect(view.slotCard).toHaveBeenCalledTimes(2));
  expect(view.slotCard).toHaveBeenLastCalledWith(STARTER_BOW, 0n, "needle_card", 1);
});

it("explains zero-slot gear and clears a card that is no longer held", () => {
  const view = smith();
  view.q('[data-card-id="needle_card"]').click();
  delete view.held.needle_card;
  view.controller.render();
  expect(view.q(".smith-focus .smith-refine")).toBeNull();
  view.choices()[2].click();
  expect(view.q(".smith-cards-note").textContent).toBe("This gear has no card slots.");
  expect(view.q("[data-card-id]")).toBeNull();
});

it("preserves controls for unrelated updates and refreshes changed card counts", () => {
  const view = smith();
  const tile = view.q('[data-card-id="needle_card"]');
  view.controller.render();
  expect(view.q('[data-card-id="needle_card"]')).toBe(tile);
  view.held.needle_card = 3;
  view.controller.render();
  expect(view.q('[data-card-id="needle_card"]').getAttribute("aria-label")).toBe("Needle Card, 3");
});

it("takes a slotted card back out for Starshards after a second tap", async () => {
  const ores: Record<string, number> = { starshard: 4 };
  const removeCard = vi.fn(async () => ({ ok: true }));
  const view = smith({ ores: () => ores, removeCard });
  const remove = () => view.q(".smith-slot.is-filled .smith-slot-remove");
  expect(view.q(".smith-focus").textContent).not.toContain("for good");
  expect(remove().textContent).toBe("Need 5 Starshards");
  expect(remove().disabled).toBe(true);
  ores.starshard = 5;
  view.controller.render();
  expect(remove().textContent).toBe("Remove · 5 Starshards");
  remove().click();
  expect(removeCard).not.toHaveBeenCalled();
  expect(remove().textContent).toBe("Confirm Remove");
  remove().click();
  expect(removeCard).toHaveBeenCalledExactlyOnceWith(STARTER_BOW, 0n, 0, 1);
  await vi.waitFor(() => expect(view.q(".smith-outcome")?.textContent).toBe("Needle Card is back in your cards."));
  expect(view.showMessage).toHaveBeenCalledWith("Card Removed · Needle Card", "#ffd75e");
});
