import { applyAvatarFrame } from "../app/avatar-frames";
import { applyProfileIcon } from "../app/profile-icons";
import { formatChatUnreadCount, type ChatUnreadCounts } from "./chat-unread";

export type ChatChannel = "public" | "guild" | "private";
export type ChatConversation = import("../../shared/social").SocialConversation;

export function mergeChatConversations(friends: ChatConversation[], conversations: ChatConversation[]) {
  const names = new Map<string, ChatConversation>();
  for (const person of [...conversations, ...friends]) {
    if (person.name.trim()) {
      const key = person.identity || person.name.trim().toLowerCase();
      names.set(key, { ...names.get(key), ...person });
    }
  }
  return [...names.values()].sort((a, b) => (b.lastSentAtMs ?? 0) - (a.lastSentAtMs ?? 0) || a.name.localeCompare(b.name));
}

export function createChatChannelPicker(onChange: (channel: ChatChannel, username: string, identity?: string) => void) {
  const root = document.createElement("div");
  root.className = "chat-channels";
  const tabs = document.createElement("div");
  tabs.className = "chat-channel-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Chat channel");
  const buttons = new Map<ChatChannel, HTMLButtonElement>();
  const badges = new Map<ChatChannel, HTMLSpanElement>();
  let selected: ChatChannel = "public";
  let peer = "";
  let peerIdentity: string | undefined;
  let people: ChatConversation[] = [];
  for (const channel of ["public", "guild", "private"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    const label = document.createElement("span");
    label.className = "chat-channel-label";
    const name = document.createElement("span");
    name.className = "chat-channel-name";
    name.textContent = channel[0].toUpperCase() + channel.slice(1);
    const badge = document.createElement("span");
    badge.className = "chat-channel-unread";
    badge.hidden = true;
    badge.setAttribute("aria-hidden", "true");
    label.append(name, badge);
    button.append(label);
    badges.set(channel, badge);
    button.setAttribute("role", "tab");
    button.addEventListener("click", () => select(channel, channel === "private" ? "" : peer, channel === "private" ? undefined : peerIdentity));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const channels = [...buttons.keys()];
      const index = channels.indexOf(channel);
      const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
      select(channels[next], channels[next] === "private" ? "" : peer, channels[next] === "private" ? undefined : peerIdentity);
      buttons.get(channels[next])?.focus();
    });
    buttons.set(channel, button);
    tabs.append(button);
  }
  const picker = document.createElement("form");
  picker.className = "chat-private-picker";
  const username = document.createElement("input");
  username.type = "text";
  username.placeholder = "Player username";
  username.setAttribute("aria-label", "Private message recipient username");
  username.autocomplete = "off";
  username.maxLength = 40;
  const open = document.createElement("button");
  open.type = "submit";
  open.textContent = "Open";
  const contacts = document.createElement("div");
  contacts.className = "chat-conversations";
  contacts.setAttribute("aria-label", "Private conversations");
  const conversationHeader = document.createElement("div");
  conversationHeader.className = "chat-conversation-heading";
  picker.addEventListener("submit", (event) => {
    event.preventDefault();
    if (username.value.trim()) select("private", username.value.trim());
  });
  const manageFriends = document.createElement("button");
  manageFriends.type = "button";
  manageFriends.textContent = "Manage friends";
  manageFriends.className = "chat-manage-friends";
  manageFriends.addEventListener("click", () => window.dispatchEvent(new CustomEvent("wildwood:open-friends")));
  picker.append(username, open, manageFriends);
  const status = document.createElement("div");
  status.className = "chat-channel-status";
  status.setAttribute("aria-live", "polite");
  const navigation = document.createElement("div");
  navigation.className = "chat-channel-navigation";
  const discord = document.createElement("a");
  discord.className = "chat-discord-link";
  discord.href = "https://discord.gg/mcS226NbG4";
  discord.target = "_blank";
  discord.rel = "noopener noreferrer";
  discord.setAttribute("aria-label", "Join the WildStat Discord (opens in a new tab)");
  discord.title = "Join Discord";
  discord.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20.3 4.4a19.8 19.8 0 0 0-4.9-1.5l-.6 1.2a18.3 18.3 0 0 0-5.5 0l-.6-1.2a19.9 19.9 0 0 0-4.9 1.5C.7 9 .0 13.5.3 17.9a19.8 19.8 0 0 0 6 3l1.2-2a12.7 12.7 0 0 1-1.9-.9l.5-.4a14.1 14.1 0 0 0 11.8 0l.5.4a13.2 13.2 0 0 1-1.9.9l1.2 2a19.7 19.7 0 0 0 6-3c.5-5.1-.8-9.5-3.4-13.5ZM8 15.2c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm8 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z"/></svg>`;
  navigation.append(tabs, discord);
  root.append(navigation, picker, conversationHeader, status);

  function update() {
    for (const [channel, button] of buttons) {
      button.setAttribute("aria-selected", String(channel === selected));
      button.tabIndex = channel === selected ? 0 : -1;
    }
    picker.hidden = selected !== "private" || Boolean(peer);
    contacts.hidden = selected !== "private" || Boolean(peer);
    conversationHeader.hidden = selected !== "private" || !peer;
    conversationHeader.textContent = peer;
    username.value = peer;
  }
  function select(channel: ChatChannel, nextPeer: string, identity?: string) {
    selected = channel;
    peer = nextPeer.trim();
    peerIdentity = identity ?? people.find(person => person.name.toLowerCase() === peer.toLowerCase())?.identity;
    update();
    onChange(selected, peer, peerIdentity);
  }
  let contactSignature = "";
  function refresh(friends: ChatConversation[], conversations: ChatConversation[], guildName: string, unread: ChatUnreadCounts) {
    people = mergeChatConversations(friends, conversations);
    peerIdentity ??= people.find(person => person.name.toLowerCase() === peer.toLowerCase())?.identity;
    const currentPeer = people.find(person => person.identity === peerIdentity);
    if (currentPeer && currentPeer.name !== peer) {
      if (username.value === peer) username.value = currentPeer.name;
      peer = currentPeer.name;
    }
    for (const [channel, button] of buttons) {
      const count = channel === "guild" ? unread.guild : channel === "private" ? unread.private : unread.world;
      const label = channel[0].toUpperCase() + channel.slice(1);
      const badge = badges.get(channel)!;
      badge.textContent = formatChatUnreadCount(count);
      badge.hidden = count === 0;
      button.setAttribute("aria-label", count ? `${label}, ${count} unread messages` : label);
    }
    const signature = JSON.stringify([people, [...unread.conversations]]);
    if (signature !== contactSignature) {
      contactSignature = signature;
      contacts.replaceChildren();
      if (!people.length) {
        const empty = document.createElement("p");
        empty.className = "chat-conversations-empty";
        empty.textContent = "No conversations yet";
        contacts.append(empty);
      }
      for (const person of people) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "chat-conversation-row";
        row.dataset.identity = person.identity;
        const label = document.createElement("span");
        label.textContent = person.name;
        label.className = "chat-conversation-name";
        const portrait = document.createElement("span");
        portrait.className = "chat-profile-icon chat-conversation-portrait";
        applyAvatarFrame(portrait, person.identity);
        portrait.setAttribute("aria-hidden", "true");
        applyProfileIcon(portrait, person.profileIcon ?? 0);
        const content = document.createElement("span");
        content.className = "chat-conversation-content";
        const preview = document.createElement("span");
        preview.className = "chat-conversation-preview";
        preview.textContent = person.lastMessage ? `${person.lastMessageMine ? "You: " : ""}${person.lastMessage.replace(/\s+/g, " ")}` : "";
        content.append(label, preview);
        row.append(portrait, content);
        const count = unread.conversations.get(person.identity) ?? 0;
        if (count) {
          const badge = document.createElement("span");
          badge.className = "chat-conversation-unread";
          badge.textContent = String(count);
          row.append(badge);
        }
        row.setAttribute("aria-label", count ? `${person.name}, ${count} unread messages` : person.name);
        row.addEventListener("click", () => select("private", person.name, person.identity));
        contacts.append(row);
      }
    }
    status.textContent = selected === "guild" ? (guildName ? `Guild: ${guildName}` : "Join or create a guild to chat with members.")
      : "";
    status.hidden = selected !== "guild";
    conversationHeader.textContent = peer;
  }
  update();
  return { root, conversations: contacts, select, refresh };
}
