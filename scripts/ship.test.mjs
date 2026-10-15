import { describe, expect, it } from "vitest";
import { planShip } from "./ship.mjs";

describe("npm run ship order", () => {
  it("ships a client-only release by pushing and waiting for the deploy", () => {
    expect(planShip({ clientAhead: true, server: "none" }).steps).toEqual(["push", "wait-for-deploy", "announce"]);
  });
  it("publishes a compatible server first: a new client may need it, old clients work on it", () => {
    expect(planShip({ clientAhead: true, server: "compatible" }).steps).toEqual(["publish", "push", "wait-for-deploy", "announce"]);
    expect(planShip({ clientAhead: false, server: "compatible" }).steps).toEqual(["publish"]);
  });
  it("publishes a client-breaking server last, once the new client is live", () => {
    expect(planShip({ clientAhead: true, server: "breaking", allowClientBreak: true }).steps).toEqual(["push", "wait-for-deploy", "publish-breaking", "announce"]);
    // Pushed already (the post-commit hook): it still waits until the sites serve it.
    expect(planShip({ clientAhead: false, server: "breaking", allowClientBreak: true }).steps).toEqual(["wait-for-deploy", "publish-breaking"]);
  });
  it("tells open tabs about a new client unless asked not to", () => {
    expect(planShip({ clientAhead: true, server: "none", announce: false }).steps).toEqual(["push", "wait-for-deploy"]);
    expect(planShip({ clientAhead: false, server: "compatible" }).steps).toEqual(["publish"]);
  });
  it("refuses a client-breaking server without the flag, and refuses when nothing is new", () => {
    expect(planShip({ clientAhead: true, server: "breaking" }).refuse).toMatch(/--allow-client-break/);
    expect(planShip({ clientAhead: false, server: "none" }).refuse).toMatch(/Nothing to ship/);
  });
});
