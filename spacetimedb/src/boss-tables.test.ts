import { expect, it, vi } from "vitest";
import { server } from "../../tests/helpers/crystal-hollows-fixture";
import { LEGACY_BOSS_KEYS } from "./boss-tables";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("lists exactly the shared-boss table sets in the schema", () => {
  const tables = Object.keys((server.default as any).schemaType.tables);
  // A boss set is the four tables <boss>Boss, Contribution, AttackWindow and Result.
  const sets = tables.filter(name => name.endsWith("AttackWindow")).map(name => name.slice(0, -"AttackWindow".length))
    .filter(boss => ["Boss", "Contribution", "Result"].every(part => tables.includes(`${boss}${part}`)));
  expect([...LEGACY_BOSS_KEYS].sort()).toEqual(sets.sort());
});
