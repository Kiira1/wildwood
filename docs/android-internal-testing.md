# Android closed beta

WildStat uses the existing Android application ID `com.wildstatmmo.preview`.
The native shell bundles the game and connects to the live game server. This
test build retains demo ads. Purchases are disabled until platform billing
is configured; a RevenueCat Test Store key must never enter a Play release.

## Build a Play upload

Use Java 21 in `mobile/.build/jdk21/Contents/Home` and the SDK in `mobile/.build/android-sdk`. Local
`mobile/android/local.properties` points Gradle at that SDK. The SDK and Gradle
cache are ignored build tools, not app assets.

1. Run `npm --prefix mobile run build` after the game version is final (the release stamp moved
   `public/version.json`).
2. From `mobile/`, run Capacitor `sync android` with Node 22 or newer.
3. From `mobile/android/`, run `./gradlew bundleRelease` with `JAVA_HOME` pointing at the Java 21
   directory above. The version code is the game version's own number (`0.901.45` → `9010450`;
   `node mobile/scripts/version-code.mjs` prints it), and the display version is `public/version.json`,
   so the bundle always matches its game. The build refuses when the game copied into the app is a
   different version: run steps 1 and 2 again. `-PwildstatVersionCode=N` still overrides the code.
4. Upload `mobile/android/app/build/outputs/bundle/release/app-release.aab` to
   **Testing → Closed testing** in Play Console (internal testing is no longer used).

The local upload key is `mobile/android/.signing/wildstat-upload.jks`; its
passwords are in ignored `mobile/android/keystore.properties`. Preserve both in
secure backup for future uploads. Do not commit either file. The checked-in
`keystore.properties.example` documents the fields without containing secrets.
Google Play App Signing manages the distributed app's signing key separately.

The app entry, signing agreements, uploaded bundle, selected tester email list,
and published closed release must all be completed before the opt-in link is
usable. Tester addresses are managed in Play Console, not checked into this repo.

## Move existing internal testers to the closed beta

Share `https://wildstatmmo.com/android-beta.html` for the complete enrollment flow.
The configured group is `wildstat-android-beta@googlegroups.com`:
`https://groups.google.com/g/wildstat-android-beta`. Both **Who can see group**
and **Who can join group** are set to anyone on the web. A signed-in nonmember
was verified to see **Join group** and its join dialog on 2026-10-15. Existing
members see membership settings instead, so do not test joining from an owner
or existing member account. Conversation visibility does not need to be public.

Group membership provides eligibility only. Testers must separately select
**Become a tester** at `https://play.google.com/apps/testing/com.wildstatmmo.preview`
with the same account used by their phone's Play Store. On 2026-10-15, the group
had 19 members but the production-access dashboard counted only 3 closed-test
opt-ins. Use that dashboard as the authority, not group size or app confirmation.

On 2026-10-15, the closed track was expanded from 9 countries to all 178 entries
(including Rest of World). The two country changes were submitted and appeared
under **Changes in review**, pending Google's checks/review. New regions are not
available until Google publishes the change.

The internal track is paused and its tester list was deselected and saved on
2026-10-15. Keep all internal lists unselected. The old internal opt-out page is
`https://play.google.com/apps/internaltest/4700797577968294212`; share it only as
an exit route for former internal testers, never as an enrollment invitation.

After internal eligibility was removed, the old internal link was verified to
show **App not available** for an account whose main testing page still showed
**You are a tester** and a Leave button. Do not require the old link as a signup
step. If unavailable, go straight to the main testing page after joining the
Group. Do not tell an already-enrolled closed tester to leave and rejoin. The
generic **You are a tester** page does not identify the track, so it cannot by
itself verify an individual tester's contribution to the closed-test count.

Google requires each internal tester to opt out before opting into a closed test.
Opening the testing link alone does not migrate them. See
[Google's testing guidance](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).

1. In **Closed testing → Manage track → Testers**, keep the Google Group above
   selected. Confirm the closed release is
   published and its country availability covers those testers; internal testing
   can include countries excluded from closed testing.
2. Copy the shareable closed-test link from that page. Existing internal testers
   must open it with their Play Store Google account, choose **Leave the program**
   if it identifies internal testing, then reopen the link and join the closed
   test. Group-based testers must also be members of the configured Google Group.
3. **Internal testing → Pause track**, and deselect its tester lists to remove
   eligibility. Pausing stops internal updates. It does not install
   the closed build on existing phones. Allow several hours for Play changes.
4. Deliver the corrected in-app instructions through a compatible Android OTA
   release (see [OTA delivery](server-config-and-ota.md)). Older builds outside
   the feed's compatibility range need the instructions shared separately;
   publishing a closed build alone cannot reach accounts still in internal testing.

The invite stays available after opening Play and is dismissed permanently only
when the tester explicitly confirms joining. Old `joined` storage values merely
recorded opening the link, so the corrected invite appears again for those users.
Confirmation is self-reported; it is not verification of Play track membership.
The invite now opens the Group, closed opt-in, and old internal opt-out pages
through the existing Capacitor Browser plugin, so no new native method is needed.
The current automatic feed matches build 9010450 (store version 0.901.45), not
the old internal build 861. Those older testers need the enrollment guide shared
with them and must switch through Play themselves; do not widen an OTA baseline
to force an incompatible shell to accept the update.

Google requires 12 testers opted into the closed test continuously for 14 days
before applying for production access. Open testing is available after production
access is granted; a publicly joinable Group is the self-service route meanwhile.
Neither Play Console nor the app can accept opt-in for another tester or credit
their previous internal-testing days toward the closed-test requirement.

Test Store purchases require an explicit `npm --prefix mobile run build -- --test-purchases`
for local development only. Android release builds reject these staged assets.
