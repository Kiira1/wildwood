import { SPACETIME_AUTH_CLIENT_ID, SPACETIME_AUTH_ISSUER } from "../../../shared/rules";

/** End the provider's browser session as well as clearing the game's tokens.
 * Endpoint is advertised by SpacetimeAuth's OIDC discovery document. */
export function accountLogoutUrl(idToken: string | null, returnUri: string, state?: string) {
  const url = new URL(`${SPACETIME_AUTH_ISSUER}/session/end`);
  url.searchParams.set("client_id", SPACETIME_AUTH_CLIENT_ID);
  url.searchParams.set("post_logout_redirect_uri", returnUri);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
