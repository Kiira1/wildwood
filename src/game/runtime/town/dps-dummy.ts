import { formatCompactNumber } from "../../../../shared/compact-number";
import { TOWN_CENTER, isTownMap } from "../../../../shared/town";
import { ENEMY_TYPES } from "../../enemies";
import type { MapId, SpawnSite } from "../../world";
import type { EnemyState, PlayerState } from "../types";

export const DPS_DUMMY_NAME = "Training Dummy";
/** Just outside the village's west fence, by the hay bales off the road to the west bridge: far from where the Town is arrived in. */
export const DPS_DUMMY_POSITION = Object.freeze({ x: TOWN_CENTER.x - 1_247, y: TOWN_CENTER.y + 243 });
/** Its own site id, apart from the Soul Defense Force's (-7,000) and the generated bosses' (-1). */
const SITE_ID = -7_100;
/** A fight ends this long after its last hit; the next hit starts a new one. */
export const DPS_FIGHT_IDLE_SECONDS = 5;
/** Its health, as many of the player's hits: plenty to take a whole frame of them, and fine enough to read each to the unit. */
const HEALTH_IN_HITS = 1e9;

/** `hits`: frames it took damage in. */
export type DummyFight = { startedAt: number; lastHitAt: number; total: number; hits: number };

/**
 * The fight's damage a second: to now while it goes on, to its last hit once it is over, plus one average gap between
 * hits (ten hits a second apart are ten seconds of damage, not nine). Never under a second.
 */
export function dummyDps(fight: DummyFight | null, now: number) {
  if (!fight) return null;
  const going = now - fight.lastHitAt <= DPS_FIGHT_IDLE_SECONDS;
  const gap = fight.hits > 1 ? (fight.lastHitAt - fight.startedAt) / (fight.hits - 1) : 0;
  const seconds = Math.max(1, (going ? now : fight.lastHitAt) - fight.startedAt + gap);
  return { dps: fight.total / seconds, total: fight.total, seconds, going };
}

/**
 * The Town's training dummy: hit it with anything (weapon, skills, cards) to read the damage a second. It is a
 * local enemy no one else sees. It stands still, never fights back, never runs out of health, and is never a kill:
 * defeated() keeps it from rewards and the server, as the Soul Defense Force does.
 */
export function createDpsDummy(deps: {
  player: PlayerState;
  enemies: EnemyState[];
  spawnFromSite: (site: SpawnSite) => void;
  currentMapId: () => MapId;
  /** Seconds. */
  now?: () => number;
}) {
  const now = deps.now ?? (() => performance.now() / 1_000);
  let dummy: EnemyState | null = null, fight: DummyFight | null = null, health = 0;

  function spawn() {
    health = Math.max(1, deps.player.damage) * HEALTH_IN_HITS;
    const before = deps.enemies.length;
    deps.spawnFromSite({
      id: SITE_ID, type: "Bramble", campName: DPS_DUMMY_NAME, x: DPS_DUMMY_POSITION.x, y: DPS_DUMMY_POSITION.y,
      leashRange: 0, alive: false, respawnAt: 0,
      definition: { ...ENEMY_TYPES.Bramble, hp: health, damage: 0, speed: 0, r: 24, aggro: 0, ranged: false, regen: 0, armor: 0, reward: { type: "damage", amount: 0 } },
    });
    if (deps.enemies.length === before) return;
    dummy = deps.enemies[deps.enemies.length - 1];
    dummy.displayName = DPS_DUMMY_NAME;
    dummy.facingX = 1;
    dummy.trainingDummy = { readout: "", detail: "", hitAt: -Infinity };
    show();
  }

  function show() {
    if (!dummy?.trainingDummy) return;
    const reading = dummyDps(fight, now());
    dummy.trainingDummy.readout = reading ? `${formatCompactNumber(reading.dps)} DPS` : "Attack Me";
    dummy.trainingDummy.detail = reading ? `${formatCompactNumber(reading.total)} in ${Math.round(reading.seconds)}s` : "";
  }

  return {
    update() {
      if (dummy && !deps.enemies.includes(dummy)) dummy = null;
      if (!isTownMap(deps.currentMapId())) { if (dummy) dummy.dead = true; dummy = null; return; }
      if (!dummy) spawn();
      if (!dummy) return;
      // What it took since the last frame, from every source; then it is whole again, where it stands.
      const taken = health - dummy.hp;
      if (taken > 0 && Number.isFinite(taken)) {
        const at = now();
        if (!fight || at - fight.lastHitAt > DPS_FIGHT_IDLE_SECONDS) fight = { startedAt: at, lastHitAt: at, total: 0, hits: 0 };
        fight.total += taken;
        fight.hits++;
        fight.lastHitAt = at;
        dummy.trainingDummy!.hitAt = at;
        // A bigger hitter than it was made for: room for a billion of these too.
        health = Math.max(health, taken * HEALTH_IN_HITS);
      }
      Object.assign(dummy, { hp: health, maxHp: health, dead: false, engaged: false, leashing: false, x: DPS_DUMMY_POSITION.x, y: DPS_DUMMY_POSITION.y, vx: 0, vy: 0, facingX: 1 });
      show();
    },
    /** Its "defeat" (a hit bigger than its health): nothing paid or reported; it is whole again next frame. */
    defeated: (enemy: EnemyState) => Boolean(dummy && enemy === dummy),
  };
}
