import {
  MASTERY_MAX_LEVEL, SCHOOL_DETAILS, WEAPON_SCHOOL_NAMES, masteryProgress, schoolPassiveValue, skillProficiency, type WeaponSchool,
} from "../../shared/weapon-mastery";
import { formatCompactNumber } from "./number-format";
import type { CraftSkill } from "../../shared/crafting";
import { craftDepsFor, createCraftSection, type CraftCoop, type CraftInventory, type CraftSectionDeps } from "./craft-section";

type Points = Readonly<Partial<Record<WeaponSchool, bigint>>>;

// Exact below 10,000 like card counts, compact above.
const amount = (value: number) => value < 10_000 ? Math.floor(value).toLocaleString("en-US") : formatCompactNumber(value);

const TRAINED_BY: Readonly<Record<WeaponSchool, string>> = { archery: "a bow", swordplay: "a sword", sorcery: "a staff" };
/** The craft done in each school's building; swords are the Smith's. */
const SCHOOL_CRAFT: Readonly<Record<WeaponSchool, CraftSkill | null>> = { archery: "fletching", swordplay: null, sorcery: "enchanting" };

/** A school's passive as it stands now: range for Archery, a share for the others. */
export function schoolPassiveNow(school: WeaponSchool, level: number) {
  const value = schoolPassiveValue(school, level);
  if (school === "archery") return `+${value.toFixed(1)} now`;
  const percent = (value * 100).toFixed(1);
  return school === "swordplay" ? `${percent}% less now` : `+${percent}% now`;
}

/**
 * A Weapon Mastery school's window, in its Town building: the school's level and progress, what fighting trains
 * it, its passive and Skill Proficiency as they stand, and its five techniques, learned or still locked.
 */
