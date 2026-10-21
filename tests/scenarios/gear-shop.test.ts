import { describe, expect, it } from "vitest";
import { craftMaterialsKey, gradeCraftMaterials } from "../../shared/grade-craft";
import { gameWorld, playAs, type GameTab } from "./harness/game";
import { scenarioWorld } from "./harness/server";
import { CRAFTED_REFINE } from "../../shared/crafting";
import { setRefineLevel } from "../../spacetimedb/src/item-refine";
import { writeLuckRanks } from "../../spacetimedb/src/luck-research";
import { refineCost, refineSafeLimit, refineSuccessChance } from "../../shared/refine";
import { refineStars } from "../../src/ui/refine-badge";
import type { OreId } from "../../shared/refine";
import {
  TOWN_SPOTS, answerConfirm, answered, bagItems, deliverRows, fillBag, freeSlots, giveGold, giveItems, giveOres, goldOf, oresOf, playUntil, press,
  readyToPrestige, refineOf, serverBag, wear, setMastery, shownNumber, signInAs, standAt, windowTitled, wornItems,
} from "./harness/gear";

/** The Smith's window while it is open. */
const smithWindow = (tab: GameTab) => windowTitled(tab, "smithTitle");
/** The Buy row offering this piece. */
const offer = (tab: GameTab, itemId: string) => smithWindow(tab)?.querySelector<HTMLElement>(`[data-item-id="${itemId}"]`) ?? null;
/** A row's own action: the last button on it (Buy, Craft). */
const action = (row: Element | null) => [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])].at(-1) ?? null;
/** The price a row shows, in gold. */
const shownPrice = (row: Element | null) => shownNumber(row?.querySelector("[aria-label$=' Gold']")?.textContent);
const hudGold = (tab: GameTab) => shownNumber(tab.element("hudGoldBalance").textContent);

