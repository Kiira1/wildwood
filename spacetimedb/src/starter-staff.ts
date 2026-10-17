import { SenderError, t } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type spacetimedbType from "./index";
import { STARTER_STAFF } from "../../shared/items";
import { TOWN_FEET_OFFSET, TOWN_SMITH_POSITION, TOWN_SMITH_SERVER_REACH } from "../../shared/town";
import { isTownMap } from "./town";
import { withinStationReach } from "./door-reach";
import { readPlayerProgress } from "./wide-stats";
import { freeBagSlots } from "./equipment-copies";
import { playerStaffSkill } from "./staff-skills";

type Ctx = any;
const SMITH_STAND = { x: TOWN_SMITH_POSITION.x, y: TOWN_SMITH_POSITION.y - TOWN_FEET_OFFSET };

export type StarterStaffDeps = {
  requireControllingPlayer: (ctx: Ctx) => any;
  activeDuelFor: (ctx: Ctx, identity: Identity) => unknown;
  inventoryForProgress: (progress: any) => string[];
  restoreItemToProgress: (progress: any, itemId: string) => any;
  writeProgressAndPresentation: (ctx: Ctx, progress: any) => void;
};

/** The Smith hands out a Starter Staff, as he does the pickaxe: one at a time, into a free bag slot. */
export function claimStarterStaffFor(ctx: Ctx, deps: StarterStaffDeps) {
  const player = deps.requireControllingPlayer(ctx);
  if (!isTownMap(player.mapId) || !withinStationReach(ctx, player, SMITH_STAND, TOWN_SMITH_SERVER_REACH)) {
    throw new SenderError("Talk to the Smith first.");
  }
  if (deps.activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish your duel first.");
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress) throw new SenderError("Player unavailable.");
  const inventory = deps.inventoryForProgress(progress);
  if (inventory.includes(STARTER_STAFF)) throw new SenderError("You already have a Starter Staff.");
  if (freeBagSlots(ctx, ctx.sender, progress, inventory) <= 0) throw new SenderError("Your bag is full. Free a slot for the staff.");
  deps.writeProgressAndPresentation(ctx, deps.restoreItemToProgress(progress, STARTER_STAFF));
}

/** The Starter Staff reducer and the caller's own staff rolls. */
export function registerStaffs(spacetimedb: typeof spacetimedbType, deps: StarterStaffDeps) {
  const claimStarterStaff = spacetimedb.reducer({}, (ctx: any) => claimStarterStaffFor(ctx, deps));
  const myStaffSkills = spacetimedb.view({ name: "my_staff_skills", public: true }, t.array(playerStaffSkill.rowType),
    (ctx: any) => [...ctx.db.playerStaffSkill.identity.filter(ctx.sender)]);
  return { claimStarterStaff, myStaffSkills };
}
