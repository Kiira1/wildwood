import { expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { syncDuelWireAccess } from "./duel-wire-access";
import { COMPATIBLE_PROTOCOL_VERSIONS } from "../../shared/rules";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("allows 104 gameplay while keeping unsafe earlier protocols blocked", () => {
  expect(COMPATIBLE_PROTOCOL_VERSIONS).toContain(104);
  expect(COMPATIBLE_PROTOCOL_VERSIONS).toContain(105);
  expect(COMPATIBLE_PROTOCOL_VERSIONS).not.toContain(103);
});
it("grants all recorded duel formats only to current clients and revokes on old-client registration", () => {
  const f = crystalFixture();
  syncDuelWireAccess(f.ctx, 104);
  expect([...f.db.duelWireAccess.iter()]).toHaveLength(0);
  syncDuelWireAccess(f.ctx, 105);
  expect([...f.db.duelWireAccess.iter()].map((r: any) => r.combatVersion)).toEqual([0, 1, 2]);
  syncDuelWireAccess(f.ctx, 105);
  expect([...f.db.duelWireAccess.iter()]).toHaveLength(3);
  syncDuelWireAccess(f.ctx, 104);
  expect([...f.db.duelWireAccess.iter()]).toHaveLength(0);
});
it("does not start a new-format duel against an older player", () => {
  const f = crystalFixture(), opponent = identity("b");
  f.seed("player", { ...f.db.player.identity.find(f.ctx.sender), identity: opponent, protocolVersion: 104 });
  expect(() => f.run(server.requestDuel, { opponent })).toThrow("0.709");
  expect([...f.db.duel.iter()]).toHaveLength(0);
});
