/** "★7": an item's refine, a gold star after its name, where the slot tier keeps its green +N (Ryan's pick). */
export const refineStars = (level: number) => (level > 0 ? `★${level}` : "");

/** An item's name with its refine after it: "Ion Bow ★7", or the name alone at ★0. */
export const withRefineStars = (name: string, level: number) => (level > 0 ? `${name} ${refineStars(level)}` : name);

/** The gold ★N on an item's tile. Nothing at ★0, so plain gear looks as it always has. */
export function appendRefineBadge(element: HTMLElement, level: number) {
  if (!(level > 0)) return;
  const badge = document.createElement("span");
  badge.className = "refine-badge";
  badge.textContent = refineStars(level);
  element.append(badge);
}
