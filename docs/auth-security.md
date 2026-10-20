# WildStat browser authentication security

WildStat is a public client hosted as static files on GitHub Pages. It cannot
keep a client secret or set `HttpOnly` cookies, so its account sign-in uses the
OAuth authorization-code flow with PKCE S256.

## OIDC checks

- The state, PKCE verifier, and nonce are generated with Web Crypto and kept in
  the initiating tab's `sessionStorage`. They are cleared after success,
  rejection, cancellation, or sign-out.
- The callback state must match. An authorization-response `iss` value, when
  supplied, must match `https://auth.spacetimedb.com/oidc`.
- Before an ID token is persisted, WildStat requires a three-part JWT using
  `RS256`, obtains the matching public key from the issuer's pinned JWKS
  endpoint, and verifies the signature with Web Crypto.
- Required `iss`, `aud`, `sub`, `exp`, `iat`, and `nonce` claims are validated.
  `azp` is checked when present and required for multiple audiences. Future
  `nbf` values, future issue times, expired tokens, and tokens with less than
  30 seconds of usable life are rejected.
- Persisted tokens are structurally and claim-validated before every use. The
  SpacetimeDB connection performs the authoritative server-side signature
  check as well. Expired saved claims may be read for account matching, but
  an expired token is renewed before being sent to a new connection.

The issuer metadata used for this implementation is the provider's official
OpenID discovery document at
`https://auth.spacetimedb.com/oidc/.well-known/openid-configuration`.

## Persistent login tradeoff

The ID token remains in namespaced `localStorage` so a player can close the
browser or installed web app and return to the same character. This is the
standard practical option for a static browser client, but it is not equivalent
to an `HttpOnly`, `Secure`, same-site server cookie: JavaScript executing in the
WildStat origin could read a bearer token. Moving it to `sessionStorage` or
IndexedDB would not remove that same-origin script risk, while `sessionStorage`
would also remove persistent login.

Sign-in requests `offline_access` and stores the returned refresh token beside
its account ID token, bound to that account's subject. This has the same
same-origin script exposure as the ID token and allows a player to keep playing
after the short-lived ID token expires. No client secret is stored. Refreshed
ID tokens pass signature, issuer, audience, lifetime, and subject checks; a nonce
returned on refresh must match the preceding token. Sign-out and switching to
guest clear the refresh grant. A rejected refresh grant requires sign-in again;
network failures preserve credentials for retry. Callback URLs are never sent
as referrers, and CSP restricts scripts to the WildStat origin.

## Connection renewal

Both account and map WebSocket transports resolve a current credential before
exchanging it for the temporary WebSocket token. A 401 forces one renewal and
one exchange retry. The map connection can retain its original account token
as a subject reference while the renewal service supplies the latest token for
that same subject. It never substitutes credentials belonging to another user.
Concurrent renewals share a promise; Web Locks coordinate rotation across tabs
where supported. A same-account token storage update does not reload gameplay.
Network requests have timeouts, and superseded portal connections cannot open
sockets after their renewal completes.

Older logins did not request a refresh grant. Their first expiry may require one
normal sign-in round trip to obtain it. An already admitted game session stays
approved during renewal or network recovery, including after backgrounding.

Provider checks on 2026-09-14: discovery advertises `refresh_token` and
`offline_access`; WildStat's public client accepts the offline-access
PKCE authorization request, and a deliberately invalid refresh grant returns
`invalid_grant` rather than `unauthorized_client`. No provider setting change
was required. Actual authenticated renewal is covered by local regression tests;
it still needs confirmation from player diagnostics after release.

Player diagnostics, 2026-10-20: SpacetimeAuth refuses every refresh from 24 hours
after sign-in (`auth_time`) on (`invalid_grant`, "grant request is invalid"),
however often it was rotated in between. None was refused earlier.
The game then sends the player back through SpacetimeAuth. A tab in the
background waits until it is shown, and uses the sign-in another tab restored
if there is one. Forced logins now return a refresh grant, so the old
follow-up trip for a missing one is gone.

