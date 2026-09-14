import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createItemGiftController } from "./item-gift-controller";
import { ALPHA_TESTER_GIFT_ITEM } from "../../shared/item-gifts";
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture() {
  vi.useFakeTimers();
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => fn());
  let owner = "guest", gift: { key: string; itemId: string } | null = { key: "gift:guest", itemId: ALPHA_TESTER_GIFT_ITEM };
  const claim = vi.fn(async () => ({ ok: true })), paused = vi.fn(), message = vi.fn(), afterDismiss = vi.fn();
  const controller = createItemGiftController({ canShow: () => true, identity: () => owner, gift: () => gift,
    claim, setPaused: paused, showMessage: message, afterDismiss });
  return { document, controller, claim, paused, message, afterDismiss,
    button: document.querySelector("button")!, overlay: document.getElementById("developerItemGift")!,
    clearGift() { gift = null; controller.refresh(); }, changeAccount() { owner = "other"; gift = null; controller.refresh(); } };
}
it("shows the helmet reward and celebrates one claim even when the server removes the pending row first", async () => {
  const h = fixture();
  expect(h.overlay.classList.contains("daily-gem-bonus")).toBe(true);
  expect(h.overlay.textContent).toContain("GIFT FROM DEVELOPER");
  expect(h.overlay.textContent).toContain("ALPHA TESTER HELMET");
  expect(h.document.querySelector("img")!.getAttribute("src")).toContain("superior-golden-helmet.png");
  let done!: (value: { ok: boolean }) => void;
  h.claim.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  h.button.click(); h.button.click(); h.clearGift();
  expect(h.claim).toHaveBeenCalledExactlyOnceWith("gift:guest");
  expect(h.overlay.hidden).toBe(false);
  done({ ok: true }); await settle();
  expect(h.button.textContent).toBe("CLAIMED!");
  vi.advanceTimersByTime(900);
  expect(h.overlay.hidden).toBe(true); expect(h.afterDismiss).toHaveBeenCalledOnce();
});
it("keeps failed claims available for retry", async () => {
  const h = fixture(); h.claim.mockRejectedValueOnce(new Error("offline"));
  h.button.click(); await settle();
  expect(h.overlay.hidden).toBe(false); expect(h.button.disabled).toBe(false);
  expect(h.message).toHaveBeenCalledOnce();
  h.button.click(); await settle(); expect(h.claim).toHaveBeenCalledTimes(2);
});
it("does not display an old account's claim after switching accounts", async () => {
  const h = fixture(); let done!: (value: { ok: boolean }) => void;
  h.claim.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  h.button.click(); h.changeAccount(); done({ ok: true }); await settle();
  expect(h.overlay.hidden).toBe(true); expect(h.afterDismiss).not.toHaveBeenCalled();
});
