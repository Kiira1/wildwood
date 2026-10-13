import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity } from "../../tests/helpers/crystal-hollows-fixture";
import {
  addOres, hasOres, itemRefineKey, mergeRefineData, oreCount, oreKey, promoteCopyRefine, refineLevelFor, removeRefineData,
  setRefineLevel, swapFirstCopyRefine, takeOres,
} from "./item-refine";
import { removePlayerItemDrops } from "./item-upgrade-runtime";
import { eraseIdentityRows } from "./account-erasure";
import { moveIdentityRows } from "./account-transfer";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
const player = (f: Fixture) => f.ctx.sender;

function stocked(f: Fixture, who = player(f)) {
  setRefineLevel(f.ctx, who, "ion_bow", 0n, 7);
  setRefineLevel(f.ctx, who, "ion_bow", 41n, 3);
  addOres(f.ctx, who, "adamant_ore", 5);
  addOres(f.ctx, who, "starshard", 1);
  f.ctx.db.playerRefineResult.insert({ identity: who, itemId: "ion_bow", copyId: 0n, fromLevel: 6, toLevel: 7, succeeded: true, attempt: 1, triedAt: f.ctx.timestamp });
}

describe("refine levels", () => {
  it("belong to one copy each, and +0 keeps no row", () => {
    const f = crystalFixture();
    expect(refineLevelFor(f.ctx, player(f), "ion_bow")).toBe(0);
    setRefineLevel(f.ctx, player(f), "ion_bow", 0n, 5);
    setRefineLevel(f.ctx, player(f), "ion_bow", 9n, 2);
    expect(refineLevelFor(f.ctx, player(f), "ion_bow")).toBe(5);
    expect(refineLevelFor(f.ctx, player(f), "ion_bow", 9n)).toBe(2);
    expect(f.db.playerItemRefine.key.find(itemRefineKey(player(f), "ion_bow"))).toMatchObject({ itemId: "ion_bow", level: 5 });
    setRefineLevel(f.ctx, player(f), "ion_bow", 0n, 0);
    setRefineLevel(f.ctx, player(f), "ion_bow", 9n, 0);
    expect(f.db.playerItemRefine.key.find(itemRefineKey(player(f), "ion_bow"))).toBeFalsy();
    expect(f.db.playerCopyRefine.copyId.find(9n)).toBeFalsy();
  });

  it("trade places when a kept copy becomes the first, and move up when the first is destroyed", () => {
    const f = crystalFixture();
    setRefineLevel(f.ctx, player(f), "ion_bow", 0n, 7);
    setRefineLevel(f.ctx, player(f), "ion_bow", 9n, 3);
    swapFirstCopyRefine(f.ctx, player(f), "ion_bow", 9n);
    expect([refineLevelFor(f.ctx, player(f), "ion_bow"), refineLevelFor(f.ctx, player(f), "ion_bow", 9n)]).toEqual([3, 7]);
    promoteCopyRefine(f.ctx, player(f), "ion_bow", 9n);
    expect([refineLevelFor(f.ctx, player(f), "ion_bow"), refineLevelFor(f.ctx, player(f), "ion_bow", 9n)]).toEqual([7, 0]);
    // A copy at +0 taking over leaves the first at +0 too.
    promoteCopyRefine(f.ctx, player(f), "ion_bow", 12n);
    expect(refineLevelFor(f.ctx, player(f), "ion_bow")).toBe(0);
  });
});

describe("ores", () => {
  it("add up, and a cost is taken whole or not at all", () => {
    const f = crystalFixture();
    addOres(f.ctx, player(f), "adamant_ore", 2);
    addOres(f.ctx, player(f), "adamant_ore", 1);
    addOres(f.ctx, player(f), "starshard", 0);
    expect(oreCount(f.ctx, player(f), "adamant_ore")).toBe(3);
    expect(hasOres(f.ctx, player(f), { adamant_ore: 1, starshard: 1 })).toBe(false);
    expect(takeOres(f.ctx, player(f), { adamant_ore: 1, starshard: 1 })).toBe(false);
    expect(oreCount(f.ctx, player(f), "adamant_ore")).toBe(3);
    expect(takeOres(f.ctx, player(f), { adamant_ore: 3 })).toBe(true);
    expect(f.db.playerOre.key.find(oreKey(player(f), "adamant_ore"))).toBeFalsy();
  });
});

