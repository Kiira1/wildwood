import { expect, it } from "vitest";
import { createGameDocument } from "../../tests/helpers/game-document";
import { refreshGoldCounter } from "./gold-counter";

it("sits right of the gem wallet and shows the account's gold", () => {
  const doc = createGameDocument();
  const wallet = doc.getElementById("hudGoldWallet")!, balance = doc.getElementById("hudGoldBalance")!;
  expect(wallet.previousElementSibling?.id).toBe("hudGemWallet");
  expect(wallet.closest(".hud-secondary-controls")).not.toBeNull();
  refreshGoldCounter({ hudGoldWallet: wallet, hudGoldBalance: balance }, 12_345n);
  expect(balance.textContent).toBe(new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(12_345n));
  expect(wallet.getAttribute("aria-label")).toBe(`${balance.textContent} Gold`);
  refreshGoldCounter({ hudGoldWallet: wallet, hudGoldBalance: balance }, 0n);
  expect(balance.textContent).toBe("0");
  expect(wallet.getAttribute("aria-label")).toBe("0 Gold");
});
