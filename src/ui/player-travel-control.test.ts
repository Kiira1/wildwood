import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createPlayerTravelControl } from "./player-travel-control";
afterEach(() => vi.unstubAllGlobals());
it("hides without access, prevents duplicate requests, and restores controls after failure", async () => {
  const { document, Event } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document);
  let allowed = false, reject!: (reason: Error) => void;
  const travel = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  const showMessage = vi.fn();
  const control = createPlayerTravelControl(document.body, { allowed: () => allowed, travel, showMessage });
  const input = control.element.querySelector("input")!, button = control.element.querySelector("button")!;
  const submit = () => control.element.dispatchEvent(new Event("submit", { cancelable: true }));
  input.value = " saiko "; submit(); expect(travel).not.toHaveBeenCalled();
  allowed = true; control.render(); submit(); submit();
  expect(travel).toHaveBeenCalledExactlyOnceWith("saiko"); expect(button.disabled).toBe(true);
  reject(new Error("Player is offline.")); await Promise.resolve(); await Promise.resolve();
  expect(showMessage).toHaveBeenCalledWith("Player is offline.", "#ff9b91"); expect(button.disabled).toBe(false);
});
