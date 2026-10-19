import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createToolSection, mountToolSection, toolButtonText, toolDepsFor, type ToolSectionDeps } from "./tool-section";
import { toolUpgradeCost, type ToolId, type ToolSkill } from "../../shared/tools";
import type { OreId } from "../../shared/refine";
afterEach(() => vi.unstubAllGlobals());

function section(options: { levels?: Partial<Record<ToolId, number>>; skills?: Partial<Record<ToolSkill, number>>; ores?: Partial<Record<OreId, number>>;
  gold?: bigint; claimed?: boolean; upgrade?: ToolSectionDeps["upgrade"] } = {}) {
  const { document } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  const levels = { ...options.levels };
  const showMessage = vi.fn();
  const upgrade = vi.fn(options.upgrade ?? (async (tool: ToolId, expected: number) => { levels[tool] = expected + 1; return { ok: true }; }));
  const deps: ToolSectionDeps = {
    toolLevels: () => levels,
    skills: () => ({ mining: 0, woodcutting: 0, smithing: 1, fletching: 1, enchanting: 1, ...options.skills }),
    owned: tool => options.claimed !== false || (tool !== "pickaxe" && tool !== "hatchet"),
    ores: () => options.ores ?? {},
    gold: () => options.gold ?? 0n,
    upgrade, showMessage,
  };
  const tools = createToolSection(deps);
  document.body.append(tools.element);
  tools.render();
  const row = (tool: ToolId) => tools.element.querySelector<HTMLElement>(`[data-tool="${tool}"]`);
  const button = (tool: ToolId) => row(tool)?.querySelector<HTMLButtonElement>("button") ?? null;
  return { tools, row, button, upgrade, showMessage, levels };
}

it("lists every tool held, Title Case, with its level, what it does now and next, and what it needs", () => {
  const view = section({ skills: { mining: 10 } });
  expect(view.tools.element.querySelector("h3")?.textContent).toBe("Tools");
  expect([...view.tools.element.querySelectorAll<HTMLElement>(".tool-row")].map(row => row.dataset.tool)).toEqual(["pickaxe", "hatchet", "hammer", "knife", "focus"]);
  const pickaxe = view.row("pickaxe")!;
  expect(pickaxe.querySelector("strong")?.textContent).toBe("Worn Pickaxe");
  expect(pickaxe.querySelector(".smith-shop-grade")?.textContent).toBe("Lv 0 / 10 · Mining Tool");
  expect(pickaxe.querySelector(".smith-shop-stat")?.textContent).toBe("No Bonus");
  expect(pickaxe.querySelector(".craft-needs")?.textContent).toBe("Next: +10% Speed · 2.5% Extra Ore · Lv 10 Mining");
  expect(pickaxe.querySelector(".craft-needs .is-met:last-child")).toBeTruthy();
  expect(view.row("hatchet")!.querySelector(".craft-needs .is-unmet")?.textContent).toBe("Lv 10 Woodcutting");
  expect(pickaxe.querySelector(".craft-material")?.textContent).toBe("0 / 15 Copper Ore");
  expect(pickaxe.querySelector(".craft-material.is-short")).toBeTruthy();
  expect(pickaxe.querySelector(".smith-shop-price")?.getAttribute("aria-label")).toBe("10 Gold, 0 held");
  // The price alone, muted while the gold is short.
  expect([pickaxe.querySelector(".smith-shop-price")?.textContent, Boolean(pickaxe.querySelector(".smith-shop-price.is-short"))]).toEqual(["10", true]);
});

it("leaves out the Pickaxe and Hatchet until the Smith has handed them over", () => {
  const view = section({ claimed: false });
  expect(view.row("pickaxe")).toBeNull();
  expect(view.row("hatchet")).toBeNull();
  expect(view.row("hammer")).toBeTruthy();
});

