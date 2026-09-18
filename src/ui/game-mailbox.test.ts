import { expect, it, vi } from "vitest";
import { createGameMailbox } from "./game-mailbox";
const controller = vi.hoisted(() => vi.fn());
vi.mock("./mailbox-controller", () => ({ createMailboxController: controller }));
it("routes daily, pending legacy and future developer gifts into mail with their existing claim actions", async () => {
  const daily = vi.fn(async () => ({ ok: true }));
  const acknowledge = vi.fn(async () => ({ ok: true }));
  const claim = vi.fn(async () => ({ ok: true }));
  const future = { id: "next-gift", title: "Thank you", body: "Thanks everyone!", gems: 20n, read: false, claimed: false, createdAtMs: 1 };
  const coop = { localIdentity: () => "me", isConnected: () => true, accountState: () => ({ signedIn: true }),
    mailboxMessages: () => [future], dailyGemBonusClaimable: () => true, balanceApologyGiftAmount: () => 15n,
    claimDailyGemBonus: daily, acknowledgeBalanceApologyGift: acknowledge, claimMailboxGift: claim };
  createGameMailbox({} as never, {} as never, coop as never, () => true);
  const hooks = controller.mock.calls.at(-1)![2];
  const messages = hooks.messages();
  expect(messages).toHaveLength(3);
  expect(messages[0]).toEqual(future);
  expect(messages[1].gems).toBe(7n);
  expect(messages[2]).toMatchObject({ gems: 0n, rewardLabel: "15 gems · Already received" });
  await messages[1].action(); await messages[2].action(); await hooks.claim("next-gift");
  expect(daily).toHaveBeenCalledOnce(); expect(acknowledge).toHaveBeenCalledOnce();
  expect(claim).toHaveBeenCalledExactlyOnceWith("next-gift");
});
