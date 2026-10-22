import type { ChatAnnouncementKind } from "../../shared/chat-announcement";
import { formatChatStamp } from "./chat-presentation";

const LABELS: Record<ChatAnnouncementKind, string> = {
  "server-boost": "Server Boost",
  patreon: "Patreon Supporter",
};

/**
 * A server announcement in public chat, drawn as a full-width banner instead of a player's line: the supporter's
 * portrait, the label and their name, then the server's words. It has no reply, reaction or report actions. Only a message
 * the server marked (chat_announcement) is drawn this way, so typed text never looks like one.
 */
export function createChatAnnouncementLine(message: { id: bigint; senderName: string; message: string; sentAtMs: number },
  kind: ChatAnnouncementKind, showTime: boolean, portrait: HTMLElement) {
  const label = LABELS[kind];
  const line = document.createElement("div");
  line.className = "chat-line chat-announcement";
  line.dataset.messageId = String(message.id);
  line.dataset.kind = kind;
  line.setAttribute("role", "note");
  line.setAttribute("aria-label", `${label}: ${message.senderName}. ${message.message}`);
  portrait.classList.add("chat-announcement-icon");
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
  line.append(portrait, head, text);
  return line;
}
