# Connection investigations

`connection_diagnostic` is private, owner-readable operational history. The server
attaches the authenticated account identity and current character name; a client
cannot select another account as the event owner. Fields describe client-reported
observations, not proof of a server-side cause. Guests are included.

Find a player's events with one SQL statement, then sort `occurred_at` locally:

```sql
SELECT * FROM connection_diagnostic WHERE player_name = 'Acegallaidol'
```

Use `identity` for subsequent lookups if the player changes their name. Each row
has `kind`, `map_id`, `client_version`, original client time (`occurred_at`), server
receipt time (`received_at`), and `details_json` containing:

- Account vs. map transport, database, connection phase, and retry attempt.
- Raw WebSocket close code, clean-close flag, sanitized close reason, and whether
  this client requested the close. Code 1006 means an abnormal close; browsers
  usually provide no more specific cause. Generic error events remain generic.
- Connection age, approximate map residence time, latest measured round-trip
  latency, account-server activity age, page visibility, online hint, and broad
  web/native device class. The online hint is not a connectivity guarantee.
- Portal start/completion/failure and destination; map `reconnected` means its
  subscription hydrated. A Home-origin portal's API acknowledgment can precede
  destination hydration, so correlate that completion with the map event.
- Session-block reasons, actual title-screen transitions after gameplay, deliberate
  sign-out/update reload, client-requested connection resets, and page lifecycle.

Unexpected closes are captured before the SDK discards CloseEvent details. The
transport preserves the SDK temporary-token exchange and tagged raw/gzip/Brotli
frames. Diagnostic failures cannot throw into socket callbacks. Auth exchange
errors retain HTTP status: temporary verification failures retry without deleting
saved credentials; explicit unauthorized/forbidden responses retain reauthentication.

Events persist in the tab's session storage across reconnects and reloads, bounded
to 80. They are uploaded in batches of 12 every 15 seconds when connected, and at
account hydration. Queued events are sent only under their original identity;
failed uploads retain event IDs and server retries are idempotent. Events generated
before an identity is known, or in a tab closed before delivery, may be unavailable.
Separate account-shell and game bundles share one collector. There is no additional
subscription or per-frame/per-movement diagnostic reducer.

Retention is seven days with a 50,000-row cap, enforced by the existing 15-minute
telemetry cleanup. Each identity may submit at most 120 events per minute. All
input is bounded and normalized again on the server. Tokens, full URLs, email
addresses, message contents, and raw user agents are not collected.

Rollout requires publishing the root module before the matching web/mobile client.
No protocol bump or destructive schema migration is required; old clients continue
working. Map clients report through their account connection; map-only modules do
not expose the diagnostic reducer. Existing older builds cannot retroactively
supply these details.
