type TransportActivity = {
  isActive: boolean;
  readonly isDisconnectRequested: boolean;
  readonly isSocketClosed: boolean;
};

/** Keep the SDK's queued sends and the game's connection checks in agreement. */
export function guardConnectionActivity<T extends TransportActivity>(connection: T): T {
  // SpacetimeDB 2.9 keeps isActive true until onclose, even after disconnect()
  // or a silently closed socket. Its deferred v3 flush only checks isActive.
  // Preserve the SDK's writes to the flag, but make reads reflect shutdown
  // immediately. This also lets our existing resume/retry logic see dead sockets.
  let active = connection.isActive;
  Object.defineProperty(connection, "isActive", {
    configurable: true,
    enumerable: true,
    get: () => active && !connection.isDisconnectRequested && !connection.isSocketClosed,
    set: (value: boolean) => { active = value; },
  });
  return connection;
}
