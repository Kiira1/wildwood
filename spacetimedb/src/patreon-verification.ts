import type { AvatarFrame } from "../../shared/avatar-frames";

type Resource = { id?: string; type?: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: unknown }> };
const resource = (value: unknown): Resource => value && typeof value === "object" && !Array.isArray(value) ? value as Resource : {};
const relatedId = (value: unknown) => typeof resource(value).id === "string" ? resource(value).id : undefined;

/** Require the authenticated user's membership in our exact campaign and tier.
 * Amount alone cannot distinguish a paid tier from a custom donation elsewhere. */
export function verifyPatreonIdentity(payload: unknown, config: { campaignId: string; silverTierId: string; goldTierId: string }): { userId: string; tier: AvatarFrame } {
  const body = payload as { data?: unknown; included?: unknown[] } | null;
  const user = resource(body?.data);
  if (user.type !== "user" || !user.id || !/^\d+$/.test(user.id)) throw new Error("Invalid Patreon identity");
  const memberships = user.relationships?.memberships?.data;
  if (!Array.isArray(memberships)) throw new Error("Patreon membership permission is missing");
  const memberIds = new Set(memberships.map(relatedId));
  let tier: AvatarFrame = "none";
  for (const value of body?.included ?? []) {
    const member = resource(value);
    if (member.type !== "member" || !memberIds.has(member.id) || relatedId(member.relationships?.campaign?.data) !== config.campaignId) continue;
    const attrs = member.attributes;
    if (attrs?.patron_status !== "active_patron" || attrs.last_charge_status !== "Paid" || attrs.is_free_trial === true) continue;
    const entitled = member.relationships?.currently_entitled_tiers?.data;
    if (!Array.isArray(entitled)) continue;
    const tiers = new Set(entitled.map(relatedId));
    if (tiers.has(config.goldTierId)) tier = "gold";
    else if (tier !== "gold" && tiers.has(config.silverTierId)) tier = "silver";
  }
  return { userId: user.id, tier };
}
