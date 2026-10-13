import { expect, it, vi } from "vitest";
import { crystalFixture, identity, server } from "../../tests/helpers/crystal-hollows-fixture";
import { NAME_COLORS, NAME_COLOR_AUTO } from "../../shared/name-colors";
import { carryNameColor } from "./profile-look";
import { eraseIdentityRows } from "./account-erasure";
vi.mock("spacetimedb/server", () => import("../../tests/helpers/spacetime-module"));

const color = (f: ReturnType<typeof crystalFixture>, who = f.ctx.sender) => f.db.playerNameColor.identity.find(who)?.color;

it("saves a picked chat name color, and Auto keeps no row", () => {
  const f = crystalFixture();
  f.run(server.setNameColor, { color: 4 });
  expect(color(f)).toBe(4);
  f.run(server.setNameColor, { color: 9 });
  expect(color(f)).toBe(9);
  f.run(server.setNameColor, { color: NAME_COLOR_AUTO });
  expect(color(f)).toBeUndefined();
});

it("refuses a color that is not on the list", () => {
  const f = crystalFixture();
  expect(() => f.run(server.setNameColor, { color: NAME_COLORS.length })).toThrow("Choose an available name color.");
  expect(color(f)).toBeUndefined();
});

it("moves a guest's color onto the account unless the account already picked one", () => {
  const f = crystalFixture();
  const guest = identity("a"), account = identity("b"), picked = identity("c");
  f.seed("playerNameColor", { identity: guest, color: 6 });
  carryNameColor(f.ctx, guest, account);
  expect(color(f, account)).toBe(6);
  f.seed("playerNameColor", { identity: picked, color: 2 });
  carryNameColor(f.ctx, guest, picked);
  expect(color(f, picked)).toBe(2);
});

it("is erased with the account", () => {
  const f = crystalFixture();
  f.run(server.setNameColor, { color: 3 });
  eraseIdentityRows(f.ctx, [f.ctx.sender]);
  expect(color(f)).toBeUndefined();
});
