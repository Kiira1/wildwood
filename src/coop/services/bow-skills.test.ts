import { expect, it, vi } from "vitest";
import { betterRollsKept, createBowSkills } from "./bow-skills";

type Row = { itemId: string; arrowStorm: number; ricochet: number; piercingShot: number };

type StaffRow = { itemId: string; copyId: bigint; offerId: bigint; meteor: number; chain: number; frostNova: number };
function fakeConnection(rows: Row[] = [], swords: { itemId: string; whirlwind: number; deflect: number; shockwave: number }[] = [], staffs: StaffRow[] = []) {
  const handlers: Array<() => void> = [];
  let applied: (() => void) | null = null;
  const subscribe = vi.fn();
  const view = (source: () => Iterable<unknown>) => ({
    iter: () => source()[Symbol.iterator](),
    onInsert: (handler: () => void) => handlers.push(handler),
    onUpdate: (handler: () => void) => handlers.push(handler),
    onDelete: (handler: () => void) => handlers.push(handler),
  });
  // The service also carries kept copies and duplicate offers on the same connection.
  const connection = {
    db: { myEquipmentLocks: view(() => []), myBowSkills: view(() => rows), mySwordSkills: view(() => swords), myStaffSkills: view(() => staffs), myEquipmentCopies: view(() => []), myEquipmentOffers: view(() => []), myIgnoredDrops: view(() => []), myLootSettings: view(() => []) },
    subscriptionBuilder: () => ({ onApplied(callback: () => void) { applied = callback; return this; }, subscribe }),
  };
  return { connection: connection as never, rows, swords, staffs, subscribe, settle: () => applied?.(), fire: () => handlers.forEach(handler => handler()) };
}

it("serves this account's roll for each bow once the view settles, and follows changes", () => {
  const notify = vi.fn();
  const skills = createBowSkills(notify);
  const conn = fakeConnection([{ itemId: "iron_bow", arrowStorm: 2.4, ricochet: 0, piercingShot: 0 }]);
  skills.watch(conn.connection, () => true);
  expect(conn.subscribe).toHaveBeenCalledTimes(2);
  expect(skills.bowSkills("iron_bow")).toBeNull();
  conn.settle();
  expect(skills.bowSkills("iron_bow")).toEqual({ arrowStorm: 2.4, ricochet: 0, piercingShot: 0 });
  expect(skills.bowSkills("night_bow")).toBeNull();
  expect(skills.bowSkills("")).toBeNull();
  conn.rows.push({ itemId: "night_bow", arrowStorm: 0, ricochet: 5.1, piercingShot: 0 });
  conn.fire();
  expect(skills.bowSkills("night_bow")).toEqual({ arrowStorm: 0, ricochet: 5.1, piercingShot: 0 });
  expect(notify).toHaveBeenCalled();
});

it("ignores a replaced connection and starts clean on a new one", () => {
  const skills = createBowSkills(() => {});
  let current = true;
  const first = fakeConnection([{ itemId: "iron_bow", arrowStorm: 2, ricochet: 0, piercingShot: 0 }]);
  skills.watch(first.connection, () => current);
  first.settle();
  current = false;
  skills.watch(fakeConnection().connection, () => true);
  first.fire();
  expect(skills.bowSkills("iron_bow")).toBeNull();
});

it("finds the first-copy rolls that got better, and nothing else", () => {
  const roll = (arrowStorm: number, ricochet = 0, piercingShot = 0) => ({ arrowStorm, ricochet, piercingShot });
  const before = new Map([["iron_bow", roll(1.9)], ["snow_bow", roll(3)], ["night_bow", roll(0, 4)]]);
  const after = new Map([["iron_bow", roll(3)], ["snow_bow", roll(2)], ["night_bow", roll(0, 4)], ["lava_bow", roll(9)]]);
  // Stone Bow went from +4.8% to +7.5%. A worse roll, the same roll and a bow
  // that only now has one (a new first copy) are not "kept better".
  expect(betterRollsKept(before, after)).toEqual([{ itemId: "iron_bow", before: 4.75, after: 7.5 }]);
  expect(betterRollsKept(before, after, itemId => itemId === "iron_bow")).toEqual([]);
});

it("says when Auto keep best replaced a roll, but not for the standing rows or this tab's own swaps", async () => {
  const kept = vi.fn();
  const skills = createBowSkills(() => {});
  skills.api.setOnBetterRollKept(kept);
  const conn = fakeConnection([{ itemId: "iron_bow", arrowStorm: 1.9, ricochet: 0, piercingShot: 0 }]);
  skills.watch(conn.connection, () => true);
  conn.fire();
  conn.settle();
  expect(kept).not.toHaveBeenCalled();
  // A view can deliver the change as a delete and then an insert.
  conn.rows.splice(0, 1);
  conn.fire();
  conn.rows.push({ itemId: "iron_bow", arrowStorm: 3, ricochet: 0, piercingShot: 0 });
  conn.fire();
  expect(kept).toHaveBeenCalledTimes(1);
  expect(kept).toHaveBeenCalledWith({ itemId: "iron_bow", before: 4.75, after: 7.5 });
  expect(skills.bowSkills("iron_bow")).toEqual({ arrowStorm: 3, ricochet: 0, piercingShot: 0 });
});


it("reads a sword's own roll, announces a better copy and keeps bow-only callers separate", () => {
  const kept = vi.fn(), skills = createBowSkills(() => {});
  skills.api.setOnBetterRollKept(kept);
  const conn = fakeConnection([], [{ itemId: "ion_sword", whirlwind: 5, deflect: 0, shockwave: 0 }]);
  skills.watch(conn.connection, () => true); conn.settle();
  expect(skills.api.swordSkills("ion_sword")).toEqual({ whirlwind: 5, deflect: 0, shockwave: 0 });
  expect(skills.api.weaponSkills("ion_sword")).toEqual(skills.api.swordSkills("ion_sword"));
  expect(skills.bowSkills("ion_sword")).toBeNull();
  expect(skills.api.swordSkills("ion_bow")).toBeNull();
  conn.swords[0].shockwave = 10; conn.fire();
  expect(kept).toHaveBeenCalledWith({ itemId: "ion_sword", before: 13.5, after: 29.5 });
});

it("reads a staff's first-copy roll and leaves kept copies' and offers' rolls to the copies", () => {
  const skills = createBowSkills(() => {});
  const conn = fakeConnection([], [], [
    { itemId: "ion_staff", copyId: 0n, offerId: 0n, meteor: 9, chain: 0, frostNova: 4 },
    { itemId: "ion_staff", copyId: 3n, offerId: 0n, meteor: 1, chain: 1, frostNova: 1 },
    { itemId: "ion_staff", copyId: 0n, offerId: 5n, meteor: 2, chain: 2, frostNova: 2 },
  ]);
  skills.watch(conn.connection, () => true);
  conn.settle();
  expect(skills.api.staffSkills("ion_staff")).toEqual({ meteor: 9, chain: 0, frostNova: 4 });
  expect(skills.api.weaponSkills("ion_staff")).toEqual({ meteor: 9, chain: 0, frostNova: 4 });
  expect(skills.bowSkills("ion_staff")).toBeNull();
  expect(skills.api.equipmentCopies()).toEqual([]);
});