it("says why an upgrade waits: the skill, then materials, then gold", () => {
  const cost = toolUpgradeCost("pickaxe", 1)!;
  expect(toolButtonText("pickaxe", 0, 9, { copper_ore: 99 }, 99n)).toBe("Need Lv 10 Mining");
  expect(toolButtonText("pickaxe", 0, 10, { copper_ore: cost.materials.copper_ore - 1 }, 99n)).toBe("Need Materials");
  expect(toolButtonText("pickaxe", 0, 10, { copper_ore: cost.materials.copper_ore }, BigInt(cost.gold - 1))).toBe("Need Gold");
  expect(toolButtonText("pickaxe", 0, 10, { copper_ore: cost.materials.copper_ore }, BigInt(cost.gold))).toBe("Upgrade");
  expect(toolButtonText("hatchet", 10, 0, {}, 0n)).toBe("Max");
  const view = section({ skills: { mining: 9 } });
  expect(view.button("pickaxe")?.textContent).toBe("Need Lv 10 Mining");
  expect(view.button("pickaxe")?.disabled).toBe(true);
});

it("upgrades at the level shown, then shows the next level", async () => {
  const view = section({ skills: { smithing: 3 }, ores: { copper_ore: 100 }, gold: 100n });
  expect(view.button("hammer")?.textContent).toBe("Upgrade");
  view.button("hammer")!.click();
  expect(view.upgrade).toHaveBeenCalledWith("hammer", 0);
  await vi.waitFor(() => expect(view.row("hammer")?.querySelector("strong")?.textContent).toBe("Bronze Hammer"));
  expect(view.showMessage).toHaveBeenCalledWith("Upgraded · Bronze Hammer. Saves 2.5% Materials · +3% Experience.", "#ffd75e");
  expect(view.row("hammer")?.querySelector(".smith-shop-stat")?.textContent).toBe("Saves 2.5% Materials · +3% Experience");
});

it("shows a refusal and keeps the level", async () => {
  const view = section({ skills: { smithing: 3 }, ores: { copper_ore: 100 }, gold: 100n, upgrade: async () => ({ ok: false, error: "Talk to the Smith first." }) });
  view.button("hammer")!.click();
  await vi.waitFor(() => expect(view.showMessage).toHaveBeenCalledWith("Talk to the Smith first.", "#ff9b91"));
  expect(view.row("hammer")?.querySelector("strong")?.textContent).toBe("Worn Hammer");
});

it("says Fully Upgraded with no price at the top level", () => {
  const view = section({ levels: { focus: 10 } });
  const focus = view.row("focus")!;
  expect(focus.querySelector("strong")?.textContent).toBe("Starshard Focus");
  expect(focus.querySelector(".smith-shop-owned")?.textContent).toBe("Fully Upgraded");
  expect(focus.querySelector("button")).toBeNull();
});

it("reads the coop session, and mounts at the foot of the Smith's window", () => {
  const { document } = parseHTML("<html><body><dialog><div class=\"quest-body\"><p>Gear</p></div></dialog></body></html>");
  vi.stubGlobal("document", document);
  const deps = toolDepsFor(() => ({ toolLevels: () => ({ hatchet: 2 }), hasPickaxe: () => false, hasHatchet: () => true, mining: () => 7, woodcutting: () => 60,
    craftSkills: () => ({ smithing: 0n, fletching: 0n, enchanting: 0n }) }), vi.fn());
  expect([deps.owned("pickaxe"), deps.owned("hatchet"), deps.owned("knife")]).toEqual([false, true, true]);
  expect(deps.skills()).toEqual({ mining: 7, woodcutting: 60, smithing: 1, fletching: 1, enchanting: 1 });
  const dialog = document.querySelector("dialog") as unknown as HTMLElement;
  const tools = mountToolSection(dialog, deps, vi.fn())!;
  tools.render();
  expect(dialog.querySelector(".quest-body")?.lastElementChild).toBe(tools.element);
  expect(tools.element.querySelector("[data-tool=\"hatchet\"] strong")?.textContent).toBe("Iron Hatchet");
  expect(mountToolSection(dialog, undefined, vi.fn())).toBeNull();
});
