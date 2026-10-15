import { expect, it, vi } from "vitest";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { reportKills } from "../../tests/helpers/enemy-defeat";
import { GEM_KILL_CREDIT_PER_GEM } from "../../shared/gem-drops";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

// Only regular-enemy defeats earn kill gems. Bosses only unlock gates.
function killRegular(f: ReturnType<typeof crystalFixture>, sequence: bigint, autoFarm = false) {
  f.patch("playerProgress", { damage: 1e15, inventoryJson: '["starter_bow"]', equippedRightHand: "starter_bow" });
  reportKills(f, { streamId: "kill-gems-test-stream", sequence, mapId: "crystal_hollows", enemies: [{ enemy: "Shard Hopper", count: 1 }] },
    autoFarm ? server.reportAutoFarmEnemyDefeats : server.reportEnemyDefeats);
}

it("pays a gem for a hidden manual kill when its credit completes a block", () => {
  const f = crystalFixture();
  f.patch("player", { isVisible: false });
  f.seed("gemKillProgress", { identity: f.ctx.sender, credit: GEM_KILL_CREDIT_PER_GEM - 5n });
  killRegular(f, 1n);
  expect(f.db.playerGemWallet.identity.find(f.ctx.sender)?.balance).toBe(1n);
  expect(f.db.gemKillProgress.identity.find(f.ctx.sender)?.credit).toBe(0n);
  expect(f.db.playerGemDrop.identity.find(f.ctx.sender)).toMatchObject({ amount: 1, sequence: f.ctx.timestamp.microsSinceUnixEpoch });
  // The next kill starts the next block; no gem, no drop event.
  killRegular(f, 2n);
  expect(f.db.playerGemWallet.identity.find(f.ctx.sender)?.balance).toBe(1n);
  expect(f.db.gemKillProgress.identity.find(f.ctx.sender)?.credit).toBe(5n);
  expect(f.db.playerGemDrop.identity.find(f.ctx.sender)?.amount).toBe(1);
});

it("counts a visible manual kill the same as a hidden one", () => {
  const f = crystalFixture();
  f.patch("player", { isVisible: true });
  f.seed("gemKillProgress", { identity: f.ctx.sender, credit: GEM_KILL_CREDIT_PER_GEM - 5n });
  killRegular(f, 1n);
  expect(f.db.playerGemWallet.identity.find(f.ctx.sender)?.balance).toBe(1n);
  expect(f.db.gemKillProgress.identity.find(f.ctx.sender)?.credit).toBe(0n);
});

it("pays an Auto Farm report exactly what a manual report pays", () => {
  const manual = crystalFixture(); const farm = crystalFixture();
  killRegular(manual, 1n); killRegular(farm, 1n, true);
  expect(farm.db.gemKillProgress.identity.find(farm.ctx.sender)?.credit)
    .toBe(manual.db.gemKillProgress.identity.find(manual.ctx.sender)?.credit);
});

it("never pays twice for a replayed report", () => {
  const f = crystalFixture();
  f.patch("player", { isVisible: false });
  f.seed("gemKillProgress", { identity: f.ctx.sender, credit: GEM_KILL_CREDIT_PER_GEM - 5n });
  killRegular(f, 1n);
  // Same sequence again is rejected before rewards; the wallet is untouched.
  f.patch("playerProgress", { damage: 1e15, inventoryJson: '["starter_bow"]', equippedRightHand: "starter_bow" });
  reportKills(f, { streamId: "kill-gems-test-stream", sequence: 1n, mapId: "crystal_hollows", enemies: [{ enemy: "Shard Hopper", count: 1 }] });
  expect(f.db.playerGemWallet.identity.find(f.ctx.sender)?.balance).toBe(1n);
});

it("keeps one row a day of kills and gems instead of a ledger row per payout", () => {
  const f = crystalFixture();
  f.seed("gemKillProgress", { identity: f.ctx.sender, credit: GEM_KILL_CREDIT_PER_GEM - 5n });
  killRegular(f, 1n); killRegular(f, 2n);
  expect([...f.db.gemTransaction.iter()]).toHaveLength(0);
  const days = [...f.db.gemKillDaily.iter()];
  expect(days).toHaveLength(1);
  expect(days[0]).toMatchObject({ identity: f.ctx.sender, kills: 2n, gems: 1n });
});

it("preserves existing partial gem credit when the ledger unit changes", () => {
  const f = crystalFixture();
  f.seed("moduleMigrationState", { id: 0, version: 40 });
  f.seed("gemKillProgress", { identity: f.ctx.sender, credit: 1_999n });
  f.run(server.runMaintenance, { maintenance: {} });
  expect(f.db.gemKillProgress.identity.find(f.ctx.sender)?.credit).toBe(5_997n);
  f.run(server.runMaintenance, { maintenance: {} });
  expect(f.db.gemKillProgress.identity.find(f.ctx.sender)?.credit).toBe(5_997n);
});

it("refuses the retroactive grant, whose ledger is no longer kept", async () => {
  const { createKillGems } = await import("./kill-gems");
  const credit = vi.fn();
  expect(() => createKillGems({ creditGemsWithoutLedger: credit }).grantRetroactiveKillGems({})).toThrow(/already run/);
  expect(credit).not.toHaveBeenCalled();
});

it("clears the old kill-gem ledger rows a batch at a time and keeps everything else", async () => {
  const { identity } = await import("../../tests/helpers/crystal-hollows-fixture");
  const f = crystalFixture(), who = identity("3");
  const row = (id: bigint, kind: string, ref: string) => f.seed("gemTransaction",
    { id, identity: who, delta: 1n, balanceAfter: 1n, kind, note: "", externalReference: ref, createdAt: f.ctx.timestamp });
  for (let id = 1n; id <= 6_000n; id++) row(id, "enemy_kills", `kill-gems:${id}`);
  row(6_001n, "enemy_kills", "kill-gems:retro:abc");
  row(6_002n, "ad_reward", "ad:1");
  f.run(server.runMaintenance, { maintenance: {} });
  expect(f.db.gemLedgerTrim.id.find(0)).toMatchObject({ nextId: 5_000n, endId: 6_002n, done: false });
  expect([...f.db.gemTransaction.iter()]).toHaveLength(1_003);
  f.run(server.runMaintenance, { maintenance: {} });
  expect(f.db.gemLedgerTrim.id.find(0)?.done).toBe(true);
  expect([...f.db.gemTransaction.iter()].map(r => r.externalReference).sort()).toEqual(["ad:1", "kill-gems:retro:abc"]);
});
