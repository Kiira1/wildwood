import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createLeaderboardController } from "./leaderboard-controller";
import { LEADERBOARD_STATS } from "../../shared/leaderboard-window";
import type { LeaderboardEntry } from "../coop/contracts";

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const { document } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  const element = () => document.createElement("div");
  const elements = { button: element(), overlay: element(), closeButton: element(), valueHeading: element(), podium: element(), rows: element(), loading: element(), empty: element(),
    tabs: Object.fromEntries(LEADERBOARD_STATS.map(stat => [stat, element()])) as unknown as Record<typeof LEADERBOARD_STATS[number], HTMLElement> };
  const pending: Array<{ resolve: (rows: LeaderboardEntry[]) => void; reject: (error: Error) => void }> = [];
  const loadSnapshot = vi.fn(() => new Promise<LeaderboardEntry[]>((resolve, reject) => pending.push({ resolve, reject })));
  let identity = "me";
  const controller = createLeaderboardController(elements, { entries: () => [], loadSnapshot,
    localIdentity: () => identity, isDeveloper: () => false, paintProfileIcon: vi.fn(), drawPodiumCharacter: vi.fn(), openProfile: vi.fn(), beforeOpen: vi.fn() });
  return { elements, pending, loadSnapshot, controller, identity: (value: string) => { identity = value; } };
}
const entry = (rank: number, name: string) => ({ rank, identity: name, name, gender: 0, power: 1, damage: 1, maxHp: 1, armor: 1, regen: 1, playedSeconds: 1 } as LeaderboardEntry);
it("discards old tab responses and displays true ranks instead of renumbering the subset", async () => {
  const f = fixture();
  const first = f.controller.open();
  const second = f.controller.select("damage");
  f.pending[1].resolve([entry(1, "Winner"), entry(50000, "Near me")]);
  await second;
  expect(f.elements.rows.textContent).toContain("#50000");
  f.pending[0].resolve([entry(1, "Stale power")]);
  await first;
  expect(f.elements.rows.textContent).not.toContain("Stale power");
  expect(f.elements.loading.hidden).toBe(true);
  f.identity("someone else");
  f.controller.drawPodium();
  expect(f.elements.overlay.hidden).toBe(true);
});
it("shows errors, allows retry, and ignores responses after closing", async () => {
  const f = fixture();
  const first = f.controller.open();
  f.pending[0].reject(new Error("Network unavailable"));
  await first;
  expect(f.elements.empty.textContent).toBe("Network unavailable");
  const retry = f.controller.select("power");
  f.controller.close();
  f.pending[1].resolve([entry(1, "Late")]);
  await retry;
  expect(f.elements.overlay.hidden).toBe(true);
  expect(f.elements.rows.textContent).not.toContain("Late");
});

it("keeps the preview mounted during a stat fetch and reuses cached tab results", async () => {
  const f = fixture();
  const opening = f.controller.open();
  expect(f.elements.podium.hidden).toBe(false);
  expect(f.elements.podium.children).toHaveLength(3);
  f.pending[0].resolve([entry(1, "Power winner")]);
  await opening;
  const previousPlayer = f.elements.podium.firstElementChild;
  const switching = f.controller.select("health");
  expect(f.elements.podium.hidden).toBe(false);
  expect(f.elements.podium.getAttribute("aria-busy")).toBe("true");
  expect(f.elements.podium.firstElementChild).toBe(previousPlayer);
  expect(f.elements.podium.textContent).toContain("Power winner");
  f.pending[1].resolve([entry(1, "Health winner")]);
  await switching;
  expect(f.elements.podium.getAttribute("aria-busy")).toBe("false");
  expect(f.elements.podium.textContent).toContain("Health winner");
  await f.controller.select("power");
  expect(f.loadSnapshot).toHaveBeenCalledTimes(2);
  expect(f.elements.podium.hidden).toBe(false);
  expect(f.elements.podium.textContent).toContain("Power winner");
  const failed = f.controller.select("regen");
  f.pending[2].reject(new Error("Offline"));
  await failed;
  expect(f.elements.podium.hidden).toBe(false);
  expect(f.elements.podium.textContent).not.toContain("Power winner");
});