## DPoP-bound refresh tokens (on for everyone since 0.916.15)

The 24-hour cap looks like node-oidc-provider's rule for public clients: a
rotated refresh token keeps only the remaining lifetime unless it is
sender-constrained. `account-dpop.ts` binds it with DPoP (RFC 9449): one
non-extractable ES256 key per browser profile in IndexedDB (`wildstat-dpop`),
shared by tabs, and a signed proof on every token-endpoint request (code
exchange and refresh), retried once with the provider's `DPoP-Nonce`.

- On for every browser (`DPOP_DEFAULT_ON` in `account-dpop.ts`);
  `localStorage["wildstat-dpop-v1"] = "off"` opts one browser out.
- A sign-in is bound when the exchange sent a proof and the answer's
  `token_type` is `DPoP`; the grant then stores the key's thumbprint (`jkt`).
  A bound grant is always refreshed with a proof from that key, even after an
  opt-out. A missing or different key means sign in again. Unbound grants
  keep refreshing without DPoP until the next sign-in.
- The key starts loading when the game loads, after waking WebKit's
  IndexedDB (it can hang on the first request until `indexedDB.databases()`
  is polled), so a sign-in return usually finds it ready.
- Backup key: where IndexedDB is missing, fails, or is not ready within
  1.75 s at sign-in, an extractable ES256 key is kept as a JWK in localStorage
  (`wildstat-dpop-backup-key-v1`) and used instead
  (`dpop-key:local-fallback:<why>`). Page script can read it, the same
  exposure as the refresh token already in localStorage, so the
  non-extractable IndexedDB key is preferred for every new sign-in. A grant
  stays on the key it was bound to (`dpopStore` beside `jkt`), whichever store
  holds it.
- A sign-in waits at most 2 s for a key before its token request. DPoP never
  keeps a player out: no key in time (`key-slow`), no WebCrypto, a refused
  proof, or a request that fails only with the header all fall back to a
  plain exchange (`dpop-fallback:exchange:*`). The last two also pause DPoP
  on that browser for a week.
- Only the ID token is used (for SpacetimeDB); nothing sends the access token,
  so no resource request needs a proof.
- Diagnostics: `dpop=bound:idb|bound:local|unbound|off` on sign-in returns
  and refusals, and
  `renewal-chain:days=N;...;dpop=...` once per day a chain keeps renewing.
  A `renewal-chain:days=1;...;dpop=bound:*` row is the proof it works.

## Static-hosting policy limits

GitHub Pages does not provide project-controlled response headers. WildStat
therefore sends CSP through an early `<meta http-equiv>` policy. This blocks
inline scripts, script event attributes, frames, plugins, foreign forms, and
unlisted network connections. Production WebSockets are limited to SpacetimeDB
Maincloud. Plain WebSockets on port 3000 remain available for the documented
local/LAN database workflow; deployed HTTPS pages still apply browser mixed-
content protections. Inline styles remain allowed because the current HUD and
canvas sizing code sets element styles at runtime; executable inline code is
still forbidden.

SpacetimeDB's 2.9 browser SDK compiles its trusted module-schema serializers
and deserializers with the JavaScript `Function` constructor when a connection
is built. The script policy therefore includes `'unsafe-eval'` as a documented
SDK compatibility exception. This weakens the policy's protection against
string-to-code execution, but does not allow inline scripts, event-handler
attributes, third-party script origins, or broader network access. A regression
test ties the exception to the SDK implementation so it can be removed when the
SDK provides a CSP-safe serializer path.

A meta-delivered CSP cannot enforce `frame-ancestors`, report violations with
`report-to`, or supply header-only controls such as Permissions Policy,
Cross-Origin-Opener-Policy, and `X-Content-Type-Options`. If hosting moves behind
a configurable CDN, those should be response headers and
`frame-ancestors 'none'` should be added there.
