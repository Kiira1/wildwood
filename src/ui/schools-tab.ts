import { MASTERY_MAX_LEVEL, WEAPON_SCHOOLS, WEAPON_SCHOOL_NAMES, masteryProgress, weaponSchool, type WeaponSchool } from "../../shared/weapon-mastery";
import { formatCompactNumber } from "./number-format";

// Exact below 10,000 like card counts, compact above.
const amount = (value: number) => value < 10_000 ? Math.floor(value).toLocaleString("en-US") : formatCompactNumber(value);

/**
 * The Schools tab: Weapon Mastery, a level per school with its bar toward the next one, and which school
 * the weapon in hand trains.
 */
export function createSchoolsTab(options: {
  points: () => Readonly<Partial<Record<WeaponSchool, bigint>>>;
  activeWeapon: () => string | undefined;
}) {
  const element = document.createElement("section");
  element.className = "schools-tab";
  element.hidden = true;
  const note = document.createElement("p");
  note.className = "schools-tab-note";
  note.textContent = "Every kill trains the school of the weapon in your hand. Prestige keeps Mastery.";
  const list = document.createElement("div");
  list.className = "schools-tab-list";
  const coming = document.createElement("p");
  coming.className = "schools-tab-note";
  coming.textContent = "Higher levels will unlock weapon, helmet and armor grades and school techniques.";
  element.append(note, list, coming);
  let renderedKey = "";

  function render() {
    const points = options.points();
    const inHand = weaponSchool(options.activeWeapon());
    const rows = WEAPON_SCHOOLS.map(school => ({ school, ...masteryProgress(points[school] ?? 0n) }));
    const key = JSON.stringify([rows, inHand]);
    if (key === renderedKey) return;
    renderedKey = key;
    list.textContent = "";
    for (const { school, level, into, needed } of rows) {
      const max = level >= MASTERY_MAX_LEVEL;
      const card = document.createElement("div");
      card.className = "schools-tab-card";
      card.classList.toggle("is-in-hand", school === inHand);
      card.dataset.school = school;
      const head = document.createElement("div");
      head.className = "schools-tab-head";
      const name = document.createElement("strong");
      name.textContent = WEAPON_SCHOOL_NAMES[school];
      head.append(name);
      if (school === inHand) {
        const marker = document.createElement("span");
        marker.className = "schools-tab-in-hand";
        marker.textContent = "In Hand";
        head.append(marker);
      }
      const levelText = document.createElement("span");
      levelText.className = "schools-tab-level";
      levelText.textContent = max ? `Lv ${level} · Max` : `Lv ${level}`;
      head.append(levelText);
      const bar = document.createElement("div");
      bar.className = "schools-tab-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", `${WEAPON_SCHOOL_NAMES[school]} progress`);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", String(max ? 1 : needed));
      bar.setAttribute("aria-valuenow", String(max ? 1 : into));
      const fill = document.createElement("span");
      const ratio = max ? 1 : needed > 0 ? Math.max(0, Math.min(1, into / needed)) : 0;
      fill.style.width = `${Math.round(ratio * 1000) / 10}%`;
      bar.append(fill);
      const numbers = document.createElement("span");
      numbers.className = "schools-tab-points";
      numbers.textContent = max ? "Max Level" : `${amount(into)} / ${amount(needed)}`;
      card.append(head, bar, numbers);
      list.append(card);
    }
  }

  return {
    element,
    render,
    show(visible: boolean) { element.hidden = !visible; if (visible) render(); },
  };
}
