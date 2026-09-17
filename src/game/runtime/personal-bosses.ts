import { personalBossDefinition } from "../../../shared/personal-bosses";
import type { RespawnMemory } from './respawn-memory';

/** Local combat owns HP. Only the completed defeat is sent to the reward queue. */
export function createPersonalBosses(options: {
  mapId: () => string; identity: () => string; alive: () => boolean; now: () => number;
  defeated: (mapId: string) => void;
  respawns?: RespawnMemory;
}) {
  type State = { key: string; mapId: string; encounter: bigint; hp: number; maxHp: number; alive: boolean; respawnAtMs: number; respawnAtMicros: bigint };
  type Result = { encounter: bigint; totalDamage: number; createdAtMs: number; contributors: { identity: string; name: string; gender: 0; damage: number; percentage: number }[] };
  const states = new Map<string, State>(), results = new Map<string, Result>();
  let owner = "", activeMap = "", wasAlive = true, encounter = BigInt(Date.now()) * 1000n;
  function refresh() {
    if (owner !== options.identity()) { owner = options.identity(); states.clear(); results.clear(); activeMap = ""; }
    const mapId = options.mapId(), alive = options.alive();
    if (activeMap !== mapId || (wasAlive && !alive)) {
      const old = states.get(activeMap);
      if (old?.alive) { old.hp = old.maxHp; old.encounter = ++encounter; }
      activeMap = mapId;
    }
    wasAlive = alive;
  }
  function state(mapId: string): State | null {
    refresh();
    if (mapId !== activeMap) return null;
    const definition = personalBossDefinition(mapId);
    if (!definition) return null;
    let row = states.get(mapId);
    if (!row || (!row.alive && options.now() >= row.respawnAtMs)) {
      row = { key: `${owner}:${mapId}`, mapId, encounter: ++encounter, hp: definition.hp, maxHp: definition.hp, alive: true, respawnAtMs: 0, respawnAtMicros: 0n };
      const remaining = options.respawns?.remaining(`boss:${mapId}`) ?? 0;
      if (remaining > 0) {
        row.alive = false; row.hp = 0;
        row.respawnAtMs = options.now() + remaining;
        row.respawnAtMicros = BigInt(Math.round(row.respawnAtMs * 1000));
      }
      // Only a handful of recently visited maps need local respawn clocks.
      if (states.size >= 8 && !states.has(mapId)) { const key = states.keys().next().value!; states.delete(key); results.delete(key); }
      states.set(mapId, row);
    }
    return { ...row };
  }
  return {
    state,
    proceduralState: state,
    result(mapId: string) { refresh(); return results.get(mapId) ?? null; },
    hit(mapId: string, damage: number) {
      const current = state(mapId);
      if (!current?.alive || !options.alive() || !Number.isFinite(damage) || damage <= 0) return;
      const row = states.get(mapId)!;
      row.hp = Math.max(0, row.hp - damage);
      if (row.hp > 0) return;
      row.alive = false;
      row.respawnAtMs = options.now() + personalBossDefinition(mapId)!.respawnSeconds * 1000;
      row.respawnAtMicros = BigInt(Math.round(row.respawnAtMs * 1000));
      options.respawns?.remember(`boss:${mapId}`, row.respawnAtMs - options.now());
      results.set(mapId, { encounter: row.encounter, totalDamage: row.maxHp, createdAtMs: options.now(),
        contributors: [{ identity: owner, name: "You", gender: 0, damage: row.maxHp, percentage: 100 }] });
      options.defeated(mapId);
    },
  };
}
