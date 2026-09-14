import { duelAnnouncementText } from "../../shared/duel-announcement";

/** Repair retained display snapshots by account identity, never by a text search
 * through player-authored messages. Called on rename, not on the game tick. */
export function syncDisplayNameHistory(ctx: any, identity: any, displayName: string) {
  const hex = identity.toHexString().replace(/^0x/, "").toLowerCase();
  const matches = (value: string) => value?.replace(/^0x/, "").toLowerCase() === hex;
  const announcements = new Map<bigint, string>();
  for (const replay of [...ctx.db.duelReplay.iter()] as any[]) {
    const challenger = matches(replay.challengerIdentity);
    const opponent = matches(replay.opponentIdentity);
    if (!challenger && !opponent) continue;
    const outcome = replay.winnerName === "DRAW" ? "DRAW"
      : replay.winnerName === replay.challengerName ? "CHALLENGER_WIN" : "OPPONENT_WIN";
    const challengerName = challenger ? displayName : replay.challengerName;
    const opponentName = opponent ? displayName : replay.opponentName;
    const winnerName = outcome === "DRAW" ? "DRAW"
      : outcome === "CHALLENGER_WIN" ? challengerName : opponentName;
    if (challengerName !== replay.challengerName || opponentName !== replay.opponentName || winnerName !== replay.winnerName) {
      ctx.db.duelReplay.id.update({ ...replay, challengerName, opponentName, winnerName });
    }
    announcements.set(replay.id, duelAnnouncementText(challengerName, opponentName, outcome));
  }
  const changedMessages = new Map<bigint, any>();
  for (const message of [...ctx.db.chatMessage.iter()] as any[]) {
    const senderName = matches(message.sender.toHexString()) ? displayName : message.senderName;
    // A previous moderation decision must never be undone by renaming.
    const text = !message.moderated ? announcements.get(message.replayId) ?? message.message : message.message;
    if (senderName === message.senderName && text === message.message) continue;
    const next = { ...message, senderName, message: text };
    ctx.db.chatMessage.id.update(next);
    changedMessages.set(message.id, next);
  }
  for (const reply of [...ctx.db.chatMessage.iter()] as any[]) {
    const original = changedMessages.get(reply.replyToMessageId);
    if (original) ctx.db.chatMessage.id.update({ ...reply,
      replyToSenderName: original.senderName, replyToMessage: original.message });
  }
}
