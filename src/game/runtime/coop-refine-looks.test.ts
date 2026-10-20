import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../wildstat-coop", () => ({ wildstatCoop: {} }));

import { claimCoopClient } from "./coop-session-controller";
import { localItemRefine } from "../local-item-refines";

afterEach(() => vi.unstubAllGlobals());

// coop-client.js and game.js are separate bundles, each with its own copy of local-item-refines.ts.
describe("the character's refine looks", () => {
  it("reads the local player's refines from the coop client the game claims", () => {
    const refines: Record<string, number> = { rare_bow: 12 };
    vi.stubGlobal("window", { wildstatCoop: { claimGameBridge: () => ({}), itemRefine: (itemId: string) => refines[itemId] ?? 0 } });
    claimCoopClient(() => 0);
    expect([localItemRefine("rare_bow"), localItemRefine("epic_sword")]).toEqual([12, 0]);
    refines.rare_bow = 13;
    expect(localItemRefine("rare_bow")).toBe(13);
  });

  it("is never set from the coop bundle, where the game cannot see it", () => {
    const root = new URL("../../coop/", import.meta.url);
    const sources = readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter(path => path.endsWith(".ts") && !path.endsWith(".test.ts"))
      .map(path => readFileSync(new URL(path, root), "utf8"));
    sources.push(readFileSync(new URL("../../wildstat-coop.ts", import.meta.url), "utf8"));
    expect(sources.filter(source => source.includes("local-item-refines"))).toEqual([]);
  });
});
