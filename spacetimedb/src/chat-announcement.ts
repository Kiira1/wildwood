// Server announcements in public chat (shared/chat-announcement.ts). Only the
// server's own announcement code inserts here; the chat reducers never do.
import { table, t } from "spacetimedb/server";
import type { ChatAnnouncementKind } from "../../shared/chat-announcement";

export const chatAnnouncementTables = {
  /** Which chat messages are announcements. A few rows a day, dropped with their message. */
  chatAnnouncement: table({ name: "chat_announcement", public: true }, {
    messageId: t.u64().primaryKey(), kind: t.string(),
  }),
};

type Ctx = any;

export function markChatAnnouncement(ctx: Ctx, messageId: bigint, kind: ChatAnnouncementKind) {
  ctx.db.chatAnnouncement.insert({ messageId, kind });
}

export function unmarkChatAnnouncement(ctx: Ctx, messageId: bigint) {
  ctx.db.chatAnnouncement.messageId.delete(messageId);
}
