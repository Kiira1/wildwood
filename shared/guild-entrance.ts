import type { GuildBattleResult } from "./guild-combat";

/** Shared arrival schedule: deterministic for server resolution and replay.
 * Excludes names/identities so moderation or deletion cannot change saved fights. */
export function buildGuildEntrance(battle: Pick<GuildBattleResult, "attackers" | "defenders">) {
  const fighters = [...battle.attackers, ...battle.defenders];
  let seed = 2166136261;
  for (const char of JSON.stringify(fighters.map(member => [member.fighter, member.range]))) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const shuffled = (from: number, count: number) => {
    const indices = Array.from({ length: count }, (_, i) => from + i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
  };
  const order = shuffled(0, Math.max(battle.attackers.length, battle.defenders.length));
  const teams = [order.filter(i => i < battle.attackers.length),
    order.filter(i => i < battle.defenders.length).map(i => i + battle.attackers.length)];
  const arrivals = fighters.map(() => ({ start: 0, travel: 0, lane: 0 }));
  let time = .08;
  while (teams.some(team => team.length)) {
    // One from each side shares each wave, so neither guild gets a head start.
    const travel = .65 + random() * .4;
    for (const team of teams) {
      const index = team.pop();
      if (index !== undefined) arrivals[index] = { start: time, travel, lane: (random() - .5) * 48 };
    }
    time += .14 + random() * .22;
  }
  // Full 20-v-20 teams have a short entrance, rather than a long loading parade.
  const last = Math.max(...arrivals.map(arrival => arrival.start));
  if (last > 5) for (const arrival of arrivals) arrival.start *= 5 / last;
  const duration = Math.ceil(Math.max(...arrivals.map(arrival => arrival.start + arrival.travel)) * 10) / 10;
  return { arrivals, duration };
}
