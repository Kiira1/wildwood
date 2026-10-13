import { table, t, SenderError } from "spacetimedb/server";
import type spacetimedbType from "./index";
import { NAME_COLOR_AUTO, isValidNameColor } from "../../shared/name-colors";
import { updateSnapshotRow } from "./snapshot-row-writes";

/**
 * The color a player picked for their name in chat (shared/name-colors.ts). No row is Auto. Its own table,
 * not a playerProfile column: a new column makes every open tab reload. Public: chat reads senders' rows.
 */
export const playerNameColor = table({ name: "player_name_color", public: true }, {
  identity: t.identity().primaryKey(),
  color: t.u8(),
});

export type ProfileLookDeps = {
  requireControllingPlayer: (ctx: any) => any;
  /** Republishes the sender's map-wide presentation after their profile changed. */
  syncLook: (ctx: any) => void;
};

export function saveNameColor(ctx: any, identity: any, color: number) {
  const existing = ctx.db.playerNameColor.identity.find(identity);
  if (color === NAME_COLOR_AUTO) { if (existing) ctx.db.playerNameColor.identity.delete(identity); }
  else if (existing) { if (existing.color !== color) ctx.db.playerNameColor.identity.update({ identity, color }); }
  else ctx.db.playerNameColor.insert({ identity, color });
}

/** A guest's pick follows them onto the account they sign in to, unless that account already chose one. */
export function carryNameColor(ctx: any, from: any, to: any) {
  const picked = ctx.db.playerNameColor.identity.find(from);
  if (picked && !ctx.db.playerNameColor.identity.find(to)) saveNameColor(ctx, to, picked.color);
}

export function registerProfileLookReducers(spacetimedb: typeof spacetimedbType, deps: ProfileLookDeps) {
  const setPlayerSprite = spacetimedb.reducer({ playerSprite: t.u32() }, (ctx, { playerSprite }) => {
    deps.requireControllingPlayer(ctx);
    if (!Number.isInteger(playerSprite) || playerSprite > 3) throw new SenderError("Player sprite must be between 0 and 3.");
    const profile = ctx.db.playerProfile.identity.find(ctx.sender);
    if (!profile) throw new SenderError("Player profile not found.");
    if (profile.playerSprite === playerSprite) return;
    updateSnapshotRow(ctx, "playerProfile", { ...profile, playerSprite });
    deps.syncLook(ctx);
  });
  const setNameColor = spacetimedb.reducer({ color: t.u8() }, (ctx, { color }) => {
    deps.requireControllingPlayer(ctx);
    if (!isValidNameColor(color)) throw new SenderError("Choose an available name color.");
    saveNameColor(ctx, ctx.sender, color);
  });
  return { setPlayerSprite, setNameColor };
}
