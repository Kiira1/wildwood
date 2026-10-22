import { copyText } from "./chat-message-actions";

/** The ⋯ menu on another player's profile: Message, Copy Name, Invite to Guild, Report and Block, one per row. */
export function createProfileActionsMenu(api: {
  isBlocked: (identity: string) => boolean;
  openSafety: (identity: string, name: string, action: "report" | "block") => void;
  showMessage: (text: string, color: string) => void;
  openPrivateChat: (identity: string, name: string) => void;
  guildInvite?: { available: (identity: string) => boolean; send: (identity: string) => Promise<{ ok: boolean; error?: string }> };
}, doc: Document = document) {
  const dialog = doc.createElement("dialog");
  dialog.className = "profile-actions-menu";
  dialog.setAttribute("aria-labelledby", "profileActionsTitle");
  const title = doc.createElement("h2");
  title.id = "profileActionsTitle";
  dialog.append(title);
  doc.body.append(dialog);
  let target = "", name = "";

  function row(id: string, icon: string, label: string, danger: boolean, action: () => void) {
    const button = doc.createElement("button");
    button.id = id; button.type = "button";
    button.className = `chat-message-action-button${danger ? " is-danger" : ""}`;
    const mark = doc.createElement("span"); mark.setAttribute("aria-hidden", "true"); mark.textContent = icon;
    // A bare text node: the row's span is its icon box.
    const text = doc.createTextNode(label);
    button.append(mark, text);
    button.addEventListener("click", () => { close(); action(); });
    dialog.append(button);
    return { button, text };
  }
  row("profileMenuMessageBtn", "✉", "Message", false, () => api.openPrivateChat(target, name));
  row("profileMenuCopyNameBtn", "⧉", "Copy Name", false, () => {
    void copyText(name).then(() => api.showMessage("NAME COPIED", "#c9f5c2"), () => api.showMessage("COULD NOT COPY", "#ff9b91"));
  });
  const invite = row("profileMenuInviteBtn", "+", "Invite to Guild", false, () => {
    const invited = name;
    void api.guildInvite?.send(target).then(result => api.showMessage(result.ok ? `Invited ${invited}` : result.error || "Could Not Invite", result.ok ? "#ffffff" : "#ff9b91"));
  }).button;
  row("profileMenuReportBtn", "!", "Report", true, () => api.openSafety(target, name, "report"));
  const blockLabel = row("profileMenuBlockBtn", "⊘", "Block", true, () => api.openSafety(target, name, "block")).text;

  function close() { if (dialog.open) dialog.close(); }
  function open(identity: string, playerName: string) {
    if (!identity) return;
    target = identity; name = playerName;
    title.textContent = playerName;
    blockLabel.textContent = api.isBlocked(identity) ? "Unblock" : "Block";
    invite.hidden = !api.guildInvite?.available(identity);
    dialog.showModal();
  }
  // A tap outside the rows lands on the dialog itself (its backdrop) and closes it.
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  // Escape closes this menu only, not the profile under it.
  dialog.addEventListener("keydown", event => event.stopPropagation());
  return { open, close };
}
