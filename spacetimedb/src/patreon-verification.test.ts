import { describe, expect, it } from "vitest";
import { verifyPatreonIdentity } from "./patreon-verification";
const config = { campaignId: "10", silverTierId: "20", goldTierId: "30" };
function payload(tier = "20", campaign = "10", patron = "active_patron", paid = "Paid") {
  return { data: { id: "1", type: "user", relationships: { memberships: { data: [{ type: "member", id: "2" }] } } }, included: [{
    id: "2", type: "member", attributes: { patron_status: patron, last_charge_status: paid },
    relationships: { campaign: { data: { id: campaign } }, currently_entitled_tiers: { data: [{ id: tier }] } },
  }] };
}
describe("Patreon frame verification", () => {
  it("matches the authenticated user's exact campaign and paid tier", () => {
    expect(verifyPatreonIdentity(payload(), config)).toEqual({ userId: "1", tier: "silver" });
    expect(verifyPatreonIdentity(payload("30"), config).tier).toBe("gold");
    expect(verifyPatreonIdentity(payload("30", "999"), config).tier).toBe("none");
    const unrelated = payload(); unrelated.data.relationships.memberships.data[0].id = "other";
    expect(verifyPatreonIdentity(unrelated, config).tier).toBe("none");
  });
  it.each(["Declined", "Pending", "Refunded", "Fraud", "Deleted"])("does not grant access for a %s charge", charge => {
    expect(verifyPatreonIdentity(payload("30", "10", "active_patron", charge), config).tier).toBe("none");
  });
  it("rejects former, free, and trial memberships", () => {
    expect(verifyPatreonIdentity(payload("30", "10", "former_patron"), config).tier).toBe("none");
    expect(verifyPatreonIdentity(payload("unknown"), config).tier).toBe("none");
    const trial = payload(); Object.assign(trial.included[0].attributes, { is_free_trial: true });
    expect(verifyPatreonIdentity(trial, config).tier).toBe("none");
  });
  it("fails closed if identity or membership permissions are missing", () => {
    expect(() => verifyPatreonIdentity({}, config)).toThrow();
    expect(() => verifyPatreonIdentity({ data: { id: "1", type: "user" } }, config)).toThrow();
  });
});
