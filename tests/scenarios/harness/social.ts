import { vi } from "vitest";
import type { GameTab } from "./game";
import type { ScenarioPlayer, ScenarioWorld } from "./server";

/**
 * Small player actions for the social scenarios: tapping a button that has no
 * id by what it says, typing, and answering the game's own yes/no prompt.
 */

/** The button in `root` whose words are `label` (the n-th when several share it). */
export function buttonIn(root: ParentNode, label: string, index = 0) {
  const found = [...root.querySelectorAll("button")].filter(node => node.textContent?.trim() === label)[index] as HTMLButtonElement | undefined;
  if (!found) throw new Error(`No "${label}" button`);
  return found;
}

/** A finger tap on a node, as tab.tap does for an id. */
export function tapNode(tab: GameTab, node: Element) {
  if ((node as HTMLButtonElement).disabled) throw new Error("That button is disabled");
  for (const type of ["pointerdown", "pointerup", "click"]) node.dispatchEvent(new (tab.window as any).Event(type, { bubbles: true }));
}

/** Types into a field the way the keyboard does: the value changes, then input fires. */
export function typeInto(tab: GameTab, field: Element, value: string) {
  if (field.tagName.toUpperCase() === "SELECT") {
    for (const option of field.querySelectorAll("option")) {
      if (option.value === value) option.setAttribute("selected", ""); else option.removeAttribute("selected");
    }
  } else (field as HTMLInputElement).value = value;
  field.dispatchEvent(new (tab.window as any).Event("input", { bubbles: true }));
  field.dispatchEvent(new (tab.window as any).Event("change", { bubbles: true }));
}

/** Submits a form as Enter or its submit button would. */
export function submit(tab: GameTab, form: Element) {
  form.dispatchEvent(new (tab.window as any).Event("submit", { bubbles: true, cancelable: true }));
}

/** The game's confirm prompt is open. */
export const confirmShown = (tab: GameTab) => tab.shown("gameConfirm");

/** Answers the open confirm prompt. */
export function answerConfirm(tab: GameTab, yes: boolean) {
  const prompt = tab.element("gameConfirm");
  const buttons = prompt.querySelectorAll("button");
  tapNode(tab, buttons[yes ? 1 : 0]);
}

/** A guild led by `leader` with `members` in it, made the way players make one (the founder briefly strong enough). */
export function guildOf(world: ScenarioWorld, name: string, leader: ScenarioPlayer, members: ScenarioPlayer[] = []) {
  const progress = world.db.playerProgress.identity.find(leader.identity);
  leader.patch("playerProgress", { maxHp: 1_000_000_000 });
  try { leader.call("createGuild", { name }); } finally { leader.patch("playerProgress", { maxHp: progress.maxHp }); }
  const guild = world.db.guildMember.identity.find(leader.identity).guildId as bigint;
  for (const member of members) member.call("joinGuild", { guildId: guild });
  return guild;
}

/** The form APIs the chat and its dialogs use that linkedom lacks: InputEvent, setSelectionRange and a settable <select> (<dialog> comes with every booted page). */
export function withTextInput(tab: GameTab) {
  const window = tab.window as any;
  if (typeof (globalThis as any).InputEvent === "undefined") vi.stubGlobal("InputEvent", window.InputEvent ?? class InputEvent extends window.Event {});
  window.HTMLTextAreaElement.prototype.setSelectionRange ??= function setSelectionRange() {};
  // linkedom's <select> reads its value but cannot be given one.
  const select = window.HTMLSelectElement.prototype;
  const value = Object.getOwnPropertyDescriptor(select, "value");
  if (value?.get && !value.set) Object.defineProperty(select, "value", { configurable: true, get: value.get, set(this: HTMLSelectElement, next: string) {
    for (const option of this.querySelectorAll("option")) {
      if (option.value === String(next)) option.setAttribute("selected", ""); else option.removeAttribute("selected");
    }
  } });
  return tab;
}
