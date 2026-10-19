import { describe, expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { addCard } from "./gear-cards";
import { activeCardsFor } from "./active-cards";
import { buildLabel, cleanBuildName, parseBuildCards, parseBuildGear } from "../../shared/builds";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

/** Wearing an Ion Bow, a Sky Bow in the bag, two Needle cards and a Spitter card owned, one Needle active. */
function builder() {
  const f = crystalFixture();
  f.patch("playerProgress", { inventoryJson: JSON.stringify(["ion_bow", "sky_bow"]), equippedRightHand: "ion_bow" });
  f.transaction(() => {
    addCard(f.ctx, f.ctx.sender, "needle_card", 2);
    addCard(f.ctx, f.ctx.sender, "spitter_card", 1);
    addCard(f.ctx, f.ctx.sender, "brood_card", 1);
  });
  f.run(server.activateCard, { cardId: "needle_card", expectedActive: 0 });
  return { ...f, active: () => activeCardsFor(f.ctx, f.ctx.sender) };
}

describe("builds", () => {
  it("saves the worn gear and the active cards by type", () => {
    const f = builder();
    f.run(server.saveBuild, { slot: 1 });
    const row = f.db.playerBuild.key.find(`${f.ctx.sender.toHexString()}:1`);
    expect(parseBuildGear(row.gearJson).HAND).toBe("ion_bow");
    expect(JSON.parse(row.cardsJson)).toEqual({ HAND: ["needle_card"], HEAD: [], CHEST: [] });
    expect(() => f.run(server.saveBuild, { slot: 3 })).toThrow("That build does not exist.");
  });

  it("puts a build's active cards back, within the slots in play and the copies owned", () => {
    const f = builder();
    f.run(server.saveBuild, { slot: 0 });
    f.run(server.deactivateCard, { cardType: "HAND", index: 0, cardId: "needle_card" });
    f.run(server.activateCard, { cardId: "spitter_card", expectedActive: 0 });
    f.run(server.activateCard, { cardId: "brood_card", expectedActive: 0 });
    f.run(server.saveBuild, { slot: 1 });
    f.run(server.applyBuildCards, { slot: 0 });
    expect(f.active()).toEqual({ HAND: ["needle_card"], HEAD: [], CHEST: [] });
    f.run(server.applyBuildCards, { slot: 1 });
    expect(f.active()).toEqual({ HAND: ["spitter_card"], HEAD: ["brood_card"], CHEST: [] });
    expect(() => f.run(server.applyBuildCards, { slot: 2 })).toThrow("Save this build first.");
  });

  it("reads a build saved by item before 0.912 by each card's type, and skips copies not owned", () => {
    const f = builder();
    f.transaction(() => f.db.playerBuild.insert({ key: `${f.ctx.sender.toHexString()}:2`, identity: f.ctx.sender, slot: 2,
      gearJson: JSON.stringify({ HAND: "ion_bow", HEAD: "", CHEST: "", FEET: "" }),
      cardsJson: JSON.stringify({ ion_bow: ["needle_card", "needle_card", "needle_card"], forest_cap: ["brood_card"] }), savedAt: f.ctx.timestamp }));
    expect(parseBuildCards(f.db.playerBuild.key.find(`${f.ctx.sender.toHexString()}:2`).cardsJson))
      .toEqual({ HAND: ["needle_card", "needle_card", "needle_card"], HEAD: ["brood_card"], CHEST: [] });
    f.transaction(() => f.db.playerPrestigeCardPerk.insert({ identity: f.ctx.sender, weaponCards: 3, helmetCards: 0, armorCards: 0 }));
    f.run(server.applyBuildCards, { slot: 2 });
    // Two Needle cards owned: two active, the third skipped.
    expect(f.active()).toEqual({ HAND: ["needle_card", "needle_card"], HEAD: ["brood_card"], CHEST: [] });
  });
});

describe("build names", () => {
  it("names a build, cleaned and at most 20 characters, and an empty name gives it its number back", () => {
    const f = builder();
    const key = `${f.ctx.sender.toHexString()}:2`;
    f.run(server.renameBuild, { slot: 2, name: "  Boss   killer\n  " });
    expect(f.db.playerBuildName.key.find(key).name).toBe("Boss killer");
    f.run(server.renameBuild, { slot: 2, name: "x".repeat(40) });
    expect(f.db.playerBuildName.key.find(key).name).toBe("x".repeat(20));
    f.run(server.renameBuild, { slot: 2, name: "   " });
    expect(f.db.playerBuildName.key.find(key)).toBeFalsy();
    expect(() => f.run(server.renameBuild, { slot: 3, name: "Nope" })).toThrow("That build does not exist.");
  });

  it("calls a build by its name, or its number", () => {
    expect(cleanBuildName("\u0007Farm\tset ")).toBe("Farm set");
    expect(buildLabel(0, "")).toBe("Build 1");
    expect(buildLabel(1, "Reflect")).toBe("Reflect");
  });
});
