/**
 * Chromium browsers on computers and Android draw the world as sprites; iPhones and iPads (every browser there is
 * WebKit), desktop Safari and Firefox keep the canvas. ?sprites=1 turns it on anywhere, ?sprites=0 off
 * (?renderer=canvas turns the whole WebGL layer off).
 */
export function worldSpritesWanted(search: string, browser: Pick<Navigator, "userAgent">) {
  const asked = new URLSearchParams(search).get("sprites");
  if (asked === "1") return true;
  if (asked === "0") return false;
  // An iPhone's Chrome says CriOS, and an iPad asking for the desktop site says Safari: neither matches.
  return /(Chrome|Chromium)\/\d/.test(browser.userAgent);
}
