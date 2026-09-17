/** Coalesce eye changes; retry only dirty state, never poll the server. */
export function createMultiplayerSync(options: {
  session: () => object | null;
  send: (enabled: boolean) => Promise<unknown>;
}) {
  let wanted = false, acknowledged: boolean | undefined;
  let session: object | null = null, pending: object | null = null;
  let retryAt = 0;
  function reset() { session = null; pending = null; acknowledged = undefined; retryAt = 0; }
  function sync() {
    const current = options.session();
    if (current !== session) { reset(); session = current; }
    if (!current || pending || acknowledged === wanted || Date.now() < retryAt) return;
    const ticket = {}, value = wanted;
    pending = ticket;
    void options.send(value).then(() => {
      if (pending !== ticket || options.session() !== current) return;
      pending = null; acknowledged = value; retryAt = 0;
      sync();
    }, () => {
      if (pending !== ticket) return;
      pending = null; retryAt = Date.now() + 20_000;
    });
  }
  return { sync, reset, enabled: () => wanted,
    setEnabled(value: boolean) { wanted = value; sync(); },
  };
}
