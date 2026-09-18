import { expect, it, vi } from "vitest";
import { createDeveloperService } from "./developer-service";
import { DEVELOPER_IDENTITY } from "../../../shared/developer-identity";
function fixture() {
  const order: string[] = [];
  const drain = vi.fn(async () => { order.push("saved"); return true; });
  const teleport = vi.fn(async () => { order.push("teleported"); return JSON.stringify({ mapId: "moonfen", x: 100, y: 200, facing: 0 }); });
  let owner = DEVELOPER_IDENTITY;
  const connection = { procedures: { devTeleportToPlayer: teleport } };
  const service = createDeveloperService({ reducers: { connection: () => connection, protocolBlocked: () => false } as any,
    notify: vi.fn(), localIdentity: () => owner, localDbIdentity: () => null, profileIdentityFor: () => undefined, drainPendingProgress: drain });
  return { service, drain, teleport, order, revoke: () => { owner = "guest"; } };
}
it("saves pending rewards before moving", async () => {
  const f = fixture(); await f.service.api.devTeleportToPlayer("1".repeat(64), "moonfen");
  expect(f.order).toEqual(["saved", "teleported"]);
});
it("does not travel when saving fails or the account changes during saving", async () => {
  const f = fixture(); f.drain.mockResolvedValueOnce(false);
  await expect(f.service.api.devTeleportToPlayer("1".repeat(64), "moonfen")).rejects.toThrow(/syncing/);
  f.drain.mockImplementationOnce(async () => { f.revoke(); return true; });
  await expect(f.service.api.devTeleportToPlayer("1".repeat(64), "moonfen")).rejects.toThrow(/Connection changed/);
  expect(f.teleport).not.toHaveBeenCalled();
});
