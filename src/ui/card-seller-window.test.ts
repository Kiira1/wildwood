import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { cardShopCountdown, createCardSellerController } from "./card-seller-window";
import { CARD_SHOP_ROTATION_MS, cardShopOffer, cardShopPrice, cardShopRotation } from "../../shared/card-shop";
import { cardDefinition } from "../../shared/cards";

vi.mock("./card-portrait", () => ({ cardPortrait: async () => "" }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const START = Date.UTC(2026, 9, 16, 12);
const ROTATION = cardShopRotation(START);

function seller(extra: Partial<Parameters<typeof createCardSellerController>[0]> = {}) {
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  const clock = { now: START + 46 * 60_000 };
  const ores: Record<string, number> = { copper_ore: 500, iron_ore: 500, mithril_ore: 500, adamant_ore: 500, starshard: 50 };
  const bought: Record<number, string[]> = {};
  const buy = vi.fn<(rotation: number, cardId: string) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true }));
  const showMessage = vi.fn();
  const controller = createCardSellerController({
    inTown: () => true, showMessage, now: () => clock.now, ores: () => ores, cards: () => ({}),
    bought: rotation => bought[rotation] ?? [], buy, ...extra,
  });
  const dialog = document.querySelector("dialog") as unknown as HTMLDialogElement;
  Object.assign(dialog, { showModal() { dialog.setAttribute("open", ""); }, close() { dialog.removeAttribute("open"); } });
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  const q = (selector: string) => dialog.querySelector(selector) as unknown as HTMLElement;
  const rows = () => [...dialog.querySelectorAll<HTMLElement>(".card-seller-offer")];
  const button = (cardId: string) => dialog.querySelector(`.card-seller-offer[data-card-id="${cardId}"] .card-seller-buy`) as unknown as HTMLButtonElement;
  return { controller, dialog, q, rows, button, clock, ores, bought, buy, showMessage };
}

it("counts down to the next cards", () => {
  expect(cardShopCountdown(2 * 3_600_000 + 14 * 60_000 + 30_000)).toBe("2h 14m");
  expect(cardShopCountdown(14 * 60_000 + 59_000)).toBe("14m");
  expect(cardShopCountdown(45_000)).toBe("45s");
  expect(cardShopCountdown(-5)).toBe("0s");
});

it("shows the rotation's three cards with their rarity, gear, effects, price and the ores held", () => {
  const view = seller();
  view.controller.open();
  expect(view.q(".window-banner").textContent).toBe("Card Seller");
  expect(view.q(".card-seller-timer").textContent).toBe("New cards in 2h 14m");
  const offer = cardShopOffer(ROTATION);
  expect(view.rows().map(row => row.dataset.cardId)).toEqual(offer);
  const card = cardDefinition(offer[0])!;
  const row = view.rows()[0];
  expect(row.querySelector("strong")!.textContent).toBe(`${card.enemy} Card`);
  expect(row.querySelector(".card-origin")!.textContent).toMatch(/^(Regular|Elite|Boss) · /);
  expect(row.querySelector(".card-seller-slot")!.textContent).toMatch(/^Goes In: (Weapon|Helmet|Armor)$/);
  expect(row.querySelectorAll(".card-seller-effects li")).toHaveLength(card.effects.length);
  const price = Object.entries(cardShopPrice(card.id)!);
  const lines = [...row.querySelectorAll(".card-seller-price li")].map(line => line.textContent);
  expect(lines).toHaveLength(price.length);
  expect(lines[0]).toMatch(/^\d+ (Copper|Iron|Mithril|Adamant) OreYou Have 500$/);
  expect(view.button(card.id).textContent).toBe("Buy");
  expect(view.button(card.id).disabled).toBe(false);
});

it("buys a card once, then reads Bought", async () => {
  const view = seller();
  view.controller.open();
  const [first, second] = cardShopOffer(ROTATION);
  view.button(first).click();
  expect(view.buy).toHaveBeenCalledWith(ROTATION, first);
  expect(view.button(first).textContent).toBe("Buying…");
  expect(view.button(second).disabled).toBe(true);
  await vi.waitFor(() => expect(view.button(first).textContent).toBe("Bought"));
  expect(view.button(first).disabled).toBe(true);
  expect(view.button(second).disabled).toBe(false);
  expect(view.showMessage).toHaveBeenCalledWith(expect.stringContaining("Card Bought"), "#ffd75e");
});

it("shows Bought from the server's rows, and which ore is short", () => {
  const view = seller();
  const [first, second] = cardShopOffer(ROTATION);
  view.bought[ROTATION] = [first];
  const ore = Object.keys(cardShopPrice(second)!).find(id => id !== "starshard")!;
  view.ores[ore] = 3;
  view.controller.open();
  expect(view.button(first).textContent).toBe("Bought");
  expect(view.button(second).disabled).toBe(true);
  expect(view.button(second).textContent).toContain("Need");
  expect(view.dialog.querySelector(`[data-card-id="${second}"] .is-short`)!.textContent).toContain("You Have 3");
});

it("shows the server's refusal", async () => {
  const view = seller({ buy: async () => ({ ok: false, error: "The Card Seller has new cards now. Take another look." }) });
  view.controller.open();
  view.button(cardShopOffer(ROTATION)[0]).click();
  await vi.waitFor(() => expect(view.q(".smith-outcome").hidden).toBe(false));
  expect(view.q(".smith-outcome").textContent).toContain("new cards");
});

it("turns over to the next cards while open", () => {
  vi.useFakeTimers();
  const view = seller();
  view.clock.now = (ROTATION + 1) * CARD_SHOP_ROTATION_MS - 2_000;
  view.controller.open();
  expect(view.q(".card-seller-timer").textContent).toBe("New cards in 2s");
  view.clock.now += 3_000;
  vi.advanceTimersByTime(1_000);
  expect(view.rows().map(row => row.dataset.cardId)).toEqual(cardShopOffer(ROTATION + 1));
  expect(view.q(".card-seller-timer").textContent).toBe("New cards in 2h 59m");
  view.controller.close();
  expect(vi.getTimerCount()).toBe(0);
});
