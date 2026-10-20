/**
 * When the server ran the reducer behind a row callback, in epoch ms, for one of this client's own calls; null for
 * anyone else's (the SDK gives no time for those) and for rows from a subscription.
 */
export function reducerEventMs(ctx: unknown): number | null {
  const event = (ctx as { event?: { tag?: string; value?: { timestamp?: { microsSinceUnixEpoch?: unknown } } } } | null | undefined)?.event;
  const micros = event?.tag === "Reducer" ? event.value?.timestamp?.microsSinceUnixEpoch : undefined;
  return typeof micros === "bigint" ? Number(micros / 1_000n) : null;
}
