import { expect, it, vi } from "vitest";
import { Identity, Timestamp } from "spacetimedb";
import { crystalFixture, server } from "../../tests/helpers/crystal-hollows-fixture";
import { parseReleaseWindow } from "../../shared/release-window";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));
const owner = Identity.fromString("c200383520521c925f3cf6deafb20cd6a7d6168d1c31cb3c0ddb731c197a2d79");
const args = { id: "release-1", version: "0.696", phase: "scheduled", startsAt: 310000, reload: true };
it("allows only the owner to schedule and leaves the existing presence schema untouched", () => {
  const f = crystalFixture();
  expect(() => f.run(server.setReleaseWindow, args)).toThrow("owner");
  f.ctx.sender = owner; f.run(server.setReleaseWindow, args);
  expect(f.db.worldStatus.id.find(0)).toBeFalsy();
  expect(parseReleaseWindow(f.db.releaseNotice.id.find(0).releaseJson)?.phase).toBe("scheduled");
  expect(() => f.run(server.setReleaseWindow, { ...args, id: "other" })).toThrow("already scheduled");
  expect(() => f.run(server.setReleaseWindow, { ...args, phase: "draining" })).toThrow("Countdown");
});
it("fences stale operators and records one acknowledgement per account", () => {
  const f = crystalFixture(), player = f.ctx.sender;
  f.ctx.sender = owner; f.run(server.setReleaseWindow, args);
  f.ctx.timestamp = new Timestamp(310_000_000n); f.run(server.setReleaseWindow, { ...args, phase: "draining" });
  f.ctx.sender = player;
  expect(() => f.run(server.acknowledgeRelease, { id: "wrong" })).toThrow();
  f.run(server.acknowledgeRelease, { id: args.id }); f.run(server.acknowledgeRelease, { id: args.id });
  expect(f.db.releaseAcknowledgement.count()).toBe(1n);
  f.ctx.sender = owner; f.run(server.setReleaseWindow, { ...args, phase: "cancelled" });
  expect(() => f.run(server.setReleaseWindow, { ...args, phase: "updating" })).toThrow("transition");
});
it("does not revive an expired release", () => {
  const f = crystalFixture(); f.ctx.sender = owner; f.run(server.setReleaseWindow, args);
  f.ctx.timestamp = new Timestamp(401_000_000n);
  expect(() => f.run(server.setReleaseWindow, { ...args, phase: "draining" })).toThrow("expired");
  f.run(server.setReleaseWindow, { ...args, id: "replacement", startsAt: 500000 });
  expect(() => f.run(server.setReleaseWindow, { ...args, phase: "cancelled" })).toThrow("changed");
});
it("announces a live client to open tabs: a short updating window, then a completed one with a reload", () => {
  const f = crystalFixture();
  const notice = () => parseReleaseWindow(f.db.releaseNotice.id.find(0)?.releaseJson);
  expect(() => f.run(server.announceClientUpdate, { version: "0.908.2", step: "start" })).toThrow("owner");
  f.ctx.sender = owner;
  expect(() => f.run(server.announceClientUpdate, { version: "0.908.2", step: "finish" })).toThrow("under way");
  f.run(server.announceClientUpdate, { version: "0.908.2", step: "start" });
  expect(notice()).toMatchObject({ phase: "updating", version: "0.908.2", reload: true });
  f.run(server.announceClientUpdate, { version: "0.908.2", step: "finish" });
  expect(notice()).toMatchObject({ phase: "complete", version: "0.908.2", reload: true });
  // A scheduled release is never overwritten by an announcement.
  f.run(server.setReleaseWindow, args);
  expect(() => f.run(server.announceClientUpdate, { version: "0.908.3", step: "start" })).toThrow("under way");
});
