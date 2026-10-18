import { afterEach, expect, it, vi } from "vitest";
import { inspectSpacetimeIdToken } from "./oidc-id-token";
import { SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../../shared/rules";

const encode = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const token = (claims: object) => `${encode({ alg: "RS256", kid: "key-1", typ: "JWT" })}.${encode(claims)}.c2lnbmF0dXJl`;
const nowSeconds = 2_000_000_000;
const claims = { iss: SPACETIME_AUTH_ISSUER, sub: "player", aud: SPACETIME_AUTH_CLIENT_ID, iat: nowSeconds - 60, exp: nowSeconds + 3_600 };
afterEach(() => vi.restoreAllMocks());

it("decodes a token once, however often the game asks about it", () => {
  const atob = vi.spyOn(globalThis, "atob");
  const value = token(claims);
  for (let i = 0; i < 100; i++) expect(inspectSpacetimeIdToken(value, { nowMs: nowSeconds * 1_000 }).sub).toBe("player");
  expect(atob).toHaveBeenCalledTimes(3);
});

it("still checks expiry on every call", () => {
  const value = token({ ...claims, sub: "later" });
  expect(inspectSpacetimeIdToken(value, { nowMs: nowSeconds * 1_000 }).sub).toBe("later");
  expect(() => inspectSpacetimeIdToken(value, { nowMs: (nowSeconds + 4_000) * 1_000 })).toThrow();
  expect(inspectSpacetimeIdToken(value, { nowMs: (nowSeconds + 4_000) * 1_000, allowExpired: true }).sub).toBe("later");
});
