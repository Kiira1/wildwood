# Release 0.709 migration

This release moves the client/server protocol from 104 to 105. The live duel and
saved replay rows each gain two trailing string columns:
`challenger_weapon_item` and `opponent_weapon_item`, defaulting to an empty string.
They preserve the actual weapon independently of hidden cosmetic appearance.
Existing replays retain the visible-weapon/legacy-bow fallback.

Maincloud preflight confirmed automatic data-preserving migration on the root
and every ready map. These four columns are the only schema changes. They do
change the binary row layout and disconnect old clients, so this is a coordinated
protocol migration, not the normal compatible rollout. Protocol 104 must not receive these new row layouts. The compatibility hotfix
below restores its gameplay access while filtering expanded duel rows.

Release order:

1. Build and verify web, signed Android 709 and iOS 709 artifacts; install iOS and
   publish Android internal testing. Push the matching web release.
2. Recheck root and map migration plans, accepting only these four defaulted
   columns. Use the existing release notice with its minimum 30-second countdown, wait
   for progress acknowledgements, and cancel if saves do not acknowledge.
3. Publish root using the CLI's explicit `--break-clients --delete-data=never`.
   Keep the ordinary compatible-only release helper unchanged.
4. Stage the same new map program and publish ready maps with at most three
   simultaneous publishes, applying the same data-preservation checks.
5. Complete the release notice. Older native clients need the 0.709 package;
   web clients use their existing update/reload recovery.

No tables or player data are cleared. Do not revert the schema by removing the
new columns after publication. Any emergency code rollback must preserve them.

Execution note: the scheduled attempt cancelled after eight missing save
acknowledgements. Follow-up inspection found most remaining sessions were hidden
browser tabs; this was not treated as proof of a successful save. The user
explicitly requested the immediate hotfix and deferred diagnosis. The matching
server migration therefore used the immediate path, preserving database data and
existing client reward queues. The cancelled release notice was left cancelled;
no acknowledgements were fabricated and the standard compatible rollout guard
was not weakened. Review suspended-session acknowledgement handling separately.


## Immediate older-app compatibility hotfix

The initial protocol requirement blocked older installed clients. Normal gameplay
now accepts protocols 104 and 105; protocol 103 remains blocked. An indexed
`duel_wire_access` lookup table and server-enforced visibility filters prevent protocol
104 clients from receiving the expanded `duel` or `duel_replay` rows. Protocol 105
registration grants access to all historical combat versions; registering 104
revokes it. Duels require both players to use 0.709 or newer. Existing sessions
are backfilled through an owner-only reducer. No client rebuild is required for
this compatibility recovery. Previously blocked apps may need one restart.

The bridge changes only row visibility and adds a protocol lookup table. All saved duel
and player data remain intact. The separate bindings stay unchanged; do not
remove the visibility filters while protocol 104 is accepted.


Live subscription verification caught two additional SpacetimeDB requirements:
RLS join lookup tables must be public, and join columns must be indexed. The
lookup contains only opaque public player identities and combat format numbers.
After correcting both, real WebSocket subscriptions passed with protocols 104
and 105. Server schema preflight and mocked reducer tests alone did not exercise
these query execution requirements. Preserve this live subscription check in
future migrations involving visibility filters.
