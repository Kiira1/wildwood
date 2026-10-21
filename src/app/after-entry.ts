/**
 * Work the loading screen must not wait for. It is held until the player is
 * in the world, then runs when the page is idle (or after a short wait), so
 * it never competes with what the first frames need.
 */
type Task = () => void;
type IdleWindow = { requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number };

const IDLE_TIMEOUT_MS = 2_000;
const FALLBACK_DELAY_MS = 250;

// The game and the co-op client are separate bundles, each with its own copy of
// this module: the signal lives on the page so both copies see the one entry.
const ENTERED_EVENT = "wildstat:entered";
type SharedPage = { __wildstatEntered?: boolean } & Partial<Pick<EventTarget, "addEventListener" | "dispatchEvent">>;
const page = globalThis as SharedPage;
const held: Task[] = [];
let listening = false;

function run(task: Task) {
  try { task(); } catch (error) { console.warn("WildStat deferred load failed:", error); }
}

/** Runs `task` when the page is idle, or after the timeout at the latest. */
export function whenIdle(task: Task, timeout = IDLE_TIMEOUT_MS) {
  const idle = (globalThis as IdleWindow).requestIdleCallback;
  if (typeof idle === "function") idle(() => run(task), { timeout });
  else setTimeout(() => run(task), FALLBACK_DELAY_MS);
}

export const hasEntered = () => page.__wildstatEntered === true;

function release() {
  for (const task of held.splice(0)) whenIdle(task);
}

/** Queues `task` until the player has entered the world, then runs it at idle. */
export function afterEntry(task: Task) {
  if (hasEntered()) { whenIdle(task); return; }
  held.push(task);
  if (listening) return;
  listening = true;
  page.addEventListener?.(ENTERED_EVENT, () => { listening = false; release(); }, { once: true });
}

/** The player is in the world: release everything held back, in this bundle and the other. */
export function markEntered() {
  if (hasEntered()) return;
  page.__wildstatEntered = true;
  release();
  page.dispatchEvent?.(new Event(ENTERED_EVENT));
}
