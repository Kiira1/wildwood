import { existsSync } from "node:fs";
import { ConnectionId } from "spacetimedb";
import { describe, expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { CHAT_REPORT_REASONS } from "../../shared/chat-report";
import { CHAT_REPORT_LIMIT } from "./chat-report-rate-limit";
import { ATTACK_BALANCE_VERSION, SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../shared/rules";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

type Fixture = ReturnType<typeof crystalFixture>;
const REASON = CHAT_REPORT_REASONS[0].value;
const other = identity("2");

function fixture() {
  const f = crystalFixture();
  f.seed("playerProfile", { identity: other, displayName: "Other Player", skinTone: 3 });
  return f;
}
const blocks = (f: Fixture) => [...f.db.playerBlock.iter()].map((row: any) => [row.owner.toHexString(), row.target.toHexString(), row.targetName]);
const reports = (f: Fixture) => [...f.db.playerReport.iter()];
const loseControl = (f: Fixture) => f.patch("playerController", { connectionId: new ConnectionId(9n) });
const bindingFor = (table: string) => new URL(`../../src/module_bindings/${table}_table.ts`, import.meta.url);

describe("player safety", () => {
  it("keeps raw blocks, reports and moderation actions out of every client's reach", () => {
    // Only public tables get client bindings; a private table has none to subscribe with.
    for (const table of ["player_block", "player_report", "moderation_action"]) expect(existsSync(bindingFor(table)), table).toBe(false);
    expect(existsSync(bindingFor("my_player_blocks"))).toBe(true);
    const f = fixture();
    f.run(server.setPlayerBlocked, { target: other, blocked: true });
    f.seed("playerBlock", { key: "someone-else", owner: identity("3"), target: other, targetName: "Other Player" });
    const mine = (server.myPlayerBlocks as any)({ db: f.db, sender: f.ctx.sender });
    expect(mine.map((row: any) => row.owner.toHexString())).toEqual([f.ctx.sender.toHexString()]);
  });

  it("writes a block only for the controlling tab, as the sender, with the server's copy of the name", () => {
    const f = fixture();
    loseControl(f);
    expect(() => f.run(server.setPlayerBlocked, { target: other, blocked: true })).toThrow("active in another tab");
    expect(blocks(f)).toEqual([]);
    f.patch("playerController", { connectionId: f.ctx.connectionId });
    f.run(server.setPlayerBlocked, { target: other, blocked: true });
    expect(blocks(f)).toEqual([[f.ctx.sender.toHexString(), other.toHexString(), "Other Player"]]);
    expect(() => f.run(server.setPlayerBlocked, { target: f.ctx.sender, blocked: true })).toThrow("cannot block yourself");
  });

  it("files a report only for the controlling tab, once while pending, within the shared rate limit", () => {
    const f = fixture();
    loseControl(f);
    expect(() => f.run(server.reportPlayer, { target: other, reason: REASON, note: "" })).toThrow("active in another tab");
    f.patch("playerController", { connectionId: f.ctx.connectionId });
    expect(() => f.run(server.reportPlayer, { target: f.ctx.sender, reason: REASON, note: "" })).toThrow("cannot report yourself");
    f.run(server.reportPlayer, { target: other, reason: REASON, note: "  spam  " });
    expect(reports(f)).toMatchObject([{ reporter: f.ctx.sender, target: other, targetName: "Other Player", note: "spam", status: "pending" }]);
    expect(() => f.run(server.reportPlayer, { target: other, reason: REASON, note: "" })).toThrow("already have a pending report");
    for (let i = 1; i < CHAT_REPORT_LIMIT; i++) {
      const target = identity(String(3 + i));
      f.seed("playerProfile", { identity: target, displayName: `Player ${i}`, skinTone: 3 });
      f.run(server.reportPlayer, { target, reason: REASON, note: "" });
    }
    f.seed("playerProfile", { identity: identity("9"), displayName: "One Too Many", skinTone: 3 });
    expect(() => f.run(server.reportPlayer, { target: identity("9"), reason: REASON, note: "" })).toThrow("Report limit reached");
    // Chat reports draw on the same allowance.
    f.seed("chatMessage", { id: 77n, sender: other, senderName: "Other Player", text: "hi", sentAt: f.ctx.timestamp });
    expect(() => f.run(server.reportChatMessage, { messageId: 77n, reason: REASON })).toThrow("Report limit reached");
  });

  it("refuses a duel when either player has blocked the other, before any duel row exists", () => {
    for (const [owner, target] of [["1", "2"], ["2", "1"]]) {
      const f = fixture();
      f.seed("playerBlock", { key: `${identity(owner).toHexString()}:${identity(target).toHexString()}`, owner: identity(owner), target: identity(target), targetName: "x" });
      expect(() => f.run(server.requestDuel, { opponent: other })).toThrow("Duel unavailable");
      expect([...f.db.duel.iter()]).toEqual([]);
    }
  });

  it("moves a guest's blocks, both ways, to the account it links into", () => {
    const f = fixture();
    const guest = identity("5");
    f.db.playerProgress.identity.delete(f.ctx.sender);
    f.progress(guest);
    f.seed("playerBalanceVersion", { identity: guest, version: ATTACK_BALANCE_VERSION });
    f.seed("playerBlock", { key: "g-blocks", owner: guest, target: other, targetName: "Other Player" });
    f.seed("playerBlock", { key: "blocks-g", owner: other, target: guest, targetName: "Guest" });
    f.seed("accountLink", { code: "safety-link", guest, createdAt: f.ctx.timestamp });
    f.ctx.senderAuth = { jwt: { issuer: SPACETIME_AUTH_ISSUER, audience: [SPACETIME_AUTH_CLIENT_ID] } };
    f.run(server.claimGuestAccount, { code: "safety-link" });
    const pairs = blocks(f).map(([owner, target]) => [owner, target]).sort();
    expect(pairs).toEqual([[f.ctx.sender.toHexString(), other.toHexString()], [other.toHexString(), f.ctx.sender.toHexString()]].sort());
  });
});
