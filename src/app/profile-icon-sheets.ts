import { afterEntry } from "./after-entry";

/**
 * Portrait sheets are big (about half a megabyte each) and the world needs
 * none of them, so none loads before the player is in it. After that a sheet
 * loads only when a portrait on screen shows it, at low priority. Until then
 * a portrait shows its plain backdrop.
 */
const RETRY_MS = 10_000;
type SheetState = "held" | "loading" | "ready";
const sheets = new Map<string, SheetState>();
const waiters = new Map<string, Set<() => void>>();

export const profileSheetReady = (path: string) => sheets.get(path) === "ready";
/** Whether something has already asked for this sheet. */
export const profileSheetRequested = (path: string) => sheets.has(path);

/** The sheet is in the browser's cache (it loaded here or elsewhere): paint everything waiting for it. */
export function rememberLoadedProfileSheet(path: string) {
  sheets.set(path, "ready");
  const callbacks = waiters.get(path);
  waiters.delete(path);
  callbacks?.forEach(callback => callback());
}

/** Calls `onReady` once the sheet has loaded, loading it after entry if nothing has yet. */
export function requestProfileSheet(path: string, onReady: () => void) {
  if (profileSheetReady(path)) { onReady(); return; }
  let callbacks = waiters.get(path);
  if (!callbacks) waiters.set(path, callbacks = new Set());
  callbacks.add(onReady);
  if (sheets.has(path)) return;
  sheets.set(path, "held");
  afterEntry(() => load(path));
}

function load(path: string) {
  if (typeof Image === "undefined" || sheets.get(path) !== "held") return;
  sheets.set(path, "loading");
  const image = new Image();
  image.decoding = "async";
  (image as HTMLImageElement & { fetchPriority?: string }).fetchPriority = "low";
  image.onload = () => { image.onload = image.onerror = null; rememberLoadedProfileSheet(path); };
  image.onerror = () => {
    image.onload = image.onerror = null;
    sheets.set(path, "held");
    setTimeout(() => { if (waiters.has(path)) load(path); else sheets.delete(path); }, RETRY_MS);
  };
  image.src = path;
}
