import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { CARD_FOUND_TAP_GUARD_MS, createCardFoundOverlay } from "./card-found-overlay";
import { CARD_FRAME_COLORS } from "./card-portrait";
afterEach(() => vi.unstubAllGlobals());

function overlayPage() {
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
  let clock = 1_000;
  const overlay = createCardFoundOverlay({ root: document, now: () => clock });
  const element = document.querySelector<HTMLElement>(".card-found")!;
  const text = (selector: string) => element.querySelector(selector)?.textContent;
  const press = (key: string) => {
    const event = new window.Event("keydown");
    Object.defineProperty(event, "key", { value: key });
    document.dispatchEvent(event);
  };
  return { overlay, element, text, press, later: (ms: number) => { clock += ms; } };
}

it("shows a card found with its rarity's colour, name, origin and effects, and stays until tapped", () => {
  const view = overlayPage();
  expect(view.element.hidden).toBe(true);
  view.overlay.show({ cardId: "dragon_card", artSource: "data:image/png;base64,AAAA" });
  expect(view.element.hidden).toBe(false);
  expect(view.element.dataset.rarity).toBe("boss");
  expect(view.element.style.getPropertyValue("--card-found-color")).toBe(CARD_FRAME_COLORS.boss.rim);
  expect(view.text(".card-found-kicker")).toBe("Boss Card Found");
  expect(view.text(".card-found-name")).toBe("Dragon Card");
  expect(view.text(".card-found-origin")).toContain("Boss");
  expect(view.element.querySelectorAll(".card-found-effects span").length).toBeGreaterThan(0);
  expect(view.element.querySelector("img")!.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  expect(view.element.querySelectorAll(".card-found-sparks span").length).toBe(14);
  expect(view.text(".card-found-hint")).toBe("Tap to Continue");
  // No timer: it is still there much later.
  view.later(60_000);
  expect(view.overlay.isOpen()).toBe(true);
  view.element.click();
  expect(view.element.hidden).toBe(true);
  expect(view.overlay.isOpen()).toBe(false);
});

it("ignores a stray tap as the card appears, and shows cards found together one after another", () => {
  const view = overlayPage();
  view.overlay.show({ cardId: "needle_card", artSource: "" });
  view.overlay.show({ cardId: "king_slime_card", artSource: "" });
  view.overlay.show({ cardId: "not_a_card", artSource: "" });
  view.element.click();
  expect(view.text(".card-found-name")).toBe("Needle Card");
  view.later(CARD_FOUND_TAP_GUARD_MS);
  view.element.click();
  expect(view.text(".card-found-kicker")).toBe("Elite Card Found");
  expect(view.text(".card-found-name")).toBe("King Slime Card");
  view.later(CARD_FOUND_TAP_GUARD_MS);
  view.press("Enter");
  expect(view.overlay.isOpen()).toBe(true);
  view.press("Escape");
  expect(view.overlay.isOpen()).toBe(false);
});
