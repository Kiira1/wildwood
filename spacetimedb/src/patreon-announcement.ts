import type { Identity } from "spacetimedb";
import type { ModuleReducerCtx } from "./index";
import type { AvatarFrame } from "../../shared/avatar-frames";
import { updatePublicChatCursor } from "./public-chat-history";

/** Persistent receipt prevents renewals, retries, or unlink/relink from spamming chat. */
export function announcePatreonSupport(ctx: ModuleReducerCtx, identity: Identity, userId: string, tier: AvatarFrame) {
  if (tier === "none") return;
  const previous = ctx.db.patreonAnnouncement.userId.find(userId);
  if (previous?.goldAnnounced || tier === "silver" && previous?.silverAnnounced) return;
  const profile = ctx.db.playerProfile.identity.find(identity);
  if (!profile) return;
  const inserted = ctx.db.chatMessage.insert({
    id: 0n, sender: identity, senderName: profile.displayName,
    senderIsGuest: ctx.db.playerAccountStatus.identity.find(identity)?.isGuest ?? false,
    message: `Became a ${tier === "gold" ? "Gold" : "Silver"} supporter on Patreon. Thank you for supporting WildStat! ♥`,
    sentAt: ctx.timestamp, replayId: 0n, powerLevel: 0, senderGender: profile.gender ?? 0,
    moderated: false, replyToMessageId: 0n, replyToSenderName: "", replyToMessage: "", guildReplayKey: "",
  });
  updatePublicChatCursor(ctx, inserted.id);
  const receipt = { userId, identity, silverAnnounced: true, goldAnnounced: tier === "gold",
    messageId: inserted.id, announcedAtMs: Number(ctx.timestamp.microsSinceUnixEpoch / 1000n) };
  if (previous) ctx.db.patreonAnnouncement.userId.update(receipt);
  else ctx.db.patreonAnnouncement.insert(receipt);
}
