import type { ChatAnnouncementKind } from "../../shared/chat-announcement";
import { formatChatStamp } from "./chat-presentation";

const LABELS: Record<ChatAnnouncementKind, { icon: string; label: string }> = {
  "server-boost": { icon: "⚡", label: "Server Boost" },
  patreon: { icon: "★", label: "Patreon Supporter" },
};

/**
 * A server announcement in public chat, drawn as a full-width banner instead of a player's line: an icon, its label
 * and who it is for, then the server's words. It has no portrait, reply, reaction or report actions. Only a message
 * the server marked (chat_announcement) is drawn this way, so typed text never looks like one.
 */
export function createChatAnnouncementLine(message: { id: bigint; senderName: string; message: string; sentAtMs: number },
  kind: ChatAnnouncementKind, showTime: boolean) {
  const { icon, label } = LABELS[kind];
  const line = document.createElement("div");
  line.className = "chat-line chat-announcement";
  line.dataset.messageId = String(message.id);
  line.dataset.kind = kind;
  line.setAttribute("role", "note");
  line.setAttribute("aria-label", `${label}: ${message.senderName}. ${message.message}`);
  const mark = document.createElement("span");
  mark.className = "chat-announcement-icon";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = icon;
  const head = document.createElement("span");
  head.className = "chat-announcement-head";
  const title = document.createElement("span");
  title.className = "chat-announcement-label";
  title.textContent = label;
  const name = document.createElement("span");
  name.className = "chat-announcement-name";
  name.textContent = message.senderName;
  head.append(title, name);
  if (showTime && Number.isFinite(message.sentAtMs)) {
    const time = document.createElement("time");
    time.className = "chat-announcement-time";
    time.dateTime = new Date(message.sentAtMs).toISOString();
    time.textContent = formatChatStamp(new Date(message.sentAtMs));
    head.append(time);
  }
  const text = document.createElement("span");
  text.className = "chat-announcement-text";
  text.textContent = message.message;
  line.append(mark, head, text);
  return line;
}
