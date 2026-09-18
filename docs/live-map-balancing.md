# Live map balancing

Settings → Developer tools → Balance. Choose a campaign map or Endless, edit
multipliers, review the **server preview**, then Apply changes. The displayed
version is independent of the app version. Values are stored on the account
server, so changing them requires no deployment or app rebuild after 0.742.

- 1× means the authored base value, 0.5× halves it, 2× doubles it.
- Enemy health, damage, reward amount and movement speed are independent.
- Boss health, attack damage and reward amounts are independent.
- Endless adds controls for its reward multiplier, stat growth, health growth
  and slowdown exponent. The map number previews a depth; it does not limit
  which Endless maps receive the change.
- Reset this map resets draft multipliers. Apply is still needed.
- Restore previous balance creates another version using the previous settings.
  It changes balance only, never player saves or earned progress.

The server pins a resolved snapshot to a character's map visit. The client gets
one small snapshot on entry, deduplicates concurrent loading requests and caches
it for that visit. Combat waits for that reply. Reconnecting preserves the pin;
travel refreshes it. Existing boss damage is not reset by changing configuration.
The reward reducer and DPS validation read the same pinned values. No polling,
per-frame network calls, or mass writes to online players occur on an edit.

Developer authorization is enforced server-side. Saves use an expected revision
so two editors cannot silently overwrite each other. Private historical rows
record the editor, timestamp and complete settings. New player pins are created
only after the client requests the new API; older app builds retain the legacy
compiled balance path until upgraded. Install 0.742 to participate in live tuning.

This editor changes balance numbers, not enemy artwork, map layouts, attack
patterns, equipment definitions or new game mechanics. Those still need code
releases. Default definitions and the Balance Lab remain the authored baseline;
editor changes are explicit overrides, not edits to source files.
