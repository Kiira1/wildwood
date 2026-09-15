import source from "../../public/assets/wildstat/tutorial-copy.json?raw";
export const DEFAULT_TUTORIAL_COPY: Readonly<Record<string, string>> = JSON.parse(source);
export function tutorialText(copy: Readonly<Record<string, string>>, key: string, values: Record<string, number> = {}) {
  return (copy[key] ?? DEFAULT_TUTORIAL_COPY[key] ?? "").replace(/\{(before|after)\}/g, (match, name) =>
    values[name] === undefined ? match : String(values[name]));
}
/** Read the editable asset, with bundled text available immediately and offline. */
export async function loadTutorialCopy() {
  try {
    const response = await fetch(new URL("assets/wildstat/tutorial-copy.json", document.baseURI), { cache: "no-cache" });
    if (!response.ok) return DEFAULT_TUTORIAL_COPY;
    const saved = await response.json();
    return Object.fromEntries(Object.entries(DEFAULT_TUTORIAL_COPY).map(([key, fallback]) =>
      [key, typeof saved?.[key] === "string" && saved[key].trim() && saved[key].length <= 240 ? saved[key] : fallback]));
  } catch { return DEFAULT_TUTORIAL_COPY; }
}
