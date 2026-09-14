import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createGameReleaseNotes } from "./game-release-notes";

afterEach(() => vi.unstubAllGlobals());

it("opens current notes outside startup and closes with the standard Back button", () => {
  const { document, window } = parseHTML('<html><body><div id="start" hidden></div><button id="version">v1</button></body></html>');
  vi.stubGlobal("document", document);
  const toggle = document.getElementById("version")!;
  toggle.focus = vi.fn();
  const releases = [{ version: "1", date: "Today", notes: ["Updated inventory."] }];
  const dialog = createGameReleaseNotes(toggle, () => releases);
  dialog.showModal = vi.fn(() => { dialog.setAttribute("open", ""); });
  dialog.close = vi.fn(() => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new window.Event("close"));
  });
  toggle.click();
  expect(dialog.parentElement).toBe(document.body);
  expect(dialog.showModal).toHaveBeenCalledOnce();
  expect(dialog.querySelector(".update-release")!.textContent).toContain("Updated inventory.");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  dialog.querySelector<HTMLButtonElement>(".window-back-button")!.click();
  expect(dialog.close).toHaveBeenCalledOnce();
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.focus).toHaveBeenCalledWith({ preventScroll: true });
});
