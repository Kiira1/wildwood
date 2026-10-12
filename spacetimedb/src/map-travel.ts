// Map travel: valid map ids, portal use points and arrival points, Endless
// access, and the changeMap body that checks a portal is in reach before moving
// the player. The changeMap declaration stays in index.ts.
import type { ModuleReducerCtx, GameViewContext, GameReducerContext } from "./index";
import { WORLD_WIDTH, WORLD_HEIGHT, MAP_IDS, INTERMEDIATE_SNOWLANDS_MAP_ID, BOSS_REWARD_CLAIM_BITS, TUTORIAL_FOREST_MAP_ID, PLAYER_SPAWN, PLAYER_RADIUS, MAP_DISPLAY_NAMES } from "../../shared/rules";
import { HOME_EXTERIOR_MAP_ID, HOME_TRAVEL_PORTAL } from "../../shared/home";
import { isProceduralMap, PROCEDURAL_ENTRY_BOSS, generateMap, PROCEDURAL_ENTRY_MAP, proceduralMapId } from "../../shared/procedural-maps";
import { isSoulMap, soulReturnOpenFor, worldBoundsFor, requireSoulDimensionOpen, SOUL_TOWN_PORTAL, SOUL_ARRIVAL } from "./soul-dimension";
import { isGuildHallMap, guildHallMember, enterGuildHall } from "./guild-hall";
import { isTownMap, TOWN_MAP_ID, TOWN_ARRIVAL, townPortalUsePoints } from "./town";
import { CAMPAIGN_GATEWAYS, portalUsePoint, campaignLanding, LEGACY_CORNER_GATEWAYS, endlessEntryPortal, legacyPortalUsePoints } from "../../shared/map-gateways";
import { blockedSession, requireControllingPlayer, isDeveloperIdentity } from "./session-guards";
import { activeDuelFor } from "./duel-runtime";
import { SenderError } from "spacetimedb/server";
import { readPlayerProgress } from "./wide-stats";
import { generatedMapUnlocked } from "./procedural-maps";
import { CAMPAIGN_UNLOCK_FIELDS, campaignMapUnlocked } from "../../shared/equipment-access";
import { transitionPlayerMap } from "./character-reset";
import { persistWorldLocation } from "./presence-runtime";
import { CAMPAIGN_MAPS } from "../../shared/campaign-registry";
import { Identity } from "spacetimedb";

export const WORLD = { width: WORLD_WIDTH, height: WORLD_HEIGHT };

export const VALID_MAP_IDS = { has: (id: string) => MAP_IDS.includes(id) || id === HOME_EXTERIOR_MAP_ID || isProceduralMap(id) || isSoulMap(id) || isGuildHallMap(id) || isTownMap(id) };

export const LEGACY_FROSTWIND_EXPANSE_MAP_ID = "frostwind_expanse";

export function canonicalMapId(mapId: string) {
  return mapId === LEGACY_FROSTWIND_EXPANSE_MAP_ID ? INTERMEDIATE_SNOWLANDS_MAP_ID : mapId;
}

// Shared with the client (shared/map-gateways.ts): portals are checked at their use point.
export const MAP_PORTALS: Record<string, { x: number; y: number; destination: string }[]> =
  Object.fromEntries(Object.entries(CAMPAIGN_GATEWAYS).map(([mapId, gateways]) => [mapId, gateways.portals.map(portalUsePoint)]));

export const MAP_ARRIVALS: Record<string, { x: number; y: number }> =
  Object.fromEntries(Object.keys(CAMPAIGN_GATEWAYS).map(mapId => [mapId, campaignLanding(mapId)]));

export const MAP_PORTAL_USE_RANGE = 125;

