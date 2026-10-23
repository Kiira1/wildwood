import { describe, expect, it, vi } from "vitest";
import { TOWN_EXCHANGE_POSITION, TOWN_FEET_OFFSET } from "../../shared/town";
import { gameWorld, playAs, type GameTab } from "./harness/game";
import { addOres, oreCount } from "../../spacetimedb/src/item-refine";
import { addGold, goldFor } from "../../spacetimedb/src/gold";
import { refineLevelFor, setRefineLevel } from "../../spacetimedb/src/item-refine";
import { inventoryForProgress } from "../../spacetimedb/src/progress-helpers";
import { readPlayerProgress } from "../../spacetimedb/src/wide-stats";

vi.setConfig({ testTimeout: 120_000 });

/** A step south of the clerk, inside the reach that opens his window. */
const AT_CLERK = { x: TOWN_EXCHANGE_POSITION.x, y: TOWN_EXCHANGE_POSITION.y - TOWN_FEET_OFFSET + 45 };

async function trader(world: ReturnType<typeof gameWorld>, name: string, stock: { gold?: number; copper?: number; bow?: number }) {
  const player = world.join(name, { kind: "account" });
  player.patch("player", { mapId: "town", ...AT_CLERK });
  world.setup(ctx => {
    if (stock.gold) addGold(ctx, player.identity, stock.gold);
    if (stock.copper) addOres(ctx, player.identity, "copper_ore", stock.copper);
    if (stock.bow !== undefined) {
      ctx.db.playerProgress.identity.update({ ...ctx.db.playerProgress.identity.find(player.identity), inventoryJson: JSON.stringify(["iron_bow"]) });
      setRefineLevel(ctx, player.identity, "iron_bow", 0n, stock.bow);
    }
  });
  player.disconnect();
  const tab = await playAs(world, name, { kind: "account" });
  return { player, tab };
}

const sheet = (tab: GameTab) => tab.document.querySelector<HTMLDialogElement>("dialog.exchange-sheet[open]");
function press(tab: GameTab, selector: string, text?: string) {
  const found = [...sheet(tab)!.querySelectorAll<HTMLElement>(selector)].find(node => !text || (node.getAttribute("aria-label") ?? node.textContent ?? "").includes(text));
  if (!found) throw new Error(`No ${selector}${text ? ` "${text}"` : ""} in the window: ${sheet(tab)?.textContent}`);
  if ((found as HTMLButtonElement).disabled) throw new Error(`${selector} "${text}" is disabled`);
  found.dispatchEvent(new (tab.window as any).Event("click", { bubbles: true }));
}
function type(tab: GameTab, selector: string, value: string, index = 0) {
  const input = sheet(tab)!.querySelectorAll<HTMLInputElement>(selector)[index];
  input.value = value;
  input.dispatchEvent(new (tab.window as any).Event("input", { bubbles: true }));
}

