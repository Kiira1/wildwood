import type { ScenarioPlayer, ScenarioWorld } from "./server";
import { AGE_BAND_ADULT, TERMS_VERSION } from "../../../shared/legal";

/** Fixture setup: the player's Gem balance, as if earned. */
export function setGems(world: ScenarioWorld, player: ScenarioPlayer, balance: bigint) {
  world.setup(ctx => {
    const wallet = ctx.db.playerGemWallet.identity.find(player.identity);
    if (wallet) ctx.db.playerGemWallet.identity.update({ ...wallet, balance });
    else ctx.db.playerGemWallet.insert({ identity: player.identity, balance, revision: 0n, updatedAt: world.timestamp() });
  });
}

/** A guest links into a new account, as the sign-in flow does: the guest starts the link, the account claims it and enters. */
export function linkGuest(world: ScenarioWorld, guest: ScenarioPlayer, accountName: string) {
  const code = `link-${guest.hex.slice(0, 16)}`.padEnd(40, "x");
  guest.call("beginAccountLink", { code });
  const account = world.player(accountName, "account").connect();
  account.call("claimGuestAccount", { code });
  account.call("acceptTerms", { termsVersion: TERMS_VERSION, ageBand: AGE_BAND_ADULT });
  account.call("enterWorldWithTutorial", { tabId: `tab-${account.hex.slice(0, 12)}`, forceTakeover: false });
  return account;
}
