import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "spacetimedb";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { ATTACK_BALANCE_VERSION, BOSS_REWARD_CLAIM_BITS, SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
import { TOWN_FEET_OFFSET } from "../../shared/town";
import { MINING_NODES } from "../../shared/mining";
import { WOOD_TREE_NODES } from "../../shared/woodcutting";
import { nodeBareFor } from "./mining";
import { treeFelledFor } from "./woodcutting";
import { researchForPlayer } from "./research-runtime";
import { researchRankKey } from "./research-rank";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const copper = MINING_NODES.find(node => node.ore === "copper_ore" && node.kind === "small")!;
const pine = WOOD_TREE_NODES.find(node => node.kind === "pine")!;
const CAMPAIGN_COMPLETE = BOSS_REWARD_CLAIM_BITS.aegisPrime;

type Fixture = ReturnType<typeof crystalFixture>;
const respawnRank = (f: Fixture, rank: number, who = f.ctx.sender) =>
  f.seed("playerResearchRank", { key: researchRankKey(who, "resourceRespawn"), identity: who, researchId: "resourceRespawn", rank });
const rankRows = (f: Fixture, who = f.ctx.sender) => [...f.db.playerResearchRank.identity.filter(who)];

/** A player in the Town; times are seconds on the server's clock. */
function gatherer(rank = 0) {
  const f = crystalFixture();
  if (rank) respawnRank(f, rank);
  const nowS = () => Number(f.ctx.timestamp.microsSinceUnixEpoch) / 1_000_000;
  const later = (seconds: number) => { f.ctx.timestamp = new Timestamp(f.ctx.timestamp.microsSinceUnixEpoch + BigInt(Math.round(seconds * 1_000_000))); };
  const standAt = (at: { x: number; y: number }) => f.patch("player", { mapId: "town", x: at.x, y: at.y - TOWN_FEET_OFFSET });
  const atMs = (seconds: number) => BigInt(Math.round(seconds * 1_000));
  const reportMining = (at: number) => f.run(server.reportMining, { breaks: [{ nodeId: copper.id, atMs: atMs(at) }] });
  const reportChopping = (at: number) => f.run(server.reportChopping, { chops: [{ treeId: pine.id, atMs: atMs(at) }] });
  const rocks = () => f.db.playerMining.identity.find(f.ctx.sender)?.rocksBroken ?? 0;
  const trees = () => f.db.playerWoodcutting.identity.find(f.ctx.sender)?.treesChopped ?? 0;
  later(300);
  return { ...f, nowS, later, standAt, reportMining, reportChopping, rocks, trees };
}

describe("Resource Respawn research", () => {
  it("researches into player_research_rank, one row, leaving player_research's columns alone", () => {
    const f = crystalFixture();
    f.seed("playerLuckResearch", { identity: f.ctx.sender, cardLuck: 1, gearLuck: 0, miningLuck: 0, skillLuck: 0, refineLuck: 0 });
    f.run(server.startResearch, { researchId: "resourceRespawn" });
    f.ctx.timestamp = f.db.activeResearch.identity.find(f.ctx.sender).completesAt;
    f.run(server.completeResearch, { schedule: [...f.db.researchCompletionSchedule.iter()][0] });
    expect(rankRows(f)).toEqual([expect.objectContaining({ researchId: "resourceRespawn", rank: 1 })]);
    expect(f.db.playerResearch.identity.find(f.ctx.sender)).not.toHaveProperty("resourceRespawn");
    expect(f.transaction(() => researchForPlayer(f.ctx, f.ctx.sender)).resourceRespawn).toBe(1);
  });

  it("needs Card Luck or Gold Luck first", () => {
    const f = crystalFixture();
    expect(() => f.run(server.startResearch, { researchId: "resourceRespawn" })).toThrow("Research prerequisites not met.");
  });

  it("takes a rock back sooner in a mining report: 45s for a small rock at rank 5, still refused before", () => {
    for (const [rank, accepted] of [[0, 1], [5, 2]] as const) {
      const f = gatherer(rank);
      f.standAt(copper);
      f.reportMining(f.nowS() - 50);
      f.reportMining(f.nowS() - 1);
      expect(f.rocks()).toBe(accepted);
    }
    const f = gatherer(5);
    f.standAt(copper);
    f.reportMining(f.nowS() - 40);
    // Grown back 5s from now: still bare.
    f.reportMining(f.nowS() - 1);
    expect(f.rocks()).toBe(1);
  });

  it("takes a tree back sooner in a chopping report: 90s at rank 5, still refused before", () => {
    for (const [rank, accepted] of [[0, 1], [5, 2]] as const) {
      const f = gatherer(rank);
      f.standAt(pine);
      f.reportChopping(f.nowS() - 89);
      f.later(5);
      f.reportChopping(f.nowS() - 1);
      expect(f.trees()).toBe(accepted);
    }
    const f = gatherer(5);
    f.standAt(pine);
    f.reportChopping(f.nowS() - 80);
    f.reportChopping(f.nowS() - 1);
    expect(f.trees()).toBe(1);
  });

  it("shortens the one-break reducers' regrowth too", () => {
    const f = gatherer(5);
    f.standAt(copper);
    f.run(server.mineNode, { nodeId: copper.id });
    f.later(44);
    expect(nodeBareFor(f.ctx, f.ctx.sender, copper)).toBe(true);
    f.later(1);
    expect(nodeBareFor(f.ctx, f.ctx.sender, copper)).toBe(false);
    f.standAt(pine);
    f.run(server.chopTree, { treeId: pine.id });
    f.later(89);
    expect(treeFelledFor(f.ctx, f.ctx.sender, pine.id)).toBe(true);
    f.later(1);
    expect(treeFelledFor(f.ctx, f.ctx.sender, pine.id)).toBe(false);
  });

  it("stays through a prestige, goes with a plain reset", () => {
    const prestiged = crystalFixture();
    respawnRank(prestiged, 3);
    prestiged.patch("playerProgress", { bossRewardClaims: CAMPAIGN_COMPLETE });
    prestiged.run(server.prestigeAccount, {});
    expect(rankRows(prestiged)).toEqual([expect.objectContaining({ rank: 3 })]);

    const wiped = crystalFixture();
    respawnRank(wiped, 3);
    wiped.run(server.resetPlayerProgress, {});
    expect(rankRows(wiped)).toEqual([]);
  });

  it("moves a guest's rank to the account it links to", () => {
    const f = crystalFixture();
    const guest = identity("2");
    f.seed("playerResearch", { identity: guest, frontierMastery: 0, inventorySlots: 2 });
    respawnRank(f, 4, guest);
    f.db.playerProgress.identity.delete(f.ctx.sender);
    f.progress(guest);
    f.seed("playerBalanceVersion", { identity: guest, version: ATTACK_BALANCE_VERSION });
    f.seed("accountLink", { code: "respawn-link", guest, createdAt: f.ctx.timestamp });
    f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
    f.run(server.claimGuestAccount, { code: "respawn-link" });
    expect(rankRows(f)).toEqual([expect.objectContaining({ key: researchRankKey(f.ctx.sender, "resourceRespawn"), rank: 4 })]);
    expect(rankRows(f, guest)).toEqual([]);
  });
});
