# Patreon supporter frames

## Tiers

| Tier | Monthly USD | Frame choices | Patreon tier ID |
| --- | --- | --- | --- |
| Silver Supporter | $4.99 | None, Silver | 29608023 |
| Gold Supporter | $9.99 | None, Silver, Gold | 29608155 |

Frames are cosmetic and require a currently verified paid membership. A custom
payment amount alone never grants a tier. There are no stat or gameplay benefits.

## Player flow

Open your profile, tap the profile picture, and choose **Connect Patreon** in
the frame picker. Registered accounts link through Patreon's OAuth consent page;
no matching-email assumption is made. Return to the game and choose a frame.
Only one WildStat character can claim a given Patreon account at a time.
Disconnect removes the stored tokens, membership link, and pending OAuth request.
It does not cancel a Patreon subscription. Account deletion removes the link too.

The frame is applied to HUD/profile portraits, full chat, private conversation
portraits, and leaderboard row portraits. PNG overlays preserve layout and clicks.

## Verification and cost

The root server exchanges OAuth codes and checks the exact campaign and tier IDs
using `identity identity.memberships` scope. No email or payment details are requested.
Configuration, tokens, Patreon identifiers, and pending requests are private tables.
Only frame/tier/expiry are returned to other players in batches of at most 50.

An online linked player refreshes membership every 30 minutes. A manual Refresh or
opening the picker also checks, with a server limit of once per minute. Failed
requests never extend the six-hour verification lease. An expired lease hides the
frame until another successful check. Loss of entitlement is therefore eventual,
not instantaneous: normally within 30 minutes for an online player, at most the
remaining lease during an outage. Remote portraits cache the result for five minutes.

OAuth state uses 32 browser-generated cryptographically random bytes, expires after
10 minutes, and is claimed before network I/O. Callback replay, unlink during a
request, and account switching are guarded. Credential rotation is stored before
the next API request, so a temporary outage does not lose a rotated refresh token.

## Activation

The Patreon page, tiers, and API client are created. Campaign **16796225** and both
tier IDs/prices were verified through Patreon's API. Credentials are stored with
owner-only permissions in ignored `local-data/patreon/config.json`; live database
configuration is pending deployment of the supporter module. Do not describe frames as live
until a real paid membership has passed the end-to-end check.

Client form:

- Name: WildStat Supporter Frames
- Category: Member Benefits; API v2
- Domain: wildstatmmo.com
- Privacy: https://wildstatmmo.com/privacy.html
- Terms: https://wildstatmmo.com/terms.html
- Redirect: https://maincloud.spacetimedb.com/v1/database/wildwood-coop/route/patreon/callback

For a future credential replacement, verify the campaign ID from Patreon. Put its
client ID, secret, campaign ID, two tier IDs, and redirect URI in a **private**
`local-data/patreon/config.json` file (ignored by Git), with permissions `600`:

```json
{
  "clientId": "FROM_PATREON",
  "clientSecret": "FROM_PATREON",
  "campaignId": "16796225",
  "silverTierId": "29608023",
  "goldTierId": "29608155",
  "redirectUri": "https://maincloud.spacetimedb.com/v1/database/wildwood-coop/route/patreon/callback"
}
```

Use the normal release process to deploy the module, web client, native bridge,
and privacy disclosure. No changes to existing table columns are required.
With `WILDSTAT_ROOT_DATABASE` and `WILDSTAT_SHARD_OPERATOR_TOKEN` supplied through
the normal private deployment environment, validate and then configure:

```sh
node scripts/configure-patreon.mjs local-data/patreon/config.json
node scripts/configure-patreon.mjs local-data/patreon/config.json --apply
```

The script never prints secrets or places them in command arguments. Do not put
Patreon secrets in Vite environment variables, browser storage, or mobile builds.
No creator access token is needed for player membership checks.

Before announcing availability, verify consent/callback with a real supporter,
Gold/Silver choices, a second character's duplicate-link rejection, and disconnect.
Remove “coming with the supporter update” from the tier descriptions when live.
