import { GUILD_CREATION_MIN_POWER } from "../../../shared/guilds";
import type { GameTab } from "./game";
import type { ScenarioPlayer, ScenarioWorld } from "./server";

/** Saved stats strong enough to found a guild (power is read from the save). */
export function strongEnoughToFound(player: ScenarioPlayer) {
  player.patch("playerProgress", { maxHp: GUILD_CREATION_MIN_POWER * 2 });
}

/** A guild founded by `founder` (made strong enough first), with `members` joined. Returns its id. */
export function foundGuild(world: ScenarioWorld, founder: ScenarioPlayer, name: string, members: ScenarioPlayer[] = []) {
  const saved = founder.progress();
  strongEnoughToFound(founder);
  founder.call("createGuild", { name });
  founder.patch("playerProgress", { maxHp: saved.maxHp });
  const guildId = world.db.guildMember.identity.find(founder.identity).guildId as bigint;
  for (const member of members) member.call("joinGuild", { guildId });
  return guildId;
}

/** The player's guild hub as the window loads it. */
export function guildHub(player: ScenarioPlayer) {
  return JSON.parse(player.procedure("getGuildHub", { afterId: 0n }) as string);
}

/** The Guild window of a booted game, driven by its controls' keys (a member's id, a badge, a tab). */
export function guildWindow(tab: GameTab) {
  const overlay = () => tab.element("guildOverlay");
  const control = (key: string) => [...overlay().querySelectorAll<HTMLButtonElement>("button[data-focus-key]")].find(node => node.dataset.focusKey === key) ?? null;
  const click = (target: HTMLElement) => target.dispatchEvent(new (tab.window as any).Event("click", { bubbles: true }));
  const self = {
    open: async () => { if (!tab.shown("guildOverlay")) tab.tap("guildBtn"); await tab.play(500); },
    shown: () => tab.shown("guildOverlay"),
    /** Whether a control is on screen and can be pressed. */
    has: (key: string) => { const found = control(key); return Boolean(found && !found.disabled); },
    async press(key: string) {
      const found = control(key);
      if (!found) throw new Error(`No ${key} in the Guild window: ${[...overlay().querySelectorAll<HTMLButtonElement>("button[data-focus-key]")].map(node => node.dataset.focusKey).join(", ")}`);
      if (found.disabled) throw new Error(`${key} is disabled`);
      click(found);
      await tab.play(500);
    },
    /** The confirmation's own button (not Cancel). */
    async confirm(playMs = 500) {
      const buttons = [...overlay().querySelectorAll<HTMLButtonElement>(".guild-confirm button")];
      if (!buttons.length) throw new Error("Nothing to confirm");
      click(buttons[buttons.length - 1]);
      await tab.play(playMs);
    },
    /** Types into a field (by its key) and sends its form. */
    async submit(key: string, value: string) {
      const input = [...overlay().querySelectorAll<HTMLInputElement>("input[data-focus-key]")].find(node => node.dataset.focusKey === key);
      if (!input) throw new Error(`No ${key} field in the Guild window`);
      input.value = value;
      input.dispatchEvent(new (tab.window as any).Event("input", { bubbles: true }));
      (input.closest("form") as HTMLFormElement).dispatchEvent(new (tab.window as any).Event("submit", { bubbles: true, cancelable: true }));
      await tab.play(500);
    },
    /** Whether a confirmation is asking. */
    asking: () => overlay().querySelectorAll(".guild-confirm button").length > 0,
    /** The window's own Back. */
    async back() {
      const back = [...overlay().querySelectorAll<HTMLButtonElement>(".window-back-button")].at(-1);
      if (!back) throw new Error("No Back in the Guild window");
      click(back);
      await tab.play(300);
    },
    /** Types a name in the create form and submits it. */
    async create(name: string) {
      if (!tab.shown("guildName")) await self.press("Create a guild");
      const input = tab.element("guildName") as HTMLInputElement;
      input.value = name;
      input.dispatchEvent(new (tab.window as any).Event("input", { bubbles: true }));
      (input.closest("form") as HTMLFormElement).dispatchEvent(new (tab.window as any).Event("submit", { bubbles: true, cancelable: true }));
      await tab.play(500);
    },
  };
  return self;
}

/** The chat panel of a booted game, its buttons found by what they say, as a player finds them. */
export function chatPanel(tab: GameTab) {
  const panel = () => tab.element("chatPanel");
  const button = (label: string) => [...panel().querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === label) ?? null;
  return {
    button,
    async press(label: string) {
      const found = button(label);
      if (!found || found.disabled) throw new Error(`No ${label} to press in chat`);
      found.dispatchEvent(new (tab.window as any).Event("click", { bubbles: true }));
      await tab.play(500);
    },
    /** Opens the large chat. */
    async expand() { tab.tap("chatSizeToggle"); await tab.play(300); },
    panel,
  };
}
