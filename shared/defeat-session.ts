/** Stable wire markers: callers must not treat these as expired guest tokens. */
export const DEFEAT_REAUTH = "DEFEAT_SESSION_REAUTH";
export const DEFEAT_COOLDOWN = "DEFEAT_SESSION_COOLDOWN";
export const DEFEAT_GUEST_BLOCK_SECONDS = 30;

export function freshAuthentication(authTime: unknown, revokedAtMicros: bigint) {
  // iat changes on refresh; auth_time only changes after authentication.
  return typeof authTime === "number" && Number.isSafeInteger(authTime)
    && authTime > Number(revokedAtMicros / 1_000_000n);
}
