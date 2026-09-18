import type { wildstatCoop } from "../wildstat-coop";
import { recentReleaseNotes } from "../app/changelog";
import { createMailboxController, type MailboxCard } from "./mailbox-controller";

/** Bridges legacy already-credited gifts and daily claims into the same inbox. */
export function createGameMailbox(button: HTMLButtonElement, versionButton: HTMLElement,
  coop: typeof wildstatCoop | null | undefined, canOpen: () => boolean) {
  return createMailboxController(button, versionButton, {
    canOpen,
    identity: () => coop?.localIdentity?.() ?? "",
    connected: () => Boolean(coop?.isConnected?.()) && !coop?.accountState?.().sessionConflict,
    releases: () => recentReleaseNotes(8),
    read: async id => coop?.readMailboxLetter?.(id),
    claim: async id => coop?.claimMailboxGift?.(id),
    messages: () => {
      const rows: MailboxCard[] = [...(coop?.mailboxMessages?.() ?? [])];
      if (coop?.dailyGemBonusClaimable?.() && coop?.accountState?.().signedIn) rows.push({
        id: `daily:${Math.floor(Date.now() / 86_400_000)}`, title: "Your daily gems", gems: 7n,
        body: "Welcome back! Here's your daily gift. Thanks for playing WildStat.",
        read: false, claimed: false, createdAtMs: 0, action: async () => coop.claimDailyGemBonus(),
      });
      const amount = coop?.balanceApologyGiftAmount?.() ?? 0n;
      if (amount > 0n) rows.push({
        id: "legacy-developer-gift", title: "A gift from the developer", gems: 0n,
        body: `Thank you for testing WildStat. ${amount} gems have already been added to your balance.`,
        rewardLabel: `${amount} gems · Already received`, actionLabel: "Got it",
        read: false, claimed: false, createdAtMs: 0, action: async () => coop?.acknowledgeBalanceApologyGift?.(),
      });
      return rows;
    },
  });
}
