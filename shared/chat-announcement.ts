/**
 * Chat lines the server marks as its own announcements (the chat_announcement
 * table). The mark lives in its own table that no player reducer writes, so
 * typing the same words never makes a banner.
 */
export const CHAT_ANNOUNCEMENT_KINDS = ["server-boost", "patreon"] as const;
export type ChatAnnouncementKind = typeof CHAT_ANNOUNCEMENT_KINDS[number];

export function chatAnnouncementKind(kind: string | undefined): ChatAnnouncementKind | null {
  return (CHAT_ANNOUNCEMENT_KINDS as readonly string[]).includes(kind ?? "") ? kind as ChatAnnouncementKind : null;
}
