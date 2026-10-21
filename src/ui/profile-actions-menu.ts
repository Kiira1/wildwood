import { copyText } from "./chat-message-actions";

/** The ⋯ menu on another player's profile: Copy Name, Report and Block, one per row. */
export function createProfileActionsMenu(api: {
  isBlocked: (identity: string) => boolean;
  openSafety: (identity: string, name: string, action: "report" | "block") => void;
  showMessage: (text: string, color: string) => void;
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
    return text;
  }
  row("profileMenuCopyNameBtn", "⧉", "Copy Name", false, () => {
    void copyText(name).then(() => api.showMessage("NAME COPIED", "#c9f5c2"), () => api.showMessage("COULD NOT COPY", "#ff9b91"));
  });
  row("profileMenuReportBtn", "!", "Report", true, () => api.openSafety(target, name, "report"));
  const blockLabel = row("profileMenuBlockBtn", "⊘", "Block", true, () => api.openSafety(target, name, "block"));

  function close() { if (dialog.open) dialog.close(); }
  function open(identity: string, playerName: string) {
    if (!identity) return;
    target = identity; name = playerName;
    title.textContent = playerName;
    blockLabel.textContent = api.isBlocked(identity) ? "Unblock" : "Block";
    dialog.showModal();
  }
  // A tap outside the rows lands on the dialog itself (its backdrop) and closes it.
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  // Escape closes this menu only, not the profile under it.
  dialog.addEventListener("keydown", event => event.stopPropagation());
  return { open, close };
}
