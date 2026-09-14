import { createReleaseNotesIndicator } from "./release-notes-unread";
import { renderUpdateNotice } from "./overlays";

/** Uses the sign-in notes renderer in a dialog outside the hidden startup screen. */
export function createGameReleaseNotes(
  toggle: HTMLElement,
  releases: () => Parameters<typeof renderUpdateNotice>[1],
) {
  const indicator = createReleaseNotesIndicator(toggle, releases);
  const dialog = document.createElement("dialog");
  dialog.id = "gameReleaseNotes";
  dialog.className = "signin-update-notice game-release-notes";
  dialog.setAttribute("aria-labelledby", "gameReleaseNotesTitle");
  const scroll = document.createElement("div");
  scroll.className = "signin-update-scroll";
  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.id = "gameReleaseNotesTitle";
  title.textContent = "RELEASE NOTES";
  header.append(title);
  const items = document.createElement("ul");
  items.className = "signin-update-history";
  scroll.append(header, items);
  const footer = document.createElement("footer");
  footer.className = "window-back-footer";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "window-back-button";
  back.textContent = "Back";
  footer.append(back);
  dialog.append(scroll, footer);
  document.body.append(dialog);
  toggle.setAttribute("aria-controls", dialog.id);
  toggle.setAttribute("aria-haspopup", "dialog");
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    renderUpdateNotice({ items }, releases());
    if (!dialog.open) dialog.showModal();
    indicator.markRead();
    toggle.setAttribute("aria-expanded", "true");
  });
  back.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus({ preventScroll: true });
  });
  return dialog;
}
