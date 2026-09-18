import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createMailboxController, type MailboxCard } from "./mailbox-controller";

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const { document, window } = parseHTML('<html><body><button id="mail"></button><button id="version"></button></body></html>');
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
  let owner = "first";
  let messages: MailboxCard[] = [{ id: "gift", title: "What happened to my stats?", body: "Old power → estimated progress → new power.", gems: 75n, createdAtMs: 1000, read: false, claimed: false }];
  const claim = vi.fn(async () => ({ ok: true })), read = vi.fn(async () => ({ ok: true }));
  const button = document.getElementById("mail") as HTMLButtonElement; button.focus = vi.fn();
  const ui = createMailboxController(button, document.getElementById("version")!, { identity: () => owner, canOpen: () => true, connected: () => true,
    messages: () => messages, releases: () => [{ version: "test", notes: ["Mailbox added."] }], claim, read });
  const dialog = document.getElementById("gameMailbox") as HTMLDialogElement;
  Object.defineProperty(dialog, "open", { get: () => dialog.hasAttribute("open") });
  dialog.showModal = () => { dialog.setAttribute("open", ""); };
  dialog.close = () => { dialog.removeAttribute("open"); dialog.dispatchEvent(new window.Event("close")); };
  return { document, ui, button, dialog, read, claim, owner: (value: string) => { owner = value; }, messages: (value: MailboxCard[]) => { messages = value; } };
}
it("arrival stays passive; list does not read/claim mail, opening a letter reads it", async () => {
  const f = fixture(); f.ui.refresh();
  expect(f.dialog.open).toBe(false); expect(f.claim).not.toHaveBeenCalled();
  f.button.click(); expect(f.dialog.open).toBe(true); expect(f.read).not.toHaveBeenCalled();
  f.document.querySelector<HTMLButtonElement>(".mailbox-row")!.click();
  await Promise.resolve();
  expect(f.read).toHaveBeenCalledWith("gift"); expect(f.claim).not.toHaveBeenCalled();
  const letter = f.document.querySelector(".mailbox-letter")!;
  expect(letter.textContent).toContain("Old power");
  expect([...letter.children].findIndex(node => node.classList.contains("mailbox-reward"))).toBeLessThan([...letter.children].findIndex(node => node.tagName === "P"));
});
it("claims once and retains the claimed state while waiting for subscriptions", async () => {
  const f = fixture(); f.ui.open(); f.document.querySelector<HTMLButtonElement>(".mailbox-row")!.click();
  const button = f.document.querySelector<HTMLButtonElement>(".mailbox-claim-button")!;
  button.click(); button.click(); await Promise.resolve(); await Promise.resolve();
  expect(f.claim).toHaveBeenCalledTimes(1);
  expect(f.document.querySelector<HTMLButtonElement>(".mailbox-claim-button")!.disabled).toBe(true);
  expect(f.document.querySelector(".mailbox-claim-button")!.textContent).toBe("Claimed");
});
it("version opens mailbox updates and account changes close and clear the old inbox", () => {
  const f = fixture(); f.document.getElementById("version")!.click();
  expect(f.dialog.textContent).toContain("Mailbox added.");
  f.owner("other"); f.messages([]); f.ui.refresh(); expect(f.dialog.open).toBe(false);
  f.ui.open(); expect(f.dialog.textContent).not.toContain("What happened to my stats?");
});
