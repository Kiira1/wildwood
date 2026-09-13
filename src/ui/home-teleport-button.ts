const HOME_TELEPORT_COOLDOWN_MS = 5_000;

export function bindHomeTeleportButton(
  button: HTMLButtonElement,
  options: {
    beforeTeleport(): void;
    teleport(): Promise<boolean>;
    showFailure(failed: boolean): void;
  },
) {
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
        setTimeout(() => { button.disabled = false; }, HOME_TELEPORT_COOLDOWN_MS);
      } else {
        button.disabled = false;
      }
    }
  });
}
