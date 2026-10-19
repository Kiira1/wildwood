/**
 * "Signed In As Gehn · Not You?" strip, shown when a sign-in loaded a different
 * character from the one the player tapped. It sits at the top and never pauses
 * play; Use Another Account signs out and asks which account.
 */

export type SignedInAsNoticeDependencies = {
  /** The character that loaded instead, or "" (account-service signedInAs). */
  name: () => string;
  switchAccount: () => void;
  root?: Document;
};

const BUTTON_STYLE = "margin:0;min-height:36px;padding:6px 12px;border:1px solid #6b6b6b;border-radius:8px;"
  + "background:#2a2a2a;color:#fff;font:inherit;font-size:13px;font-weight:800;cursor:pointer";

export function createSignedInAsNotice(dependencies: SignedInAsNoticeDependencies) {
  const root = dependencies.root ?? document;
  const strip = root.createElement("div");
  strip.id = "signedInAsNotice";
  strip.setAttribute("role", "status");
  strip.setAttribute("aria-live", "polite");
  // Styled inline like #duplicateLoginWarning, so shipping it needs no stylesheet change. Above the chat and nav bars,
  // so it never hides the health bar.
  strip.setAttribute("style", "position:fixed;z-index:12;bottom:calc(env(safe-area-inset-bottom, 0px) + 124px);left:50%;"
    + "transform:translateX(-50%);width:max-content;max-width:calc(100vw - 32px);box-sizing:border-box;display:none;"
    + "flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;padding:8px 12px;border:1px solid #4a4a4a;"
    + "border-radius:10px;background:rgba(10,10,10,.92);color:#fff;font-size:13px;font-weight:700;line-height:1.35;text-align:center");
  strip.hidden = true;
  const text = root.createElement("span");
  const switchButton = root.createElement("button");
  switchButton.type = "button";
  switchButton.textContent = "Use Another Account";
  switchButton.setAttribute("style", BUTTON_STYLE);
  const keepButton = root.createElement("button");
  keepButton.type = "button";
  keepButton.textContent = "Keep Playing";
  keepButton.setAttribute("style", BUTTON_STYLE);
  strip.append(text, switchButton, keepButton);
  root.body.append(strip);

  let shown = "";
  let dismissed = "";

  function setVisible(visible: boolean) {
    strip.hidden = !visible;
    strip.style.display = visible ? "flex" : "none";
  }

  /** Safe on every HUD tick. */
  function poll() {
    const name = dependencies.name();
    const next = name && name !== dismissed ? name : "";
    if (next === shown) return;
    shown = next;
    if (next) text.textContent = `Signed In As ${next} · Not You?`;
    setVisible(Boolean(next));
  }

  switchButton.addEventListener("click", () => {
    if (!shown) return;
    switchButton.disabled = true;
    dependencies.switchAccount();
  });
  keepButton.addEventListener("click", () => {
    dismissed = shown;
    poll();
  });

  return { poll, isOpen: () => Boolean(shown) };
}