describe("The Trade Chrysanthemum", () => {
  it("one player sells copper through the window, another finds it by name, buys some and collects it", async () => {
    const world = gameWorld();
    const moss = await trader(world, "Moss", { copper: 300 });
    const ann = await trader(world, "Ann", { gold: 5_000 });
    // Standing at the clerk opens his window.
    expect(await moss.tab.until(() => Boolean(sheet(moss.tab)))).toBe(true);
    expect(await ann.tab.until(() => Boolean(sheet(ann.tab)))).toBe(true);
    // A free account has one slot; the rest are locked.
    expect(sheet(moss.tab)!.querySelectorAll(".exchange-slot.is-locked")).toHaveLength(2);

    press(moss.tab, ".exchange-side.is-sell");
    await moss.tab.play(100);
    press(moss.tab, ".exchange-tile", "Copper Ore");
    await moss.tab.play(100);
    type(moss.tab, ".exchange-stepper input", "100", 0);
    type(moss.tab, ".exchange-stepper input", "10", 1);
    press(moss.tab, ".exchange-confirm", "Place Sell Offer");
    expect(await moss.tab.until(() => [...world.db.exchangeOffer.iter()].length === 1)).toBe(true);
    expect(oreCount({ db: world.db } as never, moss.player.identity, "copper_ore")).toBe(200);
    // The offer now fills Moss's slot.
    expect(await moss.tab.until(() => Boolean(sheet(moss.tab)?.querySelector(".exchange-slot.is-filled")))).toBe(true);

    press(ann.tab, ".exchange-side.is-buy");
    await ann.tab.play(100);
    type(ann.tab, ".exchange-search input", "adaman");
    expect(sheet(ann.tab)!.querySelector(".exchange-none")?.textContent).toBe("None");
    type(ann.tab, ".exchange-search input", "copp");
    expect(await ann.tab.until(() => Boolean(sheet(ann.tab)?.querySelector(".exchange-hit")))).toBe(true);
    const hit = sheet(ann.tab)!.querySelector(".exchange-hit")!;
    // The seller's own display name, as their profile has it.
    expect(hit.querySelector(".exchange-hit-seller")?.textContent).toBe(world.db.playerProfile.identity.find(moss.player.identity)?.displayName);
    expect(hit.querySelector(".exchange-hit-price")?.textContent).toBe("10ea");
    expect(hit.querySelector(".exchange-hit-amount")?.textContent).toBe("×100");
    press(ann.tab, ".exchange-hit");
    await ann.tab.play(100);
    type(ann.tab, ".exchange-stepper input", "40", 0);
    press(ann.tab, ".exchange-confirm", "Place Buy Offer");
    expect(await ann.tab.until(() => [...world.db.exchangeCollect.iter()].length === 1)).toBe(true);

    // 40 at 10: Ann paid 400, Moss got 400 less the 2% fee.
    expect(goldFor({ db: world.db } as never, ann.player.identity)).toBe(4_600n);
    expect(goldFor({ db: world.db } as never, moss.player.identity)).toBe(392n);
    expect(await ann.tab.until(() => Boolean(sheet(ann.tab)?.querySelector(".exchange-collect")))).toBe(true);
    press(ann.tab, ".exchange-collect .exchange-confirm", "Collect");
    expect(await ann.tab.until(() => oreCount({ db: world.db } as never, ann.player.identity, "copper_ore") === 40)).toBe(true);
    expect(await ann.tab.until(() => (ann.tab.coop.ores().copper_ore ?? 0) === 40)).toBe(true);
  });

  it("gear goes up at a set price, is found by name with its refine, bought after a confirm, and arrives refined", async () => {
    const world = gameWorld();
    const moss = await trader(world, "Moss", { bow: 5 });
    const ann = await trader(world, "Ann", { gold: 5_000 });
    expect(await moss.tab.until(() => Boolean(sheet(moss.tab)))).toBe(true);
    press(moss.tab, ".exchange-side.is-sell");
    await moss.tab.play(100);
    press(moss.tab, ".exchange-tile", "Stone Bow");
    await moss.tab.play(100);
    type(moss.tab, ".exchange-stepper input", "1200", 0);
    press(moss.tab, ".exchange-confirm", "Put on Sale");
    // A piece is one of a kind, so its price is asked once more.
    const listAccept = () => [moss.tab.document, ann.tab.document].flatMap(doc => [...doc.querySelectorAll<HTMLButtonElement>(".game-confirm-accept")])
      .find(button => !button.closest("[hidden]")) ?? null;
    expect(await moss.tab.until(() => Boolean(listAccept()))).toBe(true);
    listAccept()!.dispatchEvent(new (moss.tab.window as any).Event("click", { bubbles: true }));
    expect(await moss.tab.until(() => [...world.db.exchangeListing.iter()].length === 1)).toBe(true);
    const held = (who: typeof moss) => inventoryForProgress(readPlayerProgress({ db: world.db } as never, who.player.identity));
    expect(held(moss)).not.toContain("iron_bow");

    expect(await ann.tab.until(() => Boolean(sheet(ann.tab)))).toBe(true);
    press(ann.tab, ".exchange-side.is-buy");
    await ann.tab.play(100);
    type(ann.tab, ".exchange-search input", "stone b");
    expect(await ann.tab.until(() => Boolean(sheet(ann.tab)?.querySelector(".exchange-hit")))).toBe(true);
    expect(sheet(ann.tab)!.querySelector(".exchange-hit-name")?.textContent).toContain("★5");
    press(ann.tab, ".exchange-hit");
    // Gear opens the item window first, its stats and skills, with Buy under them; then the purchase asks once more.
    const buyInWindow = () => [...ann.tab.document.querySelectorAll<HTMLButtonElement>("button")].find(button => /^Buy · /.test(button.textContent ?? "") && !button.closest("[hidden]"));
    expect(await ann.tab.until(() => Boolean(buyInWindow()))).toBe(true);
    buyInWindow()!.dispatchEvent(new (ann.tab.window as any).Event("click", { bubbles: true }));
    const accept = () => [ann.tab.document, moss.tab.document].flatMap(doc => [...doc.querySelectorAll<HTMLButtonElement>(".game-confirm-accept")])
      .find(button => !button.closest("[hidden]")) ?? null;
    expect(await ann.tab.until(() => Boolean(accept()))).toBe(true);
    accept()!.dispatchEvent(new (ann.tab.window as any).Event("click", { bubbles: true }));
    expect(await ann.tab.until(() => [...world.db.exchangeCollect.iter()].length === 1)).toBe(true);
    expect(goldFor({ db: world.db } as never, moss.player.identity)).toBe(1_176n);
    expect(await ann.tab.until(() => Boolean(sheet(ann.tab)?.querySelector(".exchange-collect")))).toBe(true);
    press(ann.tab, ".exchange-collect .exchange-confirm", "Collect");
    expect(await ann.tab.until(() => held(ann).includes("iron_bow"))).toBe(true);
    expect(refineLevelFor({ db: world.db } as never, ann.player.identity, "iron_bow")).toBe(5);
  });
});
