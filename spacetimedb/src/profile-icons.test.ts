import { expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

it("saves the added portrait sheets while rejecting indices outside the catalog", () => {
  const f = crystalFixture();
  f.ctx.sender = identity("1");
  for (const profileIcon of [63, 64, 127, 128, 191]) {
    f.run(server.setProfileIcon, { profileIcon });
    expect(f.db.playerProfile.identity.find(identity("1")).profileIcon).toBe(profileIcon);
  }
  for (const profileIcon of [-1, 192, 1.5]) {
    expect(() => f.run(server.setProfileIcon, { profileIcon })).toThrow("Choose an available profile picture.");
    expect(f.db.playerProfile.identity.find(identity("1")).profileIcon).toBe(191);
  }
});
