import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createLeaderboardController } from "./leaderboard-controller";
import { LEADERBOARD_STATS, type LeaderboardPage } from "../../shared/leaderboard-window";
import type { LeaderboardEntry } from "../coop/contracts";

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const { document } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  const element = () => document.createElement("div");
  const elements = { button: element(), overlay: element(), closeButton: element(), valueHeading: element(), podium: element(), rows: element(), loading: element(), empty: element(),
    tabs: Object.fromEntries(LEADERBOARD_STATS.map(stat => [stat, element()])) as unknown as Record<typeof LEADERBOARD_STATS[number], HTMLElement> };
  elements.rows.scrollTop = 0;
  Object.defineProperty(elements.rows, "clientHeight", { value: 320 });
  Object.defineProperty(elements.rows, "scrollHeight", { get: () => elements.rows.children.length * 40 });
  document.defaultView!.HTMLElement.prototype.getBoundingClientRect = function () {
    const index = [...elements.rows.children].indexOf(this);
    const top = index < 0 ? 0 : index * 40 - elements.rows.scrollTop;
    return { top, bottom: top + (index < 0 ? 320 : 40), height: index < 0 ? 320 : 40, left: 0, right: 400, width: 400, x: 0, y: top, toJSON() {} };
  };
  const pending: Array<{ resolve: (rows: LeaderboardEntry[]) => void; resolvePage: (page: LeaderboardPage<LeaderboardEntry>) => void; reject: (error: Error) => void }> = [];
  const loadPage = vi.fn(() => new Promise<LeaderboardPage<LeaderboardEntry>>((resolve, reject) => pending.push({
    resolve: entries => {
      const localRank = entries.find(row => row.identity === "me")?.rank ?? 0;
      const startRank = Math.min(...entries.filter(row => row.rank! > 3).map(row => row.rank!), 1_000_000);
      const total = Math.max(0, ...entries.map(row => row.rank!));
      resolve({ entries, localRank, startRank: startRank === 1_000_000 ? 1 : startRank, endRank: total, total });
    }, resolvePage: resolve, reject,
  })));
  let identity = "me";
  const controller = createLeaderboardController(elements, { loadPage,
    localIdentity: () => identity, isDeveloper: () => false, paintProfileIcon: vi.fn(), drawPodiumCharacter: vi.fn(), openProfile: vi.fn(), beforeOpen: vi.fn() });
  return { elements, pending, loadPage, controller, identity: (value: string) => { identity = value; } };
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
  expect(f.loadPage).toHaveBeenCalledTimes(2);
  expect(f.elements.podium.hidden).toBe(false);
  expect(f.elements.podium.textContent).toContain("Power winner");
  const failed = f.controller.select("regen");
  f.pending[2].reject(new Error("Offline"));
  await failed;
  expect(f.elements.podium.hidden).toBe(false);
  expect(f.elements.podium.textContent).not.toContain("Power winner");
});

const page = (startRank: number, endRank: number, localRank = 500, total = 1000): LeaderboardPage<LeaderboardEntry> => ({
  startRank, endRank, localRank, total,
  entries: Array.from({ length: endRank - startRank + 1 }, (_, n) => entry(startRank + n, startRank + n === localRank ? "me" : `Player ${startRank + n}`)),
});
it("centers the local rank and preserves its visual position while inserting 100 above", async () => {
  const f = fixture(), opening = f.controller.open();
  f.pending[0].resolvePage({ ...page(450, 550), entries: [entry(1, "Top"), ...page(450, 550).entries] });
  await opening;
  const local = () => f.elements.rows.querySelector<HTMLElement>(".is-local")!;
  expect(local().getBoundingClientRect().top + 20).toBe(160);
  expect(f.elements.rows.textContent).not.toContain("Top");
  expect(f.elements.podium.textContent).toContain("Top");
  f.elements.rows.scrollTop = 60;
  const before = f.elements.rows.querySelector<HTMLElement>('[data-rank="451"]')!.getBoundingClientRect().top;
  const loading = f.controller.loadMore("above");
  expect(f.loadPage).toHaveBeenLastCalledWith("power", 350, 100);
  expect(f.elements.rows.querySelector('[data-direction="above"] .leaderboard-spinner')).not.toBeNull();
  await f.controller.loadMore("above");
  expect(f.loadPage).toHaveBeenCalledTimes(2);
  f.pending[1].resolvePage(page(350, 449)); await loading;
  expect(f.elements.rows.querySelector<HTMLElement>('[data-rank="451"]')!.getBoundingClientRect().top).toBe(before);
  expect(f.elements.rows.querySelectorAll(".leaderboard-row")).toHaveLength(201);
  expect(f.elements.rows.querySelector(".leaderboard-spinner")).toBeNull();
});
it("loads 100 below, keeps rows through an error, and stops at the last rank", async () => {
  const f = fixture(), opening = f.controller.open(); f.pending[0].resolvePage(page(450, 550)); await opening;
  const next = f.controller.loadMore("below");
  expect(f.loadPage).toHaveBeenLastCalledWith("power", 551, 100);
  f.pending[1].reject(new Error("Offline")); await next;
  expect(f.elements.rows.querySelectorAll(".leaderboard-row")).toHaveLength(101);
  expect(f.elements.rows.textContent).toContain("Retry");
  const retry = f.controller.loadMore("below"); f.pending[2].resolvePage(page(551, 560, 500, 560)); await retry;
  expect(f.elements.rows.querySelectorAll(".leaderboard-row")).toHaveLength(111);
  await f.controller.loadMore("below");
  expect(f.loadPage).toHaveBeenCalledTimes(3);
});
it("caps mounted rows while allowing discarded ranges to be loaded again", async () => {
  const f = fixture(), opening = f.controller.open(); f.pending[0].resolvePage(page(450, 550, 500, 100_000)); await opening;
  for (let i = 0; i < 5; i++) {
    const next = f.controller.loadMore("below");
    f.pending[i + 1].resolvePage(page(551 + i * 100, 650 + i * 100, 500, 100_000)); await next;
  }
  expect(f.elements.rows.querySelectorAll(".leaderboard-row")).toHaveLength(501);
  const back = f.controller.loadMore("above");
  expect(f.loadPage).toHaveBeenLastCalledWith("power", 450, 100);
  f.pending[6].resolvePage(page(450, 549, 500, 100_000)); await back;
  expect(f.elements.rows.querySelector(".is-local")).not.toBeNull();
});

it("reuses ranking data for a minute across closes and then refreshes", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
  try {
    const f = fixture();
    const opening = f.controller.open(); f.pending[0].resolvePage(page(450, 550)); await opening;
    f.controller.close();
    now.mockReturnValue(60_999);
    await f.controller.open();
    expect(f.loadPage).toHaveBeenCalledTimes(1);
    f.controller.close(); now.mockReturnValue(61_001);
    const refresh = f.controller.open();
    expect(f.loadPage).toHaveBeenCalledTimes(2);
    f.pending[1].resolvePage(page(460, 560)); await refresh;
    f.controller.close(); f.identity("someone else");
    const other = f.controller.open();
    expect(f.loadPage).toHaveBeenCalledTimes(3);
    f.pending[2].resolvePage(page(1, 50)); await other;
  } finally { now.mockRestore(); }
});
