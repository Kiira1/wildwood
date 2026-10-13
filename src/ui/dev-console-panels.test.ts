import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import type { DevConsole } from "../../shared/dev-console";
import { createDevConsolePanels, type DevConsoleApi } from "./dev-console-panels";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const NOW = 1_700_000_000_000;

function harness() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const { document } = parseHTML("<html><body><section id=m></section><section id=b></section><section id=d></section></body></html>");
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", globalThis);
  const data: DevConsole = {
    overview: { pendingReports: 1, openBugs: 2, muted: 2, banned: 2, deletions: 2 },
    muted: [
      { identity: "aa", displayName: "Soon", mutedUntilMs: NOW + 3_000, startedAtMs: NOW - 60_000, muteCount: 1, source: "automatic", reason: "3 filtered" },
      { identity: "bb", displayName: "Later", mutedUntilMs: NOW + 90 * 60_000, startedAtMs: NOW - 60_000, muteCount: 2, source: "developer", reason: "" },
    ],
    banned: [
      { identity: "cc", displayName: "Timed", bannedUntilMs: NOW + 3_600_000, permanent: false, startedAtMs: NOW, reason: "spam", by: "Rymel" },
      { identity: "dd", displayName: "Forever", bannedUntilMs: 0, permanent: true, startedAtMs: NOW, reason: "cheating", by: "Automatic" },
    ],
    deletions: [
      { identity: "ee11223344556677", displayName: "Leaving", requestedAtMs: NOW - 2 * 86_400_000, status: "pending" },
      { identity: "ff11223344556677", displayName: "Late", requestedAtMs: NOW - 31 * 86_400_000, status: "erasing" },
    ],
    serverNowMs: NOW,
  };
  const api: DevConsoleApi = {
    console: vi.fn(async () => data), serverNow: () => Date.now(),
    setChatMute: vi.fn(async () => ({ ok: true })), suspend: vi.fn(async () => ({ ok: true })), liftSuspension: vi.fn(async () => ({ ok: true })),
    eraseAccount: vi.fn(async () => ({ ok: true })),
  };
  const confirm = vi.fn(async () => true);
  const overview = vi.fn();
  const openPlayer = vi.fn();
  const muted = document.getElementById("m") as unknown as HTMLElement;
  const banned = document.getElementById("b") as unknown as HTMLElement;
  const deletions = document.getElementById("d") as unknown as HTMLElement;
  const panels = createDevConsolePanels({ muted, banned, deletions }, {
    api: () => api, confirm, showMessage: vi.fn(), openPlayer, onOverview: overview, onAccessDenied: vi.fn(),
  });
  const button = (root: HTMLElement, label: string, index = 0) =>
    [...root.querySelectorAll("button")].filter(element => element.textContent === label)[index] as HTMLButtonElement;
  return { panels, api, confirm, overview, openPlayer, muted, banned, deletions, button };
}

describe("muted and banned tabs", () => {
  it("counts down each second and drops a mute the moment it ends", async () => {
    const h = harness();
    h.panels.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect([...h.muted.querySelectorAll(".dev-console-name")].map(node => node.textContent)).toEqual(["Soon", "Later"]);
    expect(h.muted.textContent).toContain("Automatic");
    expect(h.banned.textContent).toContain("Permanent");
    expect(h.overview).toHaveBeenLastCalledWith({ pendingReports: 1, openBugs: 2, muted: 2, banned: 2, deletions: 2 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect([...h.muted.querySelectorAll(".dev-console-name")].map(node => node.textContent)).toEqual(["Later"]);
    expect(h.overview).toHaveBeenLastCalledWith({ pendingReports: 1, openBugs: 2, muted: 1, banned: 2, deletions: 2 });
    h.panels.setActive(false);
  });

  it("unmutes after a confirm, extends by the time left plus the step, and opens the player", async () => {
    const h = harness();
    await h.panels.load();
    h.button(h.muted, "Unmute", 1).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.confirm).toHaveBeenCalled();
    expect(h.api.setChatMute).toHaveBeenLastCalledWith("bb", 0);
    h.button(h.muted, "+1h", 1).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.api.setChatMute).toHaveBeenLastCalledWith("bb", 150);
    h.button(h.banned, "Player").click();
    expect(h.openPlayer).toHaveBeenCalledWith("cc", "Timed");
    expect(h.button(h.banned, "+24h", 1).disabled).toBe(true);
  });
});

describe("deletions tab", () => {
  it("lists requests oldest first with their 30-day deadline, and erases one after a confirm", async () => {
    const h = harness();
    await h.panels.load();
    expect([...h.deletions.querySelectorAll(".dev-console-name")].map(node => node.textContent)).toEqual(["Leaving", "Late"]);
    expect(h.deletions.textContent).toContain("28d 0h left");
    expect(h.deletions.textContent).toContain("Overdue");
    expect(h.button(h.deletions, "Erase Again")).toBeTruthy();
    h.button(h.deletions, "Erase").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true, confirmLabel: "Erase" }));
    expect(h.api.eraseAccount).toHaveBeenLastCalledWith("ee11223344556677", "In-game deletion request");
  });
});
