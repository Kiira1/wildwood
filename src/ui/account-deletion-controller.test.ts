import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { installAccountDeletion } from "./account-deletion-controller";
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const { document, window } = parseHTML('<html><body><section id="settings-account-panel"></section></body></html>');
  let owner = "test";
  const request = vi.fn(async () => ({ ok: true }));
  installAccountDeletion(document, { identity: () => owner, request });
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  dialog.showModal = () => dialog.setAttribute("open", "");
  dialog.close = () => { dialog.removeAttribute("open"); dialog.dispatchEvent(new window.Event("close")); };
  const click = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!.click();
  click("#deleteAccountButton");
  return { request, click, dialog, owner: (name: string) => { owner = name; } };
}
it("requires explicit confirmation then waits 10 seconds, permitting cancellation", async () => {
  const f = fixture(); await vi.advanceTimersByTimeAsync(20_000); expect(f.request).not.toHaveBeenCalled();
  f.click("[data-delete-confirm]"); await vi.advanceTimersByTimeAsync(9_000); expect(f.request).not.toHaveBeenCalled();
  f.click("[data-delete-cancel]"); await vi.advanceTimersByTimeAsync(5_000); expect(f.request).not.toHaveBeenCalled();
  f.click("#deleteAccountButton"); f.click("[data-delete-confirm]");
  await vi.advanceTimersByTimeAsync(10_000); expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.dialog.textContent).toContain("Deletion requested.");
});
it("cancels when the character changes during the grace period", async () => {
  const f = fixture(); f.click("[data-delete-confirm]"); f.owner("other");
  await vi.advanceTimersByTimeAsync(11_000); expect(f.request).not.toHaveBeenCalled();
});
