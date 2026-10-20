import type { wildstatCoop } from "../../wildstat-coop";
import { prestigePerkValue, type PrestigePerkId } from "../../../shared/prestige-perks";
import { DEFAULT_SKIN_TONE } from "../player-appearance";

/** The browser coop API, whose keys src/coop/wildstat-coop-api-contract.ts pins. */
export type CoopClient = typeof wildstatCoop;

/**
 * Coop reads made from many places, each with its value before the client or its row exists.
 * `client` is the client itself, for calls with no shared default.
 */
export function createCoopAccess(client: CoopClient | null) {
  const localIdentity = () => client?.localIdentity?.();
  return {
    client,
    /** The local player's identity, or undefined with no client. */
    localIdentity,
    /** The local player's identity, or "" with no client. */
    identity: () => localIdentity() ?? "",
    isLocal: (identity: string | undefined) => identity === localIdentity(),
    localDisplayName: () => client?.localDisplayName?.(),
    connected: () => Boolean(client?.isConnected?.()),
    accountState: () => client?.accountState?.(),
    localState: () => client?.localState?.(),
    savedProgress: () => client?.savedProgress?.(),
    serverNowMs: () => client?.serverNowMs?.() ?? Date.now(),
    gemBalance: () => client?.gemBalance?.() ?? 0n,
    prestigeLevel: () => client?.prestige?.()?.level ?? 0,
    prestigePerk: (perk: PrestigePerkId) => prestigePerkValue(client?.prestigePerks?.(), perk),
    attackCap: () => client?.attackCapInPlay?.(),
    itemLevel: (itemId: string) => client?.itemLevel?.(itemId) ?? 0,
    weaponSkills: (itemId: string) => client?.weaponSkills?.(itemId),
    remotePlayers: () => client?.remotePlayers?.() ?? [],
    playerDisplayName: (identity: string) => client?.playerDisplayName?.(identity),
    profileIcon: (identity?: string) => client?.profileIcon?.(identity) ?? 0,
    skinTone: (identity?: string) => client?.skinTone?.(identity) ?? DEFAULT_SKIN_TONE,
    playerGender: (identity?: string) => client?.playerGender?.(identity) ?? 0,
    isGuest: (identity?: string) => client?.isGuest?.(identity) ?? false,
    isPlayerBlocked: (identity: string) => client?.isPlayerBlocked?.(identity) ?? false,
  };
}

export type CoopAccess = ReturnType<typeof createCoopAccess>;
