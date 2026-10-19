import { formatGemAmount } from "./number-format";

type GoldCounterElements = { hudGoldWallet: HTMLElement; hudGoldBalance: HTMLElement };

/** Shows the account's gold in the HUD chip beside the gems; writes only when the number changed. */
export function refreshGoldCounter(elements: GoldCounterElements, gold: bigint) {
  const text = formatGemAmount(gold);
  if (elements.hudGoldBalance.textContent === text) return;
  elements.hudGoldBalance.textContent = text;
  elements.hudGoldWallet.setAttribute("aria-label", `${text} Gold`);
}
