import { Timestamp } from "spacetimedb";
import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { ensureDailyGemBonusState } from "./gem-wallet";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("gives a guest the daily gems too, once a day", () => {
  const f = crystalFixture();
  // The fixture's player signed in with no SpacetimeAuth account: a guest.
  expect(f.ctx.senderAuth.jwt).toBeUndefined();
  ensureDailyGemBonusState(f.ctx, f.ctx.sender);
  const before = f.db.playerGemWallet.identity.find(f.ctx.sender)?.balance ?? 0n;
  f.run(server.claimDailyGemBonus, {});
  expect(f.db.playerGemWallet.identity.find(f.ctx.sender).balance).toBe(before + 7n);
  expect(() => f.run(server.claimDailyGemBonus, {})).toThrow("already claimed");
  // The next day's are there to claim.
  f.ctx.timestamp = new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + 86_400_000_000n);
  ensureDailyGemBonusState(f.ctx, f.ctx.sender);
  f.run(server.claimDailyGemBonus, {});
  expect(f.db.playerGemWallet.identity.find(f.ctx.sender).balance).toBe(before + 14n);
});
