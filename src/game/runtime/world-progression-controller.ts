type Player = { x: number; y: number; r: number; speed: number };
type BootsPickup = { x: number; y: number; r: number; collected: boolean };

export function createWorldProgressionController(hooks: {
  player: Player;
  bootsPickup: BootsPickup;
  movementSpeedForBoots: (bootsEquipped: boolean) => number;
  collectBoots: () => void;
  saveProgress: () => void;
  renderInventory: () => void;
  pause: () => void;
  resume: () => void;
  bootUpgrade: HTMLElement;
  bootUpgradeClose: HTMLElement;
}) {
  function closeBootUpgrade() {
    hooks.resume();
    hooks.bootUpgrade.hidden = true;
  }

  return {
    closeBootUpgrade,
    hideBootUpgrade: () => { hooks.bootUpgrade.hidden = true; },
  };
}
