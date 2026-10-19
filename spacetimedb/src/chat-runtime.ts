// Chat messages and history retention: inserting a message, sending one with
// its cooldown and mute checks, and the expiry sweeps for chat, duel replays
// and startup telemetry. Moved out of index.ts unchanged; the chat reducers
// stay there.
import type { ModuleReducerCtx } from "./index";
import { readPlayerProgress, deleteReplayWide } from "./wide-stats";
import { narrowPower } from "../../shared/wide-stats";
import { effectivePowerForProgress } from "./player-power";
import { PLAYER_GENDER_UNSET } from "../../shared/player-gender";
import { updatePublicChatCursor } from "./public-chat-history";
import { removeMessageReactions } from "./chat-reactions";
import { pruneExpiredSocialMessages } from "./social-service";
import { startupTelemetryIdsToDelete, STARTUP_TELEMETRY_MAX_ROWS, STARTUP_TELEMETRY_RATE_WINDOW_MICROS } from "./startup-telemetry-policy";
import { Identity } from "spacetimedb";
import { requireChatAge, requireControllingPlayer } from "./session-guards";
import { SenderError } from "spacetimedb/server";
import { assertChatNotMuted, recordChatStrike } from "./chat-mute";
import { PROTOCOL_VERSION } from "../../shared/rules";
import { moderatePublicChatMessage, chatModerationReason, MODERATION_RULE_VERSION } from "./chat-moderation";
import { recordModerationAction } from "./moderation-history";

export const CHAT_MESSAGE_MAX_LENGTH = 250;

export const CHAT_COOLDOWN_MICROS = 3_000_000n;

export const CHAT_HISTORY_RETENTION_MICROS = 86_400_000_000n;

export const DUEL_REPLAY_RETENTION_MICROS = CHAT_HISTORY_RETENTION_MICROS;

export function insertChatMessage(
  ctx: any,
  sender: any,
  senderName: string,
  message: string,
  replayId = 0n,
  moderated = false,
  reply?: { messageId: bigint; senderName: string; message: string },
  guildReplayKey = "",
) {
  const progress = readPlayerProgress(ctx, sender);
  const profile = ctx.db.playerProfile.identity.find(sender);
  const inserted = ctx.db.chatMessage.insert({
    id: 0n,
    sender,
    senderName,
    senderIsGuest: ctx.db.playerAccountStatus.identity.find(sender)?.isGuest ?? false,
    message,
    replayId,
    sentAt: ctx.timestamp,
    powerLevel: progress ? narrowPower(effectivePowerForProgress(ctx, progress)) : 0,
    senderGender: profile?.gender ?? PLAYER_GENDER_UNSET,
    moderated,
    replyToMessageId: reply?.messageId ?? 0n,
    replyToSenderName: reply?.senderName ?? "",
    replyToMessage: reply?.message ?? "",
    guildReplayKey,
  });
  updatePublicChatCursor(ctx, inserted.id);
  return inserted;
}

export function clearExpiredHistory(ctx: any) {
  const chatCutoff = ctx.timestamp.microsSinceUnixEpoch - CHAT_HISTORY_RETENTION_MICROS;
  const replayCutoff = ctx.timestamp.microsSinceUnixEpoch - DUEL_REPLAY_RETENTION_MICROS;
  const staleMessageIds: bigint[] = [];
  const staleReplayIds: bigint[] = [];

  // Identifiers rise with time, so the expired messages are the oldest ones.
  // Walking up from the cursor stops at the first survivor instead of reading
  // the whole day, and it leaves the cursor correct without a second pass.
  const cursor = ctx.db.publicChatCursor.id.find(0);
  let firstLiveId = 0n;
  if (cursor?.firstId) {
    for (let id = cursor.firstId; id <= cursor.lastId; id++) {
      const message = ctx.db.chatMessage.id.find(id) as any;
      if (!message) continue;
      if (message.sentAt.microsSinceUnixEpoch >= chatCutoff) { firstLiveId = id; break; }
      staleMessageIds.push(id);
    }
  } else {
    for (const message of ctx.db.chatMessage.iter() as Iterable<any>) {
      if (message.sentAt.microsSinceUnixEpoch < chatCutoff) staleMessageIds.push(message.id);
    }
  }
  for (const replay of ctx.db.duelReplay.iter() as Iterable<any>) {
    if (replay.createdAt.microsSinceUnixEpoch < replayCutoff) staleReplayIds.push(replay.id);
  }

  for (const id of staleMessageIds) { removeMessageReactions(ctx, "public", id); ctx.db.chatMessage.id.delete(id); }
  for (const id of staleReplayIds) { ctx.db.duelReplay.id.delete(id); ctx.db.duelCombatSnapshot.duelId.delete(id); ctx.db.duelStaffSkill?.duelId.delete(id); deleteReplayWide(ctx, id); }
  pruneExpiredSocialMessages(ctx, ctx.timestamp.microsSinceUnixEpoch);
  if (cursor?.firstId) ctx.db.publicChatCursor.id.update({ ...cursor, firstId: firstLiveId });
  else updatePublicChatCursor(ctx);
}

