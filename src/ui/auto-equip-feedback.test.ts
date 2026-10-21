import { expect, it, vi } from "vitest";
import { createAutoEquipFeedback } from "./auto-equip-feedback";
import { applyServerLoadout, fillEmptyHand, refusedLoadout, serverLoadoutChanges, withServerLoadout } from "../coop/services/server-loadout";
import type { ServerEquip } from "../coop/services/progression-service";
import type { PlayerProgress, ProgressSave } from "../coop/services/progress";
import type { InventoryState } from "../game/inventory";
import { CAMPAIGN_UNLOCK_FIELDS } from "../../shared/equipment-access";
import type { PlayerState } from "../game/runtime/types";

const loadout = (rightHand: string, extra: Record<string, string> = {}) => ({
  equippedHead: "", equippedChest: "", equippedFeet: "", equippedRightHand: rightHand, equippedLeftHand: "", ...extra,
});
const ALL_MAPS = Object.fromEntries(CAMPAIGN_UNLOCK_FIELDS.map(field => [field, true]));
const progress = (rightHand: string, extra: Record<string, unknown> = {}) =>
  ({ ...loadout(rightHand), ...ALL_MAPS, ...extra }) as unknown as PlayerProgress;
const save = (rightHand: string, extra: Record<string, string> = {}) => loadout(rightHand, extra) as unknown as ProgressSave;
const emptiedBySave = [{ field: "equippedRightHand", itemId: "", previous: "eternal_sword" }];

it("takes a slot the server changed while the local save still held the old gear", () => {
  expect(serverLoadoutChanges(progress("iron_bow"), progress("crystal_bow"), null))
    .toEqual([{ field: "equippedRightHand", itemId: "crystal_bow", previous: "iron_bow" }]);
  expect(serverLoadoutChanges(progress("iron_bow"), progress("crystal_bow"), save("iron_bow")))
    .toEqual([{ field: "equippedRightHand", itemId: "crystal_bow", previous: "iron_bow" }]);
  // The echo of this tab's own save, and a slot the player changed since: theirs, not the server's.
  expect(serverLoadoutChanges(progress("iron_bow"), progress("snow_bow"), save("snow_bow"))).toEqual([]);
  expect(serverLoadoutChanges(progress("iron_bow"), progress("crystal_bow"), save("snow_bow"))).toEqual([]);
  // Nothing to compare with before the first row.
  expect(serverLoadoutChanges(null, progress("crystal_bow"), null)).toEqual([]);
  const changes = serverLoadoutChanges(progress("iron_bow"), progress("crystal_bow"), save("iron_bow"));
  expect(withServerLoadout(save("iron_bow", { equippedHead: "wood_full_helm" }), changes))
    .toMatchObject({ equippedRightHand: "crystal_bow", equippedHead: "wood_full_helm" });
});

it("takes a slot the server emptied unless this tab changed it since, and never gear in the wrong slot", () => {
  // An empty hand in the row is the server's: a destroyed weapon, a restored run, a refused save.
  const emptied = [{ field: "equippedRightHand", itemId: "", previous: "eternal_sword" }];
  expect(serverLoadoutChanges(progress("eternal_sword"), progress(""), null)).toEqual(emptied);
  expect(serverLoadoutChanges(progress("eternal_sword"), progress(""), save("eternal_sword"))).toEqual(emptied);
  // A hand this tab changed since is its own choice, still on its way to the server.
  expect(serverLoadoutChanges(progress("eternal_sword"), progress(""), save("crude_bow"))).toEqual([]);
  // A bow from a map not reached is taken in: gear never locks. A bow in the head slot is not.
  expect(serverLoadoutChanges(progress("starter_stone"), progress("iron_bow", { desertUnlocked: false }), null))
    .toEqual([{ field: "equippedRightHand", itemId: "iron_bow", previous: "starter_stone" }]);
  expect(serverLoadoutChanges(progress("starter_stone", { equippedHead: "" }), progress("starter_stone", { equippedHead: "iron_bow" }), null)).toEqual([]);
});

it("lists the slots a save asked for that the server did not put on", () => {
  expect(refusedLoadout(save("eternal_sword"), progress(""))).toEqual(emptiedBySave);
  expect(refusedLoadout(save("eternal_sword"), progress("eternal_sword"))).toEqual([]);
  // An unowned helmet reads as the paper hat on the server: refused too.
  expect(refusedLoadout(save("eternal_sword", { equippedHead: "eternal_medium_helmet" }), progress("eternal_sword", { equippedHead: "basic_paper_hat" })))
    .toEqual([{ field: "equippedHead", itemId: "basic_paper_hat", previous: "eternal_medium_helmet" }]);
});

it("puts a weapon in one hand the way the inventory does, and fills an empty hand from the bag", () => {
  const changes = [{ field: "equippedRightHand" as const, itemId: "crystal_bow", previous: "" }];
  expect(applyServerLoadout(loadout("", { equippedLeftHand: "iron_bow" }), changes))
    .toMatchObject({ equippedRightHand: "crystal_bow", equippedLeftHand: "" });
  const blank = loadout("");
  expect(fillEmptyHand(blank, ["starter_stone", "iron_bow"])).toBe("iron_bow");
  expect(blank.equippedRightHand).toBe("iron_bow");
  // With nothing listed at all it is the stone: every player owns it.
  expect(fillEmptyHand(loadout(""), [])).toBe("starter_stone");
  // Gear never locks behind a map: the strongest owned weapon goes in, and a weapon in hand is left alone.
  expect(fillEmptyHand(loadout(""), ["starter_stone", "starter_bow", "iron_bow"])).toBe("iron_bow");
  expect(fillEmptyHand(loadout("iron_bow"), ["starter_stone", "iron_bow"])).toBe("");
  // An archer is never handed a sword; a swordsman gets the strongest one owned.
  expect(fillEmptyHand(loadout(""), ["starter_stone", "wooden_sword", "iron_bow"], "RANGED")).toBe("iron_bow");
  expect(fillEmptyHand(loadout(""), ["starter_stone", "starter_bow", "wooden_sword", "iron_sword"], "MELEE")).toBe("iron_sword");
  // A weapon lost from the bag is cleared before the fill, so its kind is passed in.
  expect(fillEmptyHand(loadout(""), ["starter_stone", "wooden_sword"], "MELEE")).toBe("wooden_sword");
});

it("puts the server's loadout back and says so when it did not take an equip", () => {
  let listener: ((equip: ServerEquip) => void) | null = null;
  const inventory = { itemIds: ["eternal_sword"], ...loadout("eternal_sword") } as unknown as InventoryState;
  const player = { maxHp: 100, hp: 100, baseMaxHp: 100 } as unknown as PlayerState;
  const messages: string[] = [];
  createAutoEquipFeedback({
    coop: { setOnServerEquip: callback => { listener = callback; } },
    inventory, player, healthMultiplierBonus: () => 0, renderInventory: vi.fn(), showMessage: message => messages.push(message),
  });
  listener!({ changes: emptiedBySave as never, progress: progress(""), live: true, refused: true });
  expect(inventory.equippedRightHand).toBe("");
  expect(messages).toEqual(["Could Not Equip Eternal Crystal Blade"]);
});