describe("what keeps them", () => {
  it("prestige keeps refines and ores with the bag; Reset Save takes them with it", () => {
    const f = crystalFixture();
    stocked(f);
    removePlayerItemDrops(f.ctx, player(f), true);
    expect(refineLevelFor(f.ctx, player(f), "ion_bow")).toBe(7);
    expect(oreCount(f.ctx, player(f), "adamant_ore")).toBe(5);
    removePlayerItemDrops(f.ctx, player(f), false);
    expect(refineLevelFor(f.ctx, player(f), "ion_bow")).toBe(0);
    expect(refineLevelFor(f.ctx, player(f), "ion_bow", 41n)).toBe(0);
    expect(oreCount(f.ctx, player(f), "adamant_ore")).toBe(0);
    expect(f.db.playerRefineResult.identity.find(player(f))).toBeFalsy();
  });

  it("a guest's replace the account's on sign-in, as the guest's bag does", () => {
    const f = crystalFixture();
    const guest = identity("a"), account = identity("b");
    stocked(f, guest);
    setRefineLevel(f.ctx, account, "neon_bow", 0n, 9);
    addOres(f.ctx, account, "copper_ore", 40);
    mergeRefineData(f.ctx, guest, account);
    expect(refineLevelFor(f.ctx, account, "ion_bow")).toBe(7);
    expect(refineLevelFor(f.ctx, account, "ion_bow", 41n)).toBe(3);
    expect(f.db.playerCopyRefine.copyId.find(41n)?.identity.isEqual(account)).toBe(true);
    expect(refineLevelFor(f.ctx, account, "neon_bow")).toBe(0);
    expect([oreCount(f.ctx, account, "adamant_ore"), oreCount(f.ctx, account, "copper_ore")]).toEqual([5, 0]);
    expect([...f.db.playerItemRefine.identity.filter(guest)]).toHaveLength(0);
    expect([...f.db.playerOre.identity.filter(guest)]).toHaveLength(0);
  });

  it("are erased with the account and leave everyone else's", () => {
    const f = crystalFixture();
    const other = identity("c");
    stocked(f);
    stocked(f, other);
    f.db.playerCopyRefine.copyId.update({ ...f.db.playerCopyRefine.copyId.find(41n), identity: other });
    setRefineLevel(f.ctx, player(f), "ion_bow", 42n, 4);
    eraseIdentityRows(f.ctx, [player(f)]);
    expect(refineLevelFor(f.ctx, player(f), "ion_bow")).toBe(0);
    expect(f.db.playerCopyRefine.copyId.find(42n)).toBeFalsy();
    expect(oreCount(f.ctx, player(f), "adamant_ore")).toBe(0);
    expect(f.db.playerRefineResult.identity.find(player(f))).toBeFalsy();
    expect(refineLevelFor(f.ctx, other, "ion_bow")).toBe(7);
    expect(oreCount(f.ctx, other, "adamant_ore")).toBe(5);
  });

  it("move with the character when it moves to another login", () => {
    const f = crystalFixture();
    const login = identity("d");
    stocked(f);
    moveIdentityRows(f.ctx, player(f), login);
    expect(refineLevelFor(f.ctx, login, "ion_bow")).toBe(7);
    expect(refineLevelFor(f.ctx, login, "ion_bow", 41n)).toBe(3);
    expect(oreCount(f.ctx, login, "adamant_ore")).toBe(5);
    expect(f.db.playerRefineResult.identity.find(login)).toBeTruthy();
    expect(refineLevelFor(f.ctx, player(f), "ion_bow")).toBe(0);
  });
});

it("removeRefineData leaves other players alone", () => {
  const f = crystalFixture();
  const other = identity("e");
  stocked(f, other);
  removeRefineData(f.ctx, player(f));
  expect(refineLevelFor(f.ctx, other, "ion_bow")).toBe(7);
});