export function trimStartupTelemetry(ctx: ModuleReducerCtx) {
  const rows = [...ctx.db.startupTelemetryEvent.iter()]
    .map((row) => ({ id: row.id, recordedAtMicros: row.recordedAt.microsSinceUnixEpoch }));
  for (const id of startupTelemetryIdsToDelete(
    rows,
    ctx.timestamp.microsSinceUnixEpoch,
    STARTUP_TELEMETRY_MAX_ROWS,
  )) {
    ctx.db.startupTelemetryEvent.id.delete(id);
  }
}

export function clearExpiredStartupTelemetryRateLimits(ctx: ModuleReducerCtx) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const expiredSenders: Identity[] = [];
  for (const rate of ctx.db.startupTelemetryRateLimit.iter()) {
    const startedAt = rate.windowStartedAt.microsSinceUnixEpoch;
    if (now < startedAt || now - startedAt >= STARTUP_TELEMETRY_RATE_WINDOW_MICROS) {
      expiredSenders.push(rate.sender);
    }
  }
  for (const sender of expiredSenders) ctx.db.startupTelemetryRateLimit.sender.delete(sender);
}

export function sendPlayerChatMessage(ctx: ModuleReducerCtx, message: string, replyToMessageId = 0n) {
  requireControllingPlayer(ctx);
  requireChatAge(ctx);
  const profile = ctx.db.playerProfile.identity.find(ctx.sender);
  if (!profile) return;

  const normalized = message.trim();
  if (!normalized) return;
  if (normalized.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new SenderError("Chat message is too long");
  }

  const bugCommand = /^\/bug(?:\s|$)/i.exec(normalized);
  const bugReportText = bugCommand ? normalized.slice(bugCommand[0].length).trim() : "";
  if (bugCommand && !bugReportText) throw new SenderError("Use /bug followed by a description.");
  if (!bugCommand) assertChatNotMuted(ctx);

  let reply: { messageId: bigint; senderName: string; message: string } | undefined;
  if (!bugCommand && replyToMessageId > 0n) {
    const target = ctx.db.chatMessage.id.find(replyToMessageId);
    if (!target) throw new SenderError("The message you replied to is no longer available.");
    if (!target.senderName) throw new SenderError("This message cannot be replied to.");
    reply = {
      messageId: target.id,
      senderName: target.senderName,
      message: target.message,
    };
  }

  const cooldown = ctx.db.chatCooldown.identity.find(ctx.sender);
  if (cooldown && ctx.timestamp.microsSinceUnixEpoch - cooldown.lastSentAt.microsSinceUnixEpoch < CHAT_COOLDOWN_MICROS) {
    const elapsed = ctx.timestamp.microsSinceUnixEpoch - cooldown.lastSentAt.microsSinceUnixEpoch;
    const remainingSeconds = Math.max(1, Math.ceil(Number(CHAT_COOLDOWN_MICROS - elapsed) / 1_000_000));
    throw new SenderError(`Wait ${remainingSeconds} seconds before sending another chat message.`);
  }
  if (cooldown) ctx.db.chatCooldown.identity.update({ ...cooldown, lastSentAt: ctx.timestamp });
  else ctx.db.chatCooldown.insert({ identity: ctx.sender, lastSentAt: ctx.timestamp });
  if (bugCommand) {
    ctx.db.bugReport.insert({
      id: 0n,
      reporter: ctx.sender,
      reporterName: profile.displayName,
      message: bugReportText,
      protocolVersion: PROTOCOL_VERSION,
      reportedAt: ctx.timestamp,
    });
    return;
  }

  const moderatedMessage = moderatePublicChatMessage(normalized);
  const inserted = insertChatMessage(
    ctx,
    ctx.sender,
    profile.displayName,
    moderatedMessage.message,
    0n,
    moderatedMessage.moderated,
    reply,
  );
  if (moderatedMessage.moderated) recordModerationAction(ctx, {
    targetIdentity: ctx.sender.toHexString(), targetName: profile.displayName, channel: "world", messageId: inserted.id,
    action: "Message filtered", reason: chatModerationReason(normalized) ?? "Disallowed content",
    actorType: "automatic", rule: MODERATION_RULE_VERSION, before: normalized, after: moderatedMessage.message,
  });
  if (moderatedMessage.moderated) recordChatStrike(ctx, "world", profile.displayName);
}
