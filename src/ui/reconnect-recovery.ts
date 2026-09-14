/** Escalate an extended reconnect to an explicit, session-preserving reload. */
export function createReconnectRecovery(options: {
  now: () => number;
  retry: () => void;
  reload: () => boolean;
}) {
  let startedAt: number | null = null;
  function update(visible: boolean) {
    if (!visible) startedAt = null;
    else if (startedAt === null) startedAt = options.now();
    return startedAt !== null && options.now() - startedAt >= 30_000;
  }
  return {
    update,
    activate() {
      if (startedAt !== null && options.now() - startedAt >= 30_000 && options.reload()) return;
      options.retry();
    },
  };
}
