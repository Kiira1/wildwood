/**
 * Work the loading screen must not wait for. It is held until the player is
 * in the world, then runs when the page is idle (or after a short wait), so
 * it never competes with what the first frames need.
 */
type Task = () => void;
type IdleWindow = { requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number };

const IDLE_TIMEOUT_MS = 2_000;
const FALLBACK_DELAY_MS = 250;

let entered = false;
const held: Task[] = [];

function run(task: Task) {
  try { task(); } catch (error) { console.warn("WildStat deferred load failed:", error); }
}

/** Runs `task` when the page is idle, or after the timeout at the latest. */
export function whenIdle(task: Task, timeout = IDLE_TIMEOUT_MS) {
  const idle = (globalThis as IdleWindow).requestIdleCallback;
  if (typeof idle === "function") idle(() => run(task), { timeout });
  else setTimeout(() => run(task), FALLBACK_DELAY_MS);
}

/** Queues `task` until the player has entered the world, then runs it at idle. */
export function afterEntry(task: Task) {
  if (entered) whenIdle(task);
  else held.push(task);
}

/** The player is in the world: release everything that was held back. */
export function markEntered() {
  if (entered) return;
  entered = true;
  for (const task of held.splice(0)) whenIdle(task);
}

export const hasEntered = () => entered;
