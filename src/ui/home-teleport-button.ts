const HOME_TELEPORT_COOLDOWN_MS = 5_000;

export function bindHomeTeleportButton(
  button: HTMLButtonElement,
  options: {
    beforeTeleport(): void;
    teleport(): Promise<boolean>;
    showFailure(failed: boolean): void;
  },
) {
  const cooldown = button.ownerDocument.createElement("span");
  cooldown.className = "home-teleport-cooldown";
  cooldown.hidden = true;
  cooldown.setAttribute("aria-hidden", "true");
  button.append(cooldown);

  function showCooldown() {
    const endsAt = Date.now() + HOME_TELEPORT_COOLDOWN_MS;
    cooldown.hidden = false;
    button.classList.add("is-home-cooldown");
    const update = () => {
      const remaining = Math.max(0, endsAt - Date.now());
      if (!remaining) {
        cooldown.hidden = true;
        button.classList.remove("is-home-cooldown");
        button.removeAttribute("title");
        button.disabled = false;
        return;
      }
      const seconds = Math.ceil(remaining / 1_000);
      cooldown.textContent = String(seconds);
      cooldown.style.setProperty("--cooldown-progress", `${remaining / HOME_TELEPORT_COOLDOWN_MS * 100}%`);
      button.title = `Teleport ready in ${seconds}s`;
      setTimeout(update, Math.min(50, remaining));
    };
    update();
  }

  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    let changed = false;
    try {
      options.beforeTeleport();
      changed = await options.teleport();
      if (!changed) options.showFailure(false);
    } catch {
      options.showFailure(true);
    } finally {
      if (changed) {
        showCooldown();
      } else {
        button.disabled = false;
      }
    }
  });
}
