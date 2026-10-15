import { LEADERBOARD_AGE_FILTERS, type LeaderboardBoard } from "../../shared/leaderboard-window";

/**
 * The control under the list. It always says where the viewer stands. On Time
 * Played it is also a dropdown of account ages (Any, Joined Last 30 Days, Joined
 * Last 7 Days), so new players can see how they compare with others as new as
 * them. The dropdown keeps the look of the prestige switcher it replaced.
 */
export type LeaderboardAgeFilterElements = { chips: HTMLElement; heading: HTMLElement };

const boundMenus = new WeakSet<HTMLElement>();

function setMenuOpen(elements: LeaderboardAgeFilterElements, open: boolean) {
  elements.chips.hidden = !open;
  elements.heading.setAttribute("aria-expanded", String(open));
}

function bindMenu(elements: LeaderboardAgeFilterElements) {
  if (boundMenus.has(elements.heading)) return;
  boundMenus.add(elements.heading);
  const doc = elements.heading.ownerDocument;
  elements.heading.addEventListener("click", () => {
    if (elements.heading.dataset.filter === "on") setMenuOpen(elements, elements.chips.hidden);
  });
  doc.addEventListener("pointerdown", event => {
    const target = event.target as Node | null;
    if (!elements.chips.hidden && target && !elements.chips.contains(target) && !elements.heading.contains(target)) setMenuOpen(elements, false);
  });
  doc.addEventListener("keydown", event => {
    if (event.key === "Escape" && !elements.chips.hidden) { event.stopPropagation(); setMenuOpen(elements, false); }
  }, true);
}

/** Draws the control: the age dropdown on Time Played, the viewer's rank on every board. */
export function renderLeaderboardAgeFilter(
  elements: LeaderboardAgeFilterElements,
  state: { filterable: boolean; board: LeaderboardBoard; localRank: number; loading: boolean },
  onPick: (board: LeaderboardBoard) => void,
) {
  bindMenu(elements);
  const doc = elements.chips.ownerDocument;
  const selected = LEADERBOARD_AGE_FILTERS.find(filter => filter.board === state.board) ?? LEADERBOARD_AGE_FILTERS[0];
  elements.heading.dataset.filter = state.filterable ? "on" : "off";
  if (!state.filterable) setMenuOpen(elements, false);
  elements.chips.replaceChildren(...LEADERBOARD_AGE_FILTERS.map(filter => {
    const chip = doc.createElement("button");
    chip.type = "button";
    chip.className = "leaderboard-prestige-chip";
    chip.dataset.board = filter.board;
    chip.setAttribute("role", "option");
    const active = filter.board === selected.board;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-selected", String(active));
    const label = doc.createElement("span");
    label.className = "leaderboard-prestige-chip-label";
    label.textContent = filter.label;
    chip.append(label);
    chip.addEventListener("click", () => {
      setMenuOpen(elements, false);
      if (!active) onPick(filter.board);
    });
    return chip;
  }));

  const title = doc.createElement("span");
  title.className = "leaderboard-prestige-title";
  title.textContent = state.filterable ? selected.label : "All Players";
  const note = doc.createElement("span");
  note.className = "leaderboard-prestige-rank";
  note.textContent = state.loading ? "" : state.localRank > 0 ? `You're #${state.localRank}` : "Not Ranked Yet";
  note.hidden = !note.textContent;
  elements.heading.replaceChildren(title, note);
  elements.heading.toggleAttribute("aria-disabled", !state.filterable);
  elements.heading.setAttribute("aria-label", state.filterable ? `${selected.label}. Change account age` : `All players. ${note.textContent}`);
}
