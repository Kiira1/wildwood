import { playerNameTagsRevision } from "../app/player-name-tags";
import { renderLeaderboard, renderLeaderboardPodium, setLeaderboardTab, type LeaderboardStat, type RenderedLeaderboardPodiumPlayer } from "./leaderboard";
import type { LeaderboardEntry } from "../wildstat-coop";

export type LeaderboardControllerElements = {
  button: HTMLElement;
  overlay: HTMLElement;
  closeButton: HTMLElement;
  tabs: Record<LeaderboardStat, HTMLElement>;
  valueHeading: HTMLElement;
  podium: HTMLElement;
  rows: HTMLElement;
  loading: HTMLElement;
  empty: HTMLElement;
};

export type LeaderboardControllerHooks = {
  entries: () => LeaderboardEntry[];
  loadSnapshot: (stat: LeaderboardStat) => Promise<LeaderboardEntry[]>;
  localIdentity: () => string;
  isDeveloper: (identity: string) => boolean;
  paintProfileIcon: (canvas: HTMLCanvasElement, identity: string) => void;
  drawPodiumCharacter: (canvas: HTMLCanvasElement, entry: LeaderboardEntry, rank: 1 | 2 | 3) => void;
  openProfile: (identity: string, name: string) => void;
  beforeOpen: () => void;
};

export function createLeaderboardController(elements: LeaderboardControllerElements, hooks: LeaderboardControllerHooks) {
  let stat: LeaderboardStat = "power";
  let snapshot: LeaderboardEntry[] = [];
  let loading = false;
  let requestGeneration = 0;
  let snapshotIdentity = "";
  let error = "";
  const snapshots = new Map<LeaderboardStat, LeaderboardEntry[]>();
  let podiumPlayers: RenderedLeaderboardPodiumPlayer[] = [];

  let nameTagRevision = -1;
  function render() {
    nameTagRevision = playerNameTagsRevision();
    if (loading) {
      elements.rows.hidden = true;
      elements.empty.hidden = true;
      elements.loading.hidden = false;
      elements.podium.hidden = true;
      podiumPlayers = [];
      return;
    }
    elements.loading.hidden = true;
    elements.empty.textContent = error || "NO PLAYERS YET";
    const actions = {
      isDeveloper: hooks.isDeveloper,
      paintProfileIcon: hooks.paintProfileIcon,
      openProfile(identity: string, name: string) {
        close();
        hooks.openProfile(identity, name);
      },
    };
    podiumPlayers = renderLeaderboardPodium(elements.podium, stat, snapshot, actions);
    renderLeaderboard({ rows: elements.rows, empty: elements.empty }, stat, snapshot, hooks.localIdentity(), actions);
  }

  function drawPodium() {
    if (elements.overlay.hidden) return;
    if (snapshotIdentity !== hooks.localIdentity()) { close(); return; }
    if (nameTagRevision !== playerNameTagsRevision()) render();
    for (const player of podiumPlayers) hooks.drawPodiumCharacter(player.canvas, player.entry, player.rank);
  }

  async function select(requested: string) {
    stat = setLeaderboardTab({
      tabs: elements.tabs,
      rows: elements.rows,
      empty: elements.empty,
      valueHeading: elements.valueHeading,
    }, requested);
    elements.overlay.dataset.stat = stat;
    const requestedStat = stat;
    const generation = ++requestGeneration;
    error = "";
    snapshot = snapshots.get(stat) ?? [];
    loading = !snapshots.has(stat);
    render();
    if (!loading) return;
    try {
      const entries = await hooks.loadSnapshot(requestedStat);
      if (generation !== requestGeneration || elements.overlay.hidden || snapshotIdentity !== hooks.localIdentity()) return;
      snapshots.set(requestedStat, entries);
      snapshot = entries;
    } catch (failure) {
      if (generation !== requestGeneration || elements.overlay.hidden) return;
      snapshot = [];
      error = failure instanceof Error ? failure.message : "COULD NOT LOAD · SELECT A TAB TO RETRY";
    } finally {
      if (generation === requestGeneration && !elements.overlay.hidden) { loading = false; render(); }
    }
  }

  async function open() {
    hooks.beforeOpen();
    elements.overlay.hidden = false;
    elements.button.setAttribute("aria-expanded", "true");
    snapshot = [];
    snapshots.clear();
    snapshotIdentity = hooks.localIdentity();
    await select(stat);
  }

  function close() {
    requestGeneration++;
    elements.overlay.hidden = true;
    elements.button.setAttribute("aria-expanded", "false");
  }

  elements.button.addEventListener("click", () => {
    if (elements.overlay.hidden) void open();
    else close();
  });
  elements.closeButton.addEventListener("click", close);
  for (const [name, tab] of Object.entries(elements.tabs) as Array<[LeaderboardStat, HTMLElement]>) {
    tab.addEventListener("click", () => select(name));
  }

  return { close, drawPodium, open, render, select, isOpen: () => !elements.overlay.hidden };
}
