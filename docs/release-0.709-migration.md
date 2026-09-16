# Release 0.709 migration

This release moves the client/server protocol from 104 to 105. The live duel and
saved replay rows each gain two trailing string columns:
`challenger_weapon_item` and `opponent_weapon_item`, defaulting to an empty string.
They preserve the actual weapon independently of hidden cosmetic appearance.
Existing replays retain the visible-weapon/legacy-bow fallback.

Maincloud preflight confirmed automatic data-preserving migration on the root
and every ready map. These four columns are the only schema changes. They do
change the binary row layout and disconnect old clients, so this is a coordinated
protocol migration, not the normal compatible rollout. Protocol 104 must not be
added to the supported list for these new bindings.

Release order:

1. Build and verify web, signed Android 709 and iOS 709 artifacts; install iOS and
   publish Android internal testing. Push the matching web release.
2. Recheck root and map migration plans, accepting only these four defaulted
   columns. Pause through the existing release notice without a countdown, wait
   for progress acknowledgements, and cancel if saves do not acknowledge.
3. Publish root using the CLI's explicit `--break-clients --delete-data=never`.
   Keep the ordinary compatible-only release helper unchanged.
4. Stage the same new map program and publish ready maps with at most three
   simultaneous publishes, applying the same data-preservation checks.
5. Complete the release notice. Older native clients need the 0.709 package;
   web clients use their existing update/reload recovery.

No tables or player data are cleared. Do not revert the schema by removing the
new columns after publication. Any emergency code rollback must preserve them.