describe("the Smith", () => {
  it("GEAR-07 Buy charges exactly the shown gold, keeps grade gates and bag room, refuses a stale price and spends nothing when it refuses", async () => {
    const world = gameWorld();
    const ann = world.join("Ann");
    standAt(world, ann, TOWN_SPOTS.smith);
    giveGold(world, ann, 1_000);
    setMastery(world, ann, "archery", 1);
    ann.disconnect();
    const tab = await playAs(world, "Ann");
    await playUntil(tab, () => Boolean(offer(tab, "common_bow")), "the Smith opens on Buy beside him");

    // Buy: the shown price leaves the gold, and the piece lands in the bag, not worn.
    const bow = offer(tab, "common_bow");
    const price = shownPrice(bow);
    expect(price).toBeGreaterThan(0);
    press(tab, action(bow));
    await playUntil(tab, () => serverBag(ann).includes("common_bow"), "the bow is bought");
    expect(goldOf(world, ann)).toBe(BigInt(1_000 - price));
    await playUntil(tab, () => hudGold(tab) === 1_000 - price, "the HUD shows the gold left");

    // The line's next grade wants Lv 2 Archery: the row cannot be bought, and the server refuses it too.
    const locked = offer(tab, "sturdy_bow");
    expect(action(locked)?.disabled).toBe(true);
    const goldBefore = goldOf(world, ann);
    expect((await tab.coop.buyGradeGear("sturdy_bow", shownPrice(locked))).ok).toBe(false);
    expect(goldOf(world, ann)).toBe(goldBefore);
    expect(serverBag(ann)).not.toContain("sturdy_bow");

    // A price other than the Smith's is refused and takes nothing.
    const helmet = offer(tab, "common_light_helmet");
    const helmetPrice = shownPrice(helmet);
    expect(action(helmet)?.disabled).toBe(false);
    expect((await tab.coop.buyGradeGear("common_light_helmet", helmetPrice - 1)).ok).toBe(false);
    expect(goldOf(world, ann)).toBe(goldBefore);
    expect(serverBag(ann)).not.toContain("common_light_helmet");

    // Short of every price: the row waits, and the server takes nothing.
    world.setup(ctx => ctx.db.playerGold.identity.update({ ...ctx.db.playerGold.identity.find(ann.identity), gold: 100n }));
    deliverRows(tab);
    await playUntil(tab, () => action(offer(tab, "common_light_helmet"))?.disabled === true, "the helmet waits for gold");
    expect((await tab.coop.buyGradeGear("common_light_helmet", helmetPrice)).ok).toBe(false);
    expect(goldOf(world, ann)).toBe(100n);

    // A full bag: the row waits, and the server refuses with the gold untouched.
    giveGold(world, ann, 1_000);
    deliverRows(tab);
    await playUntil(tab, () => action(offer(tab, "common_light_helmet"))?.disabled === false, "the gold is back");
    fillBag(world, ann, "common_bow");
    deliverRows(tab);
    await playUntil(tab, () => action(offer(tab, "common_light_helmet"))?.disabled === true, "the helmet waits for bag room");
    const fullGold = goldOf(world, ann);
    expect((await tab.coop.buyGradeGear("common_light_helmet", helmetPrice)).ok).toBe(false);
    expect(goldOf(world, ann)).toBe(fullGold);
    expect(serverBag(ann)).not.toContain("common_light_helmet");

    // Room again: the Smith sells only in the Town, beside him.
    world.setup(ctx => { for (const copy of [...ctx.db.playerEquipmentCopy.identity.filter(ann.identity)]) ctx.db.playerEquipmentCopy.delete(copy); });
    deliverRows(tab);
    await playUntil(tab, () => action(offer(tab, "common_light_helmet"))?.disabled === false, "the bag has room again");
    press(tab, smithWindow(tab)!.querySelector("footer button"));
    expect(smithWindow(tab)).toBeNull();

    // The bag shows the bow bought, and the hand still holds what it held.
    expect(bagItems(tab).map(item => item.itemId)).toContain("common_bow");
    expect(wornItems(tab).hand).not.toBe("common_bow");

    standAt(world, ann, { ...TOWN_SPOTS.smith, mapId: "crystal_hollows" });
    expect((await tab.coop.buyGradeGear("common_light_helmet", helmetPrice)).ok).toBe(false);
    expect(goldOf(world, ann)).toBe(fullGold);
  }, 60_000);

  it("GEAR-10 Craft takes exactly the materials shown or none, makes the piece at ★2, reforges a line held and raises the craft", async () => {
    const world = gameWorld();
    const ann = world.join("Ann");
    standAt(world, ann, TOWN_SPOTS.smith);
    giveOres(world, ann, { pine_log: 30, copper_ore: 30 });
    ann.disconnect();
    const tab = await playAs(world, "Ann");
    await playUntil(tab, () => Boolean(smithWindow(tab)), "the Smith opens");
    press(tab, smithWindow(tab)!.querySelector("button[data-view=craft]"));
    press(tab, smithWindow(tab)!.querySelector("[data-view=craft] [data-shown=all]"));
    const craftRow = (itemId: string) => smithWindow(tab)!.querySelector(`[data-view=craft] [data-item-id="${itemId}"]`);
    /** What a row says it takes: material id to the count needed. */
    const needs = (row: Element | null) => Object.fromEntries([...(row?.querySelectorAll<HTMLElement>("[data-material]") ?? [])]
      .map(item => [item.dataset.material!, Number(/\/\s*([\d,]+)/.exec(item.textContent ?? "")![1].replace(/,/g, ""))]));
    const fletching = () => world.db.playerCraftSkill.key.find(`${ann.hex}:fletching`)?.experience ?? 0n;

    // Craft: the shown materials leave the bag and the bow arrives at ★2, not worn.
    const bow = needs(craftRow("crude_bow"));
    expect(Object.keys(bow).length).toBeGreaterThan(0);
    press(tab, action(craftRow("crude_bow")));
    await playUntil(tab, () => serverBag(ann).includes("crude_bow"), "the bow is crafted");
    for (const [oreId, count] of Object.entries(bow)) expect(oresOf(world, ann, oreId as OreId)).toBe(30 - count);
    expect(refineOf(world, ann, "crude_bow")).toBe(CRAFTED_REFINE);
    expect(ann.progress().equippedRightHand).not.toBe("crude_bow");
    const once = fletching();
    expect(once).toBeGreaterThan(0n);
    expect(world.db.playerCraftLevel.key.find(`${ann.hex}:fletching`)?.level).toBeGreaterThan(1);

    // Fletching now opens Common; a step down the line's grades reforges the bow held: the same materials and
    // experience again, no second bow.
    const bagSize = serverBag(ann).length;
    await playUntil(tab, () => Boolean(craftRow("common_bow")), "the line offers the next grade");
    press(tab, craftRow("common_bow")!.querySelector("[role=group] button"));
    expect(action(craftRow("crude_bow"))?.disabled).toBe(false);
    // Refined further since: a reforge keeps the refine.
    world.setup(ctx => setRefineLevel(ctx, ann.identity, "crude_bow", 0n, 5));
    press(tab, action(craftRow("crude_bow")));
    await playUntil(tab, () => fletching() === once * 2n, "the reforge trains Fletching again");
    for (const [oreId, count] of Object.entries(bow)) expect(oresOf(world, ann, oreId as OreId)).toBe(30 - 2 * count);
    expect(serverBag(ann).length).toBe(bagSize);
    expect(refineOf(world, ann, "crude_bow")).toBe(5);
    expect([...world.db.playerEquipmentCopy.identity.filter(ann.identity)]).toEqual([]);

    // Short of one material: the row waits, and the server takes nothing, not even what there is.
    const staff = craftRow("crude_staff");
    expect(Object.keys(needs(staff))).toContain("arcane_crystal");
    expect(action(staff)?.disabled).toBe(true);
    const pine = oresOf(world, ann, "pine_log");
    expect((await answered(tab, tab.coop.craftGradeGear("crude_staff"))).ok).toBe(false);
    expect(oresOf(world, ann, "pine_log")).toBe(pine);
    expect(serverBag(ann)).not.toContain("crude_staff");
  }, 60_000);

  it("GEAR-10 the server gates crafts by craft level and bag room, refuses a stale recipe, and keeps crafts through prestige and sign-in", () => {
    const world = scenarioWorld();
    const ann = world.join("Ann");
    standAt(world, ann, TOWN_SPOTS.smith);
    const all: Partial<Record<OreId, number>> = Object.fromEntries((["copper_ore", "iron_ore", "mithril_ore", "adamant_ore", "starshard", "pine_log", "oak_log", "yew_log", "elder_log", "arcane_crystal"] as OreId[]).map(id => [id, 100_000]));
    giveOres(world, ann, all);
    const craft = (itemId: string, expectedMaterials = craftMaterialsKey(gradeCraftMaterials(itemId)!)) => ann.refusal("craftGradeGear", { itemId, expectedMaterials });

    // A grade opens by the craft's level; Mastery plays no part.
    expect(craft("rare_bow")).not.toBeNull();
    expect(craft("crude_heavy_armor")).toBeNull();
    // Armor held is not made twice, and a recipe other than the server's is refused.
    expect(craft("crude_heavy_armor")).not.toBeNull();
    expect(craft("crude_heavy_helmet", "[]")).not.toBeNull();
    expect(serverBag(ann)).not.toContain("crude_heavy_helmet");

    // Fletching and Enchanting still craft at their old school spots, for clients from before the move.
    standAt(world, ann, TOWN_SPOTS.school("archery"));
    expect(craft("crude_light_armor")).toBeNull();
    expect(craft("crude_magic_helmet")).not.toBeNull();
    standAt(world, ann, TOWN_SPOTS.school("swordplay"));
    expect(craft("crude_sword")).not.toBeNull();
    standAt(world, ann, TOWN_SPOTS.smith);

    // A full bag refuses a new piece, unless the craft uses up a whole stack and frees its slot.
    giveItems(world, ann, "crude_heavy_armor");
    fillBag(world, ann, "crude_heavy_armor");
    expect(craft("crude_light_helmet")).not.toBeNull();
    const copper = Object.entries(gradeCraftMaterials("crude_sword")!).find(([id]) => id === "copper_ore")![1] as number;
    world.setup(ctx => ctx.db.playerOre.key.update({ ...ctx.db.playerOre.key.find(`${ann.hex}:copper_ore`), count: copper }));
    expect(craft("crude_sword")).toBeNull();
    expect(freeSlots(world, ann)).toBe(0);

    // Crafts stay through prestige, follow the guest onto the account, and go with Reset Save.
    const smithing = world.db.playerCraftSkill.key.find(`${ann.hex}:smithing`)?.experience;
    expect(smithing).toBeGreaterThan(0n);
    readyToPrestige(world, ann);
    ann.call("prestigeAccount");
    expect(world.db.playerCraftSkill.key.find(`${ann.hex}:smithing`)?.experience).toBe(smithing);
    const account = signInAs(world, ann, "Ann's account");
    expect(world.db.playerCraftSkill.key.find(`${account.hex}:smithing`)?.experience).toBe(smithing);
    expect([...world.db.playerCraftSkill.identity.filter(ann.identity)]).toEqual([]);
    account.call("enterWorldWithTutorial", { tabId: "tab-account", forceTakeover: false });
    account.call("resetPlayerProgress");
    expect([...world.db.playerCraftSkill.identity.filter(account.identity)]).toEqual([]);
    expect([...world.db.playerCraftLevel.identity.filter(account.identity)]).toEqual([]);
  });

  it("GEAR-11 Refine charges the shown ore, shows the odds the server rolls with, puts the star on the worn slot and item window and raises the power, and frees a hung try", async () => {
    const world = gameWorld();
    const ann = world.join("Ann");
    standAt(world, ann, TOWN_SPOTS.smith);
    // A seasoned archer, so a weapon's refine moves the power figure.
    ann.patch("playerProgress", { damage: 1_000_000 });
    wear(world, ann, "crude_bow", "equippedRightHand");
    giveOres(world, ann, { copper_ore: 50, iron_ore: 50, mithril_ore: 50 });
    ann.disconnect();
    const network = {} as { hold?: boolean };
    const tab = await playAs(world, "Ann", { client: network });
    await playUntil(tab, () => Boolean(smithWindow(tab)), "the Smith opens");
    press(tab, smithWindow(tab)!.querySelector("button[data-view=refine]"));
    const focus = () => smithWindow(tab)!.querySelector<HTMLElement>("[data-view=refine] [aria-live=polite]")!;
    const refineButton = () => [...focus().querySelectorAll("button")].at(-1)!;
    const shownChance = () => focus().querySelector("dd")!.textContent!;
    const power = () => world.db.player.identity.find(ann.identity)!.powerLevel;

    // A safe try: the ore it costs leaves the bag, the worn bow goes to ★1 and the power rises.
    const cost = refineCost("crude_bow", 1)!;
    const before = { ores: Object.fromEntries(Object.keys(cost).map(id => [id, oresOf(world, ann, id as OreId)])), power: power() };
    expect(refineSafeLimit("crude_bow")).toBeGreaterThanOrEqual(1);
    press(tab, refineButton());
    await playUntil(tab, () => refineOf(world, ann, "crude_bow") === 1, "the bow is refined");
    for (const [oreId, count] of Object.entries(cost)) expect(oresOf(world, ann, oreId as OreId)).toBe(before.ores[oreId] - count!);
    expect(power()).toBeGreaterThan(before.power);

    // Past the safe limit with Refine Luck: the window shows the chance the server rolls with.
    const safe = refineSafeLimit("crude_bow");
    world.setup(ctx => { setRefineLevel(ctx, ann.identity, "crude_bow", 0n, safe); writeLuckRanks(ctx, ann.identity, { refineLuck: 3 }); });
    deliverRows(tab);
    const expected = refineSuccessChance("crude_bow", safe + 1, 3) * 100;
    await playUntil(tab, () => Math.abs(shownNumber(shownChance()) - expected) < 0.05, `the window shows ${expected}%`);
    expect(expected).not.toBeCloseTo(refineSuccessChance("crude_bow", safe + 1, 0) * 100, 1);

    // A try the network swallows: the button frees itself, nothing is charged twice.
    network.hold = true;
    const held = oresOf(world, ann, "copper_ore");
    press(tab, refineButton());
    expect(refineButton().disabled).toBe(true);
    await playUntil(tab, () => !refineButton().disabled, "the button frees itself", 20_000);
    network.hold = false;
    expect(oresOf(world, ann, "copper_ore")).toBe(held);

    // The star shows on the worn slot and in the item window.
    press(tab, smithWindow(tab)!.querySelector("footer button"));
    tab.tap("inventoryBtn");
    expect(tab.element("equippedRightHandSlot").textContent).toContain(refineStars(safe));
    tab.tap("equippedRightHandSlot");
    expect(tab.shown("itemInspectionTitle")).toBe(true);
    expect(tab.element("itemInspectionContent").textContent).toContain(refineStars(safe));
  }, 60_000);

  it("GEAR-08 Upgrade All spends the gold it shows and puts every piece on", async () => {
    const world = gameWorld();
    const ann = world.join("Ann");
    standAt(world, ann, TOWN_SPOTS.smith);
    giveGold(world, ann, 1_000);
    setMastery(world, ann, "archery", 1);
    ann.disconnect();
    const tab = await playAs(world, "Ann");
    await playUntil(tab, () => Boolean(smithWindow(tab)), "the Smith opens");
    // The big button heads the Buy tab: its total, and the pieces it lists.
    const upgrade = () => smithWindow(tab)!.querySelector<HTMLButtonElement>("[data-view=buy]:not(button) button")!;
    const total = shownNumber(upgrade().querySelector("span")!.textContent);
    expect(total).toBeGreaterThan(0);
    // The HUD says there are upgrades at the Smith while there are.
    expect(tab.shown("smithBuyNotice")).toBe(true);
    press(tab, upgrade());
    await playUntil(tab, () => goldOf(world, ann) === BigInt(1_000 - total), "Upgrade All is paid");
    const worn = () => { const progress = ann.progress(); return [progress.equippedRightHand, progress.equippedHead, progress.equippedChest, progress.equippedFeet]; };
    await playUntil(tab, () => worn().every(itemId => itemId.startsWith("common_")), "every piece goes on", 10_000);
    expect(worn()).toEqual(["common_bow", "common_light_helmet", "common_light_armor", "common_ranger_boots"]);
    // Nothing more to buy at this Mastery: the button waits.
    await playUntil(tab, () => upgrade().disabled && !tab.shown("smithBuyNotice"), "Upgrade All waits");
    press(tab, smithWindow(tab)!.querySelector("footer button"));
    expect(wornItems(tab)).toEqual({ hand: "common_bow", head: "common_light_helmet", chest: "common_light_armor", feet: "common_ranger_boots" });
  }, 60_000);

  it("GEAR-09 selling graded gear pays the gold shown, one copy at a time, and never a worn or locked piece", async () => {
    const world = gameWorld();
    const ann = world.join("Ann");
    wear(world, ann, "common_bow", "equippedRightHand");
    giveItems(world, ann, "crude_bow");
    giveGold(world, ann, 100);
    world.setup(ctx => {
      setRefineLevel(ctx, ann.identity, "crude_bow", 0n, 3);
      ctx.db.playerEquipmentCopy.insert({ id: 0n, identity: ann.identity, itemId: "crude_bow", arrowStorm: 0, ricochet: 0, piercingShot: 0, whirlwind: 0, deflect: 0, shockwave: 0, acquiredAt: ctx.timestamp });
    });
    ann.disconnect();
    const tab = await playAs(world, "Ann");
    const session = tab.network.players.get("Ann")!;
    const bowEntries = () => bagItems(tab).filter(item => item.itemId === "crude_bow");
    /** Opens a bag entry's window and sells it at the price on its button. */
    async function sell(entry: { node: HTMLElement }) {
      press(tab, entry.node);
      const actions = [...tab.element("itemInspectionPanel").querySelectorAll<HTMLButtonElement>("[class*=action] button")];
      const sale = actions.at(-1)!;
      const price = shownNumber(sale.textContent);
      const before = goldOf(world, ann);
      press(tab, sale);
      await answerConfirm(tab, true);
      await playUntil(tab, () => goldOf(world, ann) === before + BigInt(price), "the sale is paid");
      return price;
    }

    // Two crude bows: the first sale takes one copy and leaves the other.
    expect(bowEntries()).toHaveLength(2);
    const first = await sell(bowEntries()[0]);
    expect(first).toBeGreaterThan(0);
    expect(serverBag(ann)).toContain("crude_bow");
    await playUntil(tab, () => bowEntries().length === 1, "the bag shows one bow left");
    // The last one goes, and its refine with it.
    expect(await sell(bowEntries()[0])).toBe(first);
    expect(serverBag(ann)).not.toContain("crude_bow");
    expect(refineOf(world, ann, "crude_bow")).toBe(0);
    await playUntil(tab, () => bowEntries().length === 0, "the bag shows no bow");

    // The bow in hand, or a locked piece, is not for sale: nothing is paid.
    const gold = goldOf(world, ann);
    expect(session.refusal("sellGradedItem", { itemId: "common_bow", copyId: 0n })).not.toBeNull();
    giveItems(world, ann, "rare_bow");
    session.call("setEquipmentLocked", { itemId: "rare_bow", copyId: 0n, locked: true });
    expect(session.refusal("sellGradedItem", { itemId: "rare_bow", copyId: 0n })).not.toBeNull();
    expect(goldOf(world, ann)).toBe(gold);
    expect(serverBag(ann)).toEqual(expect.arrayContaining(["common_bow", "rare_bow"]));
  }, 60_000);
});
