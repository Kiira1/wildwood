# Player-flow and loading audit

## Implemented

| Player action / scale case | Previous behavior | Current behavior |
| --- | --- | --- |
| Open a leaderboard with many registered players | Downloaded the union of each stat's top 100; a player below those cutoffs could not find their own rank. Also prefetched at login. | Fetch only the selected stat: top three plus the caller and 50 ranks on either side. At most 104 unique players, with absolute server ranks. Login no longer fetches rankings. |
| Open rankings at rank 50,000 | No nearby ranking data | Indexed position lookup, up to three fixed-size identity pages and 104 entry lookups. No player-table scan in the request. |
| Rapidly change tabs, close/reopen, or change accounts during loading | Late response could replace the current view; errors could reject outside the UI | Request generation/session checks, bounded request deadline, per-open tab cache, and visible retryable errors. |
| Receive a boss reward or another update through the shared progress helper | Full population scan and six sorts inside the reward transaction | Progress applies immediately; rankings rebuild through existing periodic maintenance. |
| Connect while public chat is busy | Subscribed to all 200 retained public rows, kept/rendered 100 | Live view/cache carries the latest 50. Cursor procedure returns older pages of 50 only when requested. |
| Read old chat while new messages arrive | Oldest rows could be shifted away | Freeze the reading window; preserve the message anchor when prepending history. Latest messages action returns to live chat. |
| Repeatedly reach the top while a page is loading | No history loading | One in-flight page per conversation, strict before-ID cursor, deduplication, retry after errors, and a bounded history cache. |
| Switch guild/DM/account during a history request | New paging risk | Discard late pages. Membership and blocks are rechecked on the server for every private/guild page; client history resets on access-context changes. |
| Have many DM conversations | Up to all retained messages loaded into client | Live view returns at most 50 guild + 50 DM messages total. Opening a conversation fetches that conversation's latest 50; older pages are on demand. |
| Send a private message using a selected player's identity | Scanned every profile, even for an exact identity | Primary-key lookup; typed display-name lookup still checks ambiguity. |
| Close a profile before subscription readiness, or time out | Unsubscribe could throw while pending | Finish the cancelled request immediately; unsubscribe safely when a late subscription becomes active. Generation prevents same-player reopen races. |
| Leave chat running across thousands of distinct senders | Presentation/identity caches accumulated indefinitely | Prune inactive metadata above 2,048 identities; retain the current player and in-use presentations. Old message profiles can reload by validated identity. |
| Portal request fails while destination assets reject | Asset rejection could escape before being awaited | Attach rejection handling immediately, while still surfacing asset failure for an accepted transition. |

## Retention and freshness

- Public history keeps the existing server retention: up to 200 messages and 24 hours. Pagination cannot retrieve messages already deleted by retention. Private/guild conversation history retains its existing 100-message cap; DM account pruning remains in place.
- Ranking snapshots retain the existing 15-minute cadence. New accounts can show the first 100 until their first snapshot. Nearby windows clip at the start/end of rankings and deduplicate podium players.
- Protocol 103 coordinates the new procedures/views with the matching client. Schema additions preserve existing player data; no destructive migration is required.

## Remaining scale limits to measure before a large launch

- **Periodic ranking construction still scans all saved players and sorts six times.** Indexed reads bound request work, not the shared snapshot build. Maintenance and some administrative/reset/migration actions still rebuild a snapshot. Benchmark this transaction on a populated staging host before claiming 100,000-player capacity; a batched/generation-swapped ranking worker is the next step if it stalls gameplay.
- **Public chat still fans out each message to all subscribed clients.** A 50-row cache does not reduce the number of new messages generated. At very high concurrent chat volume, channels/rooms or publication batching will be needed. Cursor pages gracefully end if retention has already removed the older rows.
- **Guild/developer name tags still use a global public subscription.** This is separate from leaderboard records and grows with tagged accounts. Replace it with presentation-scoped tags before a very large population launch.
- **Typed username resolution still scans profiles** to detect ambiguous names. Selected friend identities now use direct lookups; a normalized-name index is the next step for large-scale discovery.
- Shop duplicate-click/receipt retry protections and map travel timeout/reconnect guards already have regression coverage. This audit does not certify production concurrency or replace a device/network soak test.

## Verification

Tests exercise bounded ranking reads at 10 and 100,000 simulated players, absolute/tied ranks, removed players, tab races, cursor paging during new arrivals, duplicate scroll events, stale conversation responses, access checks, profile close/reopen/timeout, and sender-cache eviction. The 100,000-player case verifies query bounds, **not** 100,000 concurrent connections or full snapshot-build throughput. User owns visual/device review.
