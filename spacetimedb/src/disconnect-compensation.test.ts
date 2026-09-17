import { expect, it, vi } from "vitest";
vi.mock("spacetimedb/server", () => ({ SenderError: class SenderError extends Error {} }));
import { deliverDisconnectCompensation, deliverCombatUpdateGift, deliverOutageCompensation, announceOutageCompensation, deliverAutofarmTestGift } from "./disconnect-compensation";
const player = { toHexString: () => "player" };
function setup() {
  const receipts = new Map(); const notices = new Map();
  const ctx: any = { timestamp: {}, db: {
    playerProgress: { identity: { find: () => ({}) } }, virtualPlayer: { identity: { find: () => null } },
    gemTransaction: { externalReference: { find: (key: string) => receipts.get(key) } },
    balanceApologyNotice: { identity: { find: (id: any) => notices.get(id), update: (row: any) => notices.set(row.identity, row) }, insert: (row: any) => notices.set(row.identity, row) },
  } };
  const credit = vi.fn((input: any) => { receipts.set(input.externalReference, input); });
  return { ctx, credit, receipts, notices, deliver: (recipients: any[] = [player]) => deliverDisconnectCompensation(ctx, recipients, credit) };
}
it("credits a guest or registered character exactly once even after notice dismissal", () => {
  const s = setup(); s.deliver([player, player]); s.notices.clear(); s.deliver();
  expect(s.credit).toHaveBeenCalledOnce(); expect(s.credit.mock.calls[0][0].delta).toBe(20n); expect(s.notices.size).toBe(0);
});
it("preserves an existing unacknowledged gift while adding compensation", () => {
  const s = setup(); s.notices.set(player, { identity: player, amount: 10n }); s.deliver();
  expect(s.notices.get(player).amount).toBe(30n); expect(s.credit.mock.calls[0][0].delta).toBe(20n);
});
it("skips deleted characters and virtual players", () => {
  const s = setup(); s.ctx.db.playerProgress.identity.find = () => null; s.deliver();
  s.ctx.db.playerProgress.identity.find = () => ({}); s.ctx.db.virtualPlayer.identity.find = () => ({}); s.deliver();
  expect(s.credit).not.toHaveBeenCalled();
});
it("bounds delivery batches before awarding any gems", () => {
  const s = setup(); expect(() => s.deliver(Array(101).fill(player))).toThrow("at most 100"); expect(s.credit).not.toHaveBeenCalled();
});

it("credits the autofarm test gift as 15 gems exactly once and preserves older notices", () => {
  const s = setup(); s.deliver();
  deliverAutofarmTestGift(s.ctx, [player, player] as any, s.credit);
  expect(s.credit.mock.calls.at(-1)?.[0]).toMatchObject({ delta: 15n, kind: "autofarm_test_gift" });
  expect(s.notices.get(player).amount).toBe(35n);
  s.notices.clear(); deliverAutofarmTestGift(s.ctx, [player] as any, s.credit);
  expect(s.credit).toHaveBeenCalledTimes(2); expect(s.notices.size).toBe(0);
});

it("credits the combat update separately from the disconnect gift, exactly once", () => {
  const s = setup(); s.deliver();
  deliverCombatUpdateGift(s.ctx, [player, player] as any, s.credit);
  expect(s.credit).toHaveBeenCalledTimes(2);
  expect(s.credit.mock.calls[1][0]).toMatchObject({ delta: 20n, kind: "combat_update_gift", externalReference: "combat-update:0.695:player" });
  expect(s.notices.get(player).amount).toBe(40n);
  s.notices.clear(); deliverCombatUpdateGift(s.ctx, [player] as any, s.credit);
  expect(s.credit).toHaveBeenCalledTimes(2); expect(s.notices.size).toBe(0);
});

it("credits the outage gift as exactly 10 gems once, independently of older campaigns", () => {
  const s = setup(); s.deliver();
  deliverOutageCompensation(s.ctx, [player, player] as any, s.credit);
  expect(s.credit.mock.calls.at(-1)?.[0]).toMatchObject({ delta: 10n, kind: "outage_compensation" });
  expect(s.notices.get(player).amount).toBe(30n);
  s.notices.clear(); deliverOutageCompensation(s.ctx, [player] as any, s.credit);
  expect(s.credit).toHaveBeenCalledTimes(2); expect(s.notices.size).toBe(0);
});
it("announces once without changing any balance", () => {
  const s = setup(), announce = vi.fn();
  s.ctx.sender = player;
  s.ctx.db.playerGemWallet = { identity: { find: () => ({ balance: 55n }) } };
  s.ctx.db.gemTransaction.insert = (row: any) => { s.receipts.set(row.externalReference, row); };
  announceOutageCompensation(s.ctx, announce); announceOutageCompensation(s.ctx, announce);
  expect(announce).toHaveBeenCalledOnce(); expect(s.credit).not.toHaveBeenCalled();
  expect([...s.receipts.values()][0]).toMatchObject({ delta: 0n, balanceAfter: 55n });
});
