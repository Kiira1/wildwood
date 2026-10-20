/**
 * Rocks and trees are broken on the client and reported in batches, as kills are: report_mining and report_chopping
 * take every break since the last report, each with when it happened, and the server judges them in order.
 */

/** One break in a report: the rock or tree and when it broke, in the server's epoch ms. */
export type GatherClaim = { id: number; atMs: number };

/** The client sends its queued breaks this long after the first, or sooner (GATHER_QUEUE_CAP, leaving, page hide). */
export const GATHER_FLUSH_MS = 20_000;
/** A queue this long is sent at once. */
export const GATHER_QUEUE_CAP = 20;
/** The most breaks one report may carry; a longer one is malformed and refused whole. */
export const GATHER_REPORT_MAX = 64;
/** A break claimed further back than this counts as this long ago: breaks cannot be banked. */
export const GATHER_CLAIM_MAX_AGE_MS = 90_000;
/** How far past the server's now a claimed time may run: the client's estimate of the server clock wanders a little. */
export const GATHER_CLAIM_AHEAD_MS = 2_000;
/** How far a claimed time may be off the server's clock either way when reach is judged: the walk in it is allowed too. */
export const GATHER_CLOCK_SLACK_MS = 2_000;
