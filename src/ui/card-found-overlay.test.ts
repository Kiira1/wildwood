import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { CARD_FOUND_SHOW_MS, createCardFoundOverlay } from "./card-found-overlay";
import { CARD_FRAME_COLORS } from "./card-portrait";
afterEach(() => vi.unstubAllGlobals());

function overlayPage() {
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
  let clock = 1_000;
  const timers: { at: number; done: () => void }[] = [];
  const overlay = createCardFoundOverlay({ root: document, wait: (ms, done) => {
    const timer = { at: clock + ms, done };
    timers.push(timer);
    return () => { timers.splice(timers.indexOf(timer), 1); };
  } });
  const element = document.querySelector<HTMLElement>(".card-found")!;
  const text = (selector: string) => element.querySelector(selector)?.textContent;
  const press = (key: string) => {
    const event = new window.Event("keydown");
    Object.defineProperty(event, "key", { value: key });
    document.dispatchEvent(event);
  };
  const later = (ms: number) => {
    clock += ms;
    for (const timer of timers.filter(entry => entry.at <= clock)) { timers.splice(timers.indexOf(timer), 1); timer.done(); }
  };
  return { overlay, element, text, press, later };
}

it("shows a card found with its rarity's colour, name, origin and effects, for a few seconds, never taking input", () => {
  const view = overlayPage();
  expect(view.element.hidden).toBe(true);
  view.overlay.show({ cardId: "dragon_card", artSource: "data:image/png;base64,AAAA" });
  expect(view.element.hidden).toBe(false);
  // Not a dialog: nothing waits on it, and taps go to the game (pointer-events: none in auto-farm.css).
  expect(view.element.getAttribute("role")).toBe("status");
  expect(view.element.dataset.rarity).toBe("boss");
  expect(view.element.style.getPropertyValue("--card-found-color")).toBe(CARD_FRAME_COLORS.boss.rim);
  expect(view.text(".card-found-kicker")).toBe("Boss Card Found");
  expect(view.text(".card-found-name")).toBe("Dragon Card");
  expect(view.text(".card-found-origin")).toContain("Boss");
  expect(view.element.querySelectorAll(".card-found-effects span").length).toBeGreaterThan(0);
  expect(view.element.querySelector("img")!.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  expect(view.element.querySelectorAll(".card-found-sparks span").length).toBe(14);
  expect(view.element.querySelector(".card-found-hint")).toBeNull();
  // A tap is not taken: it stays its time, then goes.
  view.element.click();
  expect(view.overlay.isOpen()).toBe(true);
  view.later(CARD_FOUND_SHOW_MS - 1);
  expect(view.overlay.isOpen()).toBe(true);
  view.later(1);
  expect(view.element.hidden).toBe(true);
  expect(view.overlay.isOpen()).toBe(false);
});

it("shows cards found together one after another, and Escape moves it on", () => {
  const view = overlayPage();
  view.overlay.show({ cardId: "needle_card", artSource: "" });
  view.overlay.show({ cardId: "king_slime_card", artSource: "" });
  view.overlay.show({ cardId: "not_a_card", artSource: "" });
  expect(view.text(".card-found-name")).toBe("Needle Card");
  view.later(CARD_FOUND_SHOW_MS);
  expect(view.text(".card-found-kicker")).toBe("Elite Card Found");
  expect(view.text(".card-found-name")).toBe("King Slime Card");
  view.press("Enter");
  expect(view.overlay.isOpen()).toBe(true);
  view.press("Escape");
  expect(view.overlay.isOpen()).toBe(false);
  // The King Slime card's timer went with it.
  view.later(CARD_FOUND_SHOW_MS);
  expect(view.overlay.isOpen()).toBe(false);
});