export function createSchoolWindowController(deps: {
  inTown: () => boolean;
  clearInput?: () => void;
  points: () => Points;
  /** Fletching at the Archery Range and Enchanting at the Mage Tower (craft-section.ts). */
  craft?: CraftSectionDeps;
}) {
  const dialog = document.createElement("dialog");
  dialog.className = "farm-sheet quest-sheet smith-sheet school-window";
  dialog.setAttribute("aria-labelledby", "schoolWindowTitle");
  dialog.innerHTML = `<header class="farm-header"><h2 id="schoolWindowTitle" class="window-banner"><span></span></h2></header>`
    + `<div class="quest-body"><p class="farm-map smith-intro school-window-train"></p>`
    + `<section class="school-window-card"><div class="school-window-head"><strong></strong><span class="school-window-level"></span></div>`
    + `<div class="school-window-bar" role="progressbar" aria-valuemin="0"><span></span></div><span class="school-window-points"></span></section>`
    + `<dl class="school-window-passives"><div class="school-window-passive"><dt></dt><dd><span class="school-window-per-level"></span><strong class="school-window-now"></strong></dd></div>`
    + `<div class="school-window-proficiency"><dt>Skill Proficiency</dt><dd></dd></div></dl>`
    + `<h3 class="school-window-subhead">Techniques</h3><ul class="school-window-techniques" aria-label="Techniques"></ul></div>`
    + `<footer class="farm-footer"><div class="farm-actions"><button type="button" class="window-back-button">Back</button></div></footer>`;
  document.body.append(dialog);
  const q = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const title = q(".window-banner span"), train = q(".school-window-train");
  const name = q(".school-window-head strong"), levelText = q(".school-window-level");
  const bar = q(".school-window-bar"), fill = q(".school-window-bar span"), numbers = q(".school-window-points");
  const passiveName = q(".school-window-passive dt"), perLevel = q(".school-window-per-level"), now = q(".school-window-now");
  const proficiency = q(".school-window-proficiency dd"), techniques = q(".school-window-techniques");
  const back = q<HTMLButtonElement>(".window-back-button");
  const crafts = deps.craft ? createCraftSection(deps.craft) : null;
  if (crafts) q(".school-window-passives").after(crafts.element);
  let school: WeaponSchool = "archery";
  let renderedKey = "";
  let ticker: ReturnType<typeof setInterval> | null = null;

  function render() {
    crafts?.render(SCHOOL_CRAFT[school]);
    const points = deps.points()[school] ?? 0n;
    const key = `${school}:${points}`;
    if (key === renderedKey) return;
    renderedKey = key;
    const details = SCHOOL_DETAILS[school], schoolName = WEAPON_SCHOOL_NAMES[school];
    const { level, into, needed } = masteryProgress(points), max = level >= MASTERY_MAX_LEVEL;
    title.textContent = details.building;
    train.textContent = `Every kill with ${TRAINED_BY[school]} trains ${schoolName}. Prestige keeps Mastery.`;
    name.textContent = schoolName;
    levelText.textContent = max ? `Lv ${level} · Max` : `Lv ${level}`;
    bar.setAttribute("aria-label", `${schoolName} progress`);
    bar.setAttribute("aria-valuemax", String(max ? 1 : needed));
    bar.setAttribute("aria-valuenow", String(max ? 1 : into));
    const ratio = max ? 1 : needed > 0 ? Math.max(0, Math.min(1, into / needed)) : 0;
    fill.style.width = `${Math.round(ratio * 1000) / 10}%`;
    numbers.textContent = max ? "Max Level" : `${amount(into)} / ${amount(needed)}`;
    passiveName.textContent = details.passive;
    perLevel.textContent = details.passivePerLevel;
    now.textContent = schoolPassiveNow(school, level);
    proficiency.textContent = `Weapon skills fire ${Math.round(skillProficiency(level) * 100)}% more often`;
    techniques.replaceChildren(...details.techniques.map(technique => {
      const learned = level >= technique.level;
      const row = document.createElement("li");
      row.className = `school-window-technique ${learned ? "is-learned" : "is-locked"}`;
      row.dataset.technique = technique.id;
      const head = document.createElement("div");
      head.className = "school-window-technique-head";
      const techniqueName = document.createElement("strong");
      techniqueName.textContent = technique.name;
      const at = document.createElement("span");
      at.className = "school-window-technique-level";
      at.textContent = `Lv ${technique.level}`;
      head.append(techniqueName, at);
      const text = document.createElement("p");
      text.textContent = technique.text;
      const status = document.createElement("span");
      status.className = "school-window-technique-status";
      status.textContent = learned ? "Learned" : `Unlocks at Lv ${technique.level}`;
      row.append(head, text, status);
      return row;
    }));
  }

  function close() {
    if (!dialog.open) return false;
    dialog.close();
    if (ticker) { clearInterval(ticker); ticker = null; }
    deps.clearInput?.();
    return true;
  }

  function open(which: WeaponSchool) {
    if (!deps.inTown()) return;
    if (!dialog.open) crafts?.reset();
    school = which;
    render();
    if (dialog.open) return;
    deps.clearInput?.();
    dialog.showModal();
    // Mastery can arrive after the window opens, on a fresh sign-in in the Town.
    ticker = setInterval(() => { if (dialog.open) render(); }, 1000);
    back.focus();
  }

  back.addEventListener("click", close);
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  return { open, close, isOpen: () => dialog.open, school: () => school, render, destroy() { close(); dialog.remove(); } };
}

/** The schools' window as main.ts uses it: Mastery points from the coop session, and crafting once handed the bag. */
export function createSchoolWindowRuntime(deps: {
  coop: () => (CraftCoop & { weaponMastery?: () => Readonly<Record<WeaponSchool, bigint>> }) | null | undefined;
  clearInput?: () => void;
  inTown: () => boolean;
  inventory?: CraftInventory;
  showMessage?: (text: string, color: string) => void;
}) {
  const craft = deps.inventory && deps.showMessage ? craftDepsFor(deps.coop, deps.inventory, deps.showMessage) : undefined;
  return createSchoolWindowController({ inTown: deps.inTown, clearInput: deps.clearInput, points: () => deps.coop()?.weaponMastery?.() ?? {}, craft });
}
