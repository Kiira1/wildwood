# Server configuration and controlled app updates

## What can change without an app release

Developer controls → Map balancing now includes enemy and boss stats/rewards, enemy speed, item drop multipliers, enemy/boss respawn times, boss regeneration, and Endless scaling. The preview shows the resulting timings, regeneration and drop chances. Zero disables drops or regeneration.

One server-owned configuration snapshot is pinned to each player's map visit. It is fetched with map entry, not polled during combat. Reconnecting keeps that snapshot; leaving and returning gets the latest revision. Rewards, drop rolls and defeat-rate validation use that player's snapshot. Restoring an earlier balance creates a new revision; it does not rewrite player saves.

The old `get_map_balance` procedure stays available. It leaves respawn/regen/drop behavior unchanged for older apps. The new `get_map_configuration` procedure opts updated apps into those fields. Publish the server module before shipping the new client. Existing settings automatically gain 1× defaults; this update does not change the live balance by itself.

## OTA scope

OTA replaces the packaged HTML, JavaScript, CSS and art. It does not replace native code or migrate server tables. Native dependencies/configuration, protocol changes and save-format changes require the normal native release. Packaging checks a native-source fingerprint as well as explicit compatibility versions.

A first iOS/Android release containing this updater is required. Already installed 0.742 apps do not contain it. The new native build number must be unique; do not reuse 742 for the bootstrap release.

No channels are published by installing this code. Web deployments and store releases continue to work normally. OTA bundles are full compressed web bundles for now, not binary deltas.

## Signing and storage

The signing private key is `local-data/ota/signing-private.pem` (ignored, mode 0600). Back it up securely. Never commit it, put it in `public/`, or include it in an upload. The public key is in `mobile/ota/public-key.json` and the native Capacitor configuration. Key rotation requires a new native release.

Both the channel announcement and ZIP are RSA/SHA-256 signed. The native plugin also verifies the ZIP checksum/signature before staging it. Failed downloads leave the current app in place. Successful downloads apply at the next cold launch, never by restarting an active game.

Announcements live at `/ota/developer-ios.json`, `/ota/developer-android.json`, `/ota/production-ios.json`, and `/ota/production-android.json`. They have no-store caching and CORS headers. ZIP files need an HTTPS artifact host that accepts large files, such as a public GitHub release or object storage; they must not go in the Cloudflare static-assets directory (25 MB per-file limit).

Native startup has a 30-second rollback watchdog. A rendered sign-in shell acknowledges startup without requiring a working network or account login. Failure to load/initialize the deferred game bundle before its first rendered frame also restores the installed app. The installed bundle is the final fallback; it will not be automatically reloaded in a loop. Later gameplay bugs need a signed rollback announcement or developer rollback. This is not a guarantee that every gameplay bug can be detected automatically.

Unused downloaded bundles are removed by the native plugin after successful startup. Rollback to a previous OTA may therefore redownload it. Keep published artifacts available. Neither automatic nor manual rollback changes account tokens, save data, rewards or database state.

## First native release

1. Bump the release/native build numbers through the normal workflow.
2. `npm --prefix mobile run sync` and build the actual native binaries.
3. Record each binary's baseline, substituting its real build number:

```sh
npm --prefix mobile run ota -- baseline --platform android --build BUILD_NUMBER
npm --prefix mobile run ota -- baseline --platform ios --build BUILD_NUMBER
```

Baselines are stored under ignored `local-data/ota/baselines/`. Record the baseline when building/distributing that binary, not after editing its native dependencies. Archive it alongside the native release artifacts. A missing baseline blocks OTA packaging.

## Prepare and test an OTA

Build current web assets, then create an immutable artifact for one platform/native build:

```sh
npm --prefix mobile run build
npm --prefix mobile run ota -- package --platform android --build BUILD_NUMBER --id UNIQUE_BUNDLE_ID
```

This writes `mobile/.build/ota/UNIQUE_BUNDLE_ID/bundle.zip` and `artifact.json`. Upload that ZIP unchanged to an HTTPS artifact host. A helper can upload it as a GitHub prerelease to the existing public repository:

```sh
npm --prefix mobile run ota -- upload --artifact mobile/.build/ota/UNIQUE_BUNDLE_ID --repo Tydoskus/wildwood
```

This command publishes an artifact, not a production channel. It prints the URL for the next step. Stage it:

```sh
npm --prefix mobile run ota -- stage --artifact mobile/.build/ota/UNIQUE_BUNDLE_ID --url HTTPS_ARTIFACT_URL
```

The stage command downloads the hosted ZIP to verify its checksum before writing a signed developer announcement. Deploy the resulting `public/ota/developer-android.json` through the web deployment workflow. Repeat with a distinct artifact ID for iOS.

On a developer account, open Developer controls → App updates → Use developer channel. Check for updates, fully close and reopen the app, and test startup, login, combat, map changes, saves, and Restore installed app. The installed version remains available as the fallback. Test-channel checks wait for developer access; signing out of developer access cancels staged test updates.

Promote only the exact bundle that passed device testing:

```sh
npm --prefix mobile run ota -- promote --platform android --id UNIQUE_BUNDLE_ID --tested-on-device
```

This writes the production announcement; it does not push or deploy it. Deploy that file to make it available to compatible production clients. Promotion preserves the tested URL, digest and signature. The command's device-test flag is an explicit operator confirmation, not a fabricated test result.

Checks occur on startup/resume, throttled to 15 minutes, plus the developer's manual Check button. There is no combat polling. Players on different native builds ignore an incompatible announcement and keep their installed app. A feed currently targets one exact native build; publish a new native release when native compatibility changes.

## Rollback

Restore the installed/store version for one channel/build:

```sh
npm --prefix mobile run ota -- rollback --platform android --channel production --installed --build BUILD_NUMBER
```

Or restore a previous signed announcement from `local-data/ota/history/`:

```sh
npm --prefix mobile run ota -- rollback --platform android --channel production --announcement PATH_TO_PREVIOUS_SIGNED_JSON
```

Deploy the newly written channel file. Rollbacks use an increasing sequence, so clients can reject stale CDN announcements without rejecting an intentional rollback. Clients need to reach the feed and cold-launch to apply it. An offline client cannot receive a remote rollback.

Developer controls also has Restore installed app for immediate local testing on the next launch. Startup failures block the offending bundle ID; publish a fixed update with a new ID instead of changing an existing artifact.

## Verification before first production OTA

Automated tests cover compatibility, real RSA signature tampering, download failures, channel changes/revocation, stale manifests, saved developer-channel authorization, rollback, and preservation of account storage. Native compile checks verify plugin integration. A physical-device download/apply/rollback smoke test is still required before promoting the first production bundle.
