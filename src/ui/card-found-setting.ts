/**
 * Whether a card found takes the screen with its popup (Settings > Game > Card Found Popups). On by default;
 * off, the card still goes to the Cards tab.
 */
let enabled = true;
export const cardFoundPopupsEnabled = () => enabled;
export function setCardFoundPopupsEnabled(next: boolean) { enabled = next; }
