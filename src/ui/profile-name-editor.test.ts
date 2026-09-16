import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createProfileNameEditor } from "./profile-name-editor";
import type { NameChangeStatus } from "../../shared/name-change";

beforeEach(() => {
  const { document } = parseHTML('<html><body><div id="overlay" hidden><form><input><button></button></form></div></body></html>');
  vi.stubGlobal("document", document);
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 0);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture(status: Partial<NameChangeStatus> = {}) {
  const elements = { overlay: document.getElementById("overlay")!, form: document.querySelector("form")!, input: document.querySelector("input")!, save: document.querySelector("button")! };
  const api = { localDisplayName: () => "Current Name", isNameTaken: () => false,
    getNameChangeStatus: vi.fn(async (): Promise<NameChangeStatus> => ({ cost: 0, availableAtMs: 0, serverNowMs: 100, balance: 100, ...status })),
    setDisplayName: vi.fn(async (_name: string, _cost: number) => ({ ok: true })), showMessage: vi.fn() };
  const editor = createProfileNameEditor(elements, api);
  const submit = () => elements.form.dispatchEvent(new document.defaultView!.Event("submit", { cancelable: true }));
  return { elements, api, editor, submit, note: () => elements.form.querySelector("p")!.textContent };
}

it("shows the free price and explicitly submits the displayed paid price later", async () => {
  const f = fixture();
  await f.editor.open();
  expect(f.elements.save.textContent).toBe("Save · Free");
  expect(f.note()).toContain("Then 50 Gems");
  f.editor.close();
  f.api.getNameChangeStatus.mockResolvedValue({ cost: 50, availableAtMs: 0, serverNowMs: 100, balance: 50 });
  await f.editor.open();
  expect(f.elements.save.textContent).toBe("Save · 50 Gems");
  f.elements.input.value = "New Name";
  f.submit(); f.submit();
  expect(f.api.setDisplayName).toHaveBeenCalledExactlyOnceWith("New Name", 50);
  await Promise.resolve();
  expect(f.elements.overlay.hidden).toBe(true);
});

it("blocks saving during cooldown and enables at its boundary using server time", async () => {
  const f = fixture({ cost: 50, availableAtMs: 1100 });
  await f.editor.open();
  expect(f.elements.save.disabled).toBe(true);
  expect(f.note()).toContain("Available in");
  f.submit(); expect(f.api.setDisplayName).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(f.elements.save.disabled).toBe(false);
  f.editor.close();
});

it("blocks insufficient funds and unavailable pricing", async () => {
  const f = fixture({ cost: 50, balance: 49 });
  await f.editor.open();
  expect(f.note()).toContain("need 50 Gems");
  expect(f.elements.save.disabled).toBe(true);
  f.api.getNameChangeStatus.mockRejectedValue(new Error("offline"));
  await f.editor.open();
  expect(f.note()).toContain("Couldn't check");
  expect(f.elements.save.disabled).toBe(true);
  f.editor.close();
});

it("ignores a quote arriving after the editor closes", async () => {
  const f = fixture();
  let resolve!: (value: NameChangeStatus) => void;
  f.api.getNameChangeStatus.mockReturnValue(new Promise(r => { resolve = r; }));
  const opened = f.editor.open();
  f.editor.close();
  resolve({ cost: 50, balance: 100, availableAtMs: 0, serverNowMs: 100 });
  await opened;
  expect(f.elements.overlay.hidden).toBe(true);
  expect(f.elements.save.disabled).toBe(true);
});
