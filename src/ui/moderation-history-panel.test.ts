import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import { createModerationHistoryPanel } from "./moderation-history-panel";
import type { ModerationHistoryPage } from "../../shared/moderation-history";
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const { document } = parseHTML("<html><body><section></section></body></html>");
  vi.stubGlobal("document", document);
  return document.querySelector("section") as unknown as HTMLElement;
}
const page: ModerationHistoryPage = { beforeId: "51", hasMore: true, entries: [{ id: "100",
  targetIdentity: "account", targetName: "Player", channel: "world", messageId: "5", action: "Message removed",
  reason: "harassment", actorType: "developer", actorIdentity: "moderator", actorName: "Ryan", rule: "",
  reportTable: "chat_message_report", reportId: "6", before: "<img src=x onerror=alert(1)>",
  after: "Message moderated.", recordedAtMs: 1234567890,
}] };
it("loads only when opened, displays evidence as text, and loads older using the cursor", async () => {
  const container = setup();
  const load = vi.fn(async (_cursor: string) => page);
  const panel = createModerationHistoryPanel(container, load);
  expect(load).not.toHaveBeenCalled();
  panel.open();
  await vi.waitFor(() => expect(container.querySelectorAll("details")).toHaveLength(1));
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain(page.entries[0].before);
  expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
  load.mockResolvedValueOnce({ entries: [], beforeId: "1", hasMore: false });
  (container.querySelectorAll("button")[1] as HTMLButtonElement).click();
  await vi.waitFor(() => expect(load).toHaveBeenLastCalledWith("51"));
  await vi.waitFor(() => expect(container.querySelectorAll("button")[1].hidden).toBe(true));
});
it("clears private evidence and discards responses arriving after the tab closes", async () => {
  const container = setup();
  let resolve!: (page: ModerationHistoryPage) => void;
  const panel = createModerationHistoryPanel(container, () => new Promise(done => { resolve = done; }));
  panel.open(); panel.clear(); resolve(page);
  await Promise.resolve();
  expect(container.querySelector("details")).toBeNull();
  expect(container.textContent).not.toContain("Player");
});
