import type { ChatConversation } from "./chat-channels";
import type { ChatUnreadCounts } from "./chat-unread";

export type ChatGuildInvite = { id: string; guildName: string; inviterName: string; inviterIdentity?: string };

const inviteText = (invite: ChatGuildInvite) => `Invited You to ${invite.guildName}`;

/** Each pending invitation opens (or tops) a private conversation with the player who sent it. */
export function conversationsWithInvites(conversations: ChatConversation[], invites: ChatGuildInvite[]) {
  if (!invites.length) return conversations;
  const people = new Map(conversations.map(person => [person.identity, person]));
  for (const invite of invites) {
    const identity = invite.inviterIdentity!;
    const person = people.get(identity);
    people.set(identity, { ...person, identity, name: person?.name ?? invite.inviterName,
      lastMessage: inviteText(invite), lastMessageMine: false, lastSentAtMs: Number.MAX_SAFE_INTEGER });
  }
  return [...people.values()];
}

/** An unanswered invitation counts as one unread message, except in the conversation being read. */
export function unreadWithInvites(counts: ChatUnreadCounts, invites: ChatGuildInvite[], readConversation: string | null) {
  const unread = invites.filter(invite => readConversation !== `private:${invite.inviterIdentity}`);
  if (!unread.length) return counts;
  const conversations = new Map(counts.conversations);
  for (const invite of unread) conversations.set(invite.inviterIdentity!, (conversations.get(invite.inviterIdentity!) ?? 0) + 1);
  return { ...counts, private: counts.private + unread.length, conversations };
}

/** The invitation card shown at the top of the inviter's private conversation, with Accept and Decline. */
export function createChatInviteCards(doc: Document, answer: (invite: ChatGuildInvite, accept: boolean) => Promise<void>) {
  const root = doc.createElement("div");
  root.className = "chat-guild-invites";
  root.hidden = true;
  let busy = false, signature = "";
  let shown: ChatGuildInvite[] = [];
  function draw() {
    root.replaceChildren();
    for (const invite of shown) {
      const card = doc.createElement("div");
      card.className = "chat-guild-invite";
      const text = doc.createElement("p");
      text.textContent = inviteText(invite);
      const actions = doc.createElement("div");
      actions.className = "chat-guild-invite-actions";
      for (const accept of [true, false]) {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = accept ? "Accept" : "Decline";
        button.className = accept ? "is-primary" : "";
        button.disabled = busy;
        button.addEventListener("click", () => {
          if (busy) return;
          busy = true; draw();
          void answer(invite, accept).finally(() => { busy = false; draw(); });
        });
        actions.append(button);
      }
      card.append(text, actions);
      root.append(card);
    }
    root.hidden = !shown.length;
  }
  return {
    root,
    show(invites: ChatGuildInvite[]) {
      const next = JSON.stringify(invites);
      if (next === signature) return;
      signature = next; shown = invites; draw();
    },
  };
}
