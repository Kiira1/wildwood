import { table, t, SenderError } from "spacetimedb/server";
import type { ModuleReducerCtx } from "./index";
import { readPlayerProgress } from "./wide-stats";
import { ERASURE_ROW_BUDGET, eraseIdentityRows } from "./account-erasure";

/** Authenticated requests awaiting the full database and auth-provider erasure workflow. */
export const accountDeletionRequest = table({ name: "account_deletion_request", public: false }, {
  identity: t.identity().primaryKey(), requestedAt: t.timestamp(), status: t.string(),
});
export function queueAccountDeletion(ctx: ModuleReducerCtx, confirmation: string) {
  if (confirmation !== "DELETE") throw new SenderError("Confirm account deletion first.");
  if (!readPlayerProgress(ctx, ctx.sender)) throw new SenderError("Connect to your character first.");
  if (ctx.db.accountDeletionRequest.identity.find(ctx.sender)) return;
  ctx.db.accountDeletionRequest.insert({ identity: ctx.sender, requestedAt: ctx.timestamp, status: "pending" });
}

/**
 * One erasure pass (eraseIdentityRows) over every identity of the account. The request row is among the
 * rows it deletes, so an erasure that runs out of budget puts it back as "erasing": the developer
 * console keeps showing the account until a pass finishes it.
 */
export function eraseKeepingRequest(ctx: any, identities: readonly any[], budget = ERASURE_ROW_BUDGET) {
  const request = identities.map(identity => ctx.db.accountDeletionRequest.identity.find(identity)).find(Boolean);
  const result = eraseIdentityRows(ctx, identities, budget);
  if (!result.complete && request && !ctx.db.accountDeletionRequest.identity.find(request.identity)) {
    ctx.db.accountDeletionRequest.insert({ ...request, status: "erasing" });
  }
  return result;
}
