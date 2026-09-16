# Chat performance audit — September 15, 2026

## Implemented

- Keep cursor-based requests at 50 messages. Public retention stays 24 hours; private messages remain persistent. These are server retention rules, independent of client cache limits.
- Full chat now mounts a measured, variable-height window with six rows of overscan on either side and a hard maximum of 60 mounted message rows. Mini chat still mounts two rows. The existing 500-message history cache holds text, not hundreds of portraits, handlers, and animated frames.
- Preserve a message ID and pixel offset across prepends and measured-height corrections. Select the new window around that anchor before mounting it. Cached originals can be found without another history request.
- Fetch older pages within 240 pixels of the top, once per in-flight request. Session/conversation generation checks discard stale responses. An evicted newer end is marked detached so it cannot silently masquerade as current chat; the existing down arrow returns to latest.
- Guard unchanged refreshes before layout measurements. Coalesce subscription notifications and scroll events to one animation frame. Keep keyed, unchanged DOM nodes attached, including portraits and gender/power images.
- Build guild/private message indexes once per social revision. Public block/reply filtering is cached per presentation revision. Scrolling does not rebuild unread metadata or private-conversation lists. Hidden conversation lists release their portrait DOM.
- Batch textarea autosizing per frame and prevent Enter/line-break submission during IME composition.

## Evidence and scope

Regression tests exercise 1,000 unchanged notifications with zero message reads/layout measurements, 100 notifications coalescing into one frame, variable-height prepends without moving the visible message, incoming traffic while reading history, a bounded mounted window, original jumps, session changes, privacy-cache invalidation, and mobile IME input. Full unit suite: 2,445 passing at this change. Client build and TypeScript checks pass.

These establish bounded work and correctness, not a measured phone frame rate. Visual/device testing belongs to the user. No claim of a measured FPS improvement is made.

## Follow-up after 0.709

The initial window moved at every visible row boundary, despite retaining six extra rows on each side. It now consumes that buffer before refilling, with two rows remaining at the approaching edge. Ordinary scrolling therefore keeps the same mounted rows for longer.

Refresh previously assigned `scrollTop` even when the target was unchanged. It now writes only for an actual position correction, while retaining anchor restoration for history prepends and variable-height measurements. Unchanged spacer heights also avoid style writes. Regression coverage verifies overscan reuse, no scroll-position writes for incoming traffic while reading history, and continued anchor preservation. Phone momentum scrolling still needs user verification.

## Remaining server scaling work

Public history normally reads a bounded page through the public-chat cursor. Social history returns only 50 messages but currently scans/sorts the selected conversation on the server. Live social views and conversation summaries also scan a user's authorized history. With persistent DMs this cost can grow even though the browser stays bounded.

A separate server optimization should introduce an indexed per-conversation sequence/cursor and incrementally maintained conversation summaries, with migration/backfill and privacy/deletion tests. Merely increasing the client cache or converting reducers into procedures would not solve those scans. Keep this separate from the browser rendering fix to avoid a broad social schema migration in the same change.

## Release note

The accompanying duel fix adds defaulted actual-weapon fields to duel and replay records, separate from cosmetics, and regenerates bindings. Protocol 105 must ship with the matching root/map modules and clients; protocol 104 has the old wire layout. Game release remains paused at the user's request.