export function changePlayerMap(ctx: ModuleReducerCtx, { mapId, x, y }: { mapId: string; x: number; y: number }) {
  if (blockedSession(ctx)) return;
  const current = requireControllingPlayer(ctx);
  if (activeDuelFor(ctx, ctx.sender)) throw new SenderError("Finish the duel before using a portal.");
  // "Base" and "Fight" both ask for the Town (Home, retired, means the same): Base from anywhere, Fight from the Town.
  if (mapId === HOME_EXTERIOR_MAP_ID || isTownMap(mapId)) {
    if (current.hp <= 0) throw new SenderError("Respawn before teleporting to the Town.");
    if (isTownMap(current.mapId)) {
      const saved = ctx.db.homeReturnLocation.identity.find(ctx.sender);
      // Recover already-linked accounts whose older client/server omitted
      // their Home return record. Keep their stats and unlocks intact.
      const progress = readPlayerProgress(ctx, ctx.sender);
      const savedMapIndex = saved ? MAP_IDS.indexOf(saved.mapId) : -1;
      // Fight only goes back to a map this run has open: a challenge run (or a reset) must not land on the main run's map 15, or its Soul Dimension.
      const permitted = (!isSoulMap(saved?.mapId) || soulReturnOpenFor(ctx, ctx.sender)) && (!isGuildHallMap(saved?.mapId) || guildHallMember(ctx, ctx.sender, saved!.mapId)) && Boolean(saved && (isProceduralMap(saved.mapId)
        ? hasEndlessTravelAccess(ctx, ctx.sender) || generatedMapUnlocked(saved.mapId, ctx.db.proceduralProgress.identity.find(ctx.sender)?.completed ?? 0,
          Boolean((progress?.bossRewardClaims ?? 0) & BOSS_REWARD_CLAIM_BITS[PROCEDURAL_ENTRY_BOSS]))
        : savedMapIndex <= 0 || Boolean(progress?.[CAMPAIGN_UNLOCK_FIELDS[savedMapIndex - 1]])));
      const destination = permitted && saved && saved.mapId !== HOME_EXTERIOR_MAP_ID && !isTownMap(saved.mapId) && VALID_MAP_IDS.has(saved.mapId)
        && [saved.x, saved.y, saved.facing].every(Number.isFinite)
        ? saved : { mapId: TUTORIAL_FOREST_MAP_ID, ...PLAYER_SPAWN, facing: 0 };
      transitionPlayerMap(ctx, current, destination.mapId, destination, destination.facing);
    } else {
      if (![x, y].every(Number.isFinite) || x < PLAYER_RADIUS || y < PLAYER_RADIUS || x > worldBoundsFor(current.mapId).width - PLAYER_RADIUS || y > worldBoundsFor(current.mapId).height - PLAYER_RADIUS) throw new SenderError("Invalid teleport position.");
      const saved = { identity: ctx.sender, mapId: current.mapId, x, y, facing: current.facing };
      if (isGuildHallMap(current.mapId) || current.mapId === HOME_EXTERIOR_MAP_ID) { /* "Fight" from the Town still goes back to where the fighting was */ } else if (ctx.db.homeReturnLocation.identity.find(ctx.sender)) ctx.db.homeReturnLocation.identity.update(saved);
      else ctx.db.homeReturnLocation.insert(saved);
      transitionPlayerMap(ctx, current, TOWN_MAP_ID, TOWN_ARRIVAL);
    }
    persistWorldLocation(ctx, ctx.db.player.identity.find(ctx.sender));
    return;
  }
  if (!VALID_MAP_IDS.has(mapId) || mapId === current.mapId) throw new SenderError("Unsupported map destination.");
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new SenderError("Portal position must be finite.");
  if (x < PLAYER_RADIUS || x > worldBoundsFor(current.mapId).width - PLAYER_RADIUS || y < PLAYER_RADIUS || y > worldBoundsFor(current.mapId).height - PLAYER_RADIUS) {
    throw new SenderError("Portal position is outside the world.");
  }
  if (isSoulMap(mapId)) requireSoulDimensionOpen(ctx);
  if (isGuildHallMap(mapId)) return enterGuildHall(ctx, current, mapId, x, y, { transitionPlayerMap, persistWorldLocation });
  const currentProgress = readPlayerProgress(ctx, ctx.sender);
  const campaignIndex = CAMPAIGN_MAPS.findIndex(map => map.id === mapId);
  if (campaignIndex > 0 && !campaignMapUnlocked(campaignIndex, currentProgress ?? {})) {
    throw new SenderError(`Defeat ${CAMPAIGN_MAPS[campaignIndex - 1].bossName} before entering ${MAP_DISPLAY_NAMES[mapId]}.`);
  }

  if (isProceduralMap(mapId) && !generatedMapUnlocked(mapId,
    ctx.db.proceduralProgress.identity.find(ctx.sender)?.completed ?? 0,
    Boolean(currentProgress && (currentProgress.bossRewardClaims & BOSS_REWARD_CLAIM_BITS[PROCEDURAL_ENTRY_BOSS])))) {
    throw new SenderError("Defeat the previous map's boss first.");
  }
  // The Town's travel portal (and, for tabs from before the Town, Home's pad) reaches every map the checks above allow.
  const usePoint = (portal: { x: number; y: number; height: number }, destination: string) => ({ x: portal.x, y: portal.y - portal.height * .32, destination });
  const sourcePortals = current.mapId === HOME_EXTERIOR_MAP_ID ? [usePoint(HOME_TRAVEL_PORTAL, isSoulMap(mapId) ? "" : mapId)]
    : isTownMap(current.mapId) ? townPortalUsePoints(mapId)
    // LEGACY: the forest's old portal spot, where tabs older than 0.901.15 draw the Soul Dimension's (shared/map-gateways.ts).
    : isSoulMap(current.mapId) ? [usePoint(SOUL_TOWN_PORTAL, SOUL_TOWN_PORTAL.destination), usePoint(LEGACY_CORNER_GATEWAYS[TUTORIAL_FOREST_MAP_ID].portals[0], SOUL_TOWN_PORTAL.destination)]
    : isProceduralMap(current.mapId)
    ? generateMap(current.mapId).portals.map(portal => ({ ...portal, y:portal.y-portal.height*.32 }))
    : [...(MAP_PORTALS[current.mapId as keyof typeof MAP_PORTALS] ?? []),
      ...(current.mapId === PROCEDURAL_ENTRY_MAP ? [portalUsePoint(endlessEntryPortal(proceduralMapId(1)))] : []),
      ...legacyPortalUsePoints(current.mapId, proceduralMapId(1))];
  const sourcePortal = sourcePortals.filter((portal) => portal.destination === mapId).sort((a, b) => Math.hypot(x - a.x, y - a.y) - Math.hypot(x - b.x, y - b.y))[0];
  if (!sourcePortal) throw new SenderError("Maps are not connected.");
  // Movement is client-authoritative. Validate the coordinate from this
  // discrete portal action instead of a potentially one-heartbeat-old
  // player_motion sample, then move to the destination atomically.
  const portalDistance = Math.hypot(x - sourcePortal.x, y - sourcePortal.y);
  if (portalDistance > MAP_PORTAL_USE_RANGE) throw new SenderError("Move closer to the portal.");

  // An old tab that took an old portal puts itself at the old arrival; land it there so the two agree.
  const arrival = (sourcePortal as { legacyArrival?: { x: number; y: number } | null }).legacyArrival ?? (isProceduralMap(mapId) ? generateMap(mapId).arrival : isSoulMap(mapId) ? SOUL_ARRIVAL : isTownMap(mapId) ? TOWN_ARRIVAL : MAP_ARRIVALS[mapId as keyof typeof MAP_ARRIVALS]);
  transitionPlayerMap(ctx, current, mapId, arrival);
}

export function hasEndlessTravelAccess(ctx: GameViewContext | GameReducerContext, identity: Identity) {
  return isDeveloperIdentity(identity) || Boolean(ctx.db.endlessTravelAccess.identity.find(identity));
}
