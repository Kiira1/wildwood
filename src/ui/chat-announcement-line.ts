import type { ChatAnnouncementKind } from "../../shared/chat-announcement";

const LABELS: Record<ChatAnnouncementKind, string> = {
  "server-boost": "Server Boost",
  patreon: "Patreon Supporter",
};

/**
 * Marks a public chat line as a server announcement: a label after the name and an outlined bubble.
 * Only a message the server marked (chat_announcement) gets this, so typed text never looks like one.
 */
export function markChatAnnouncement(line: HTMLElement, name: HTMLElement, kind: ChatAnnouncementKind) {
  line.classList.add("chat-announcement");
  line.dataset.kind = kind;
  const label = document.createElement("span");
  label.className = "chat-announcement-label";
  label.textContent = LABELS[kind];
  name.append(label);
}
