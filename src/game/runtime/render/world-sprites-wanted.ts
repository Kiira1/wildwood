/**
 * Chromium browsers (computers and Android) and every iPhone and iPad browser draw the world as sprites; desktop
 * Safari and Firefox keep the canvas. ?sprites=1 turns it on anywhere, ?sprites=0 off (?renderer=canvas turns the
 * whole WebGL layer off).
 */
export function worldSpritesWanted(search: string, browser: Pick<Navigator, "userAgent" | "maxTouchPoints"> & { platform?: string }) {
  const asked = new URLSearchParams(search).get("sprites");
  if (asked === "1") return true;
  if (asked === "0") return false;
  const agent = browser.userAgent;
  const apple = /iPad|iPhone|iPod/.test(agent) || (browser.platform === "MacIntel" && browser.maxTouchPoints > 1);
  return apple || /(Chrome|Chromium)\/\d/.test(agent);
}
