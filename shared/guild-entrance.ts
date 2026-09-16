import type { GuildBattleResult } from "./guild-combat";

export const GUILD_MOVE_SPEED = 90;

/** Shared arrival schedule: deterministic for server resolution and replay.
 * Excludes names/identities so moderation or deletion cannot change saved fights. */
export function buildGuildEntrance(battle: Pick<GuildBattleResult, "attackers" | "defenders"> & { version?: GuildBattleResult["version"] }) {
  const walking = (battle.version ?? 4) >= 4;
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
      if (index !== undefined) {
        const local = index < battle.attackers.length ? index : index - battle.attackers.length;
        const rows = Math.min(5, index < battle.attackers.length ? battle.attackers.length : battle.defenders.length);
        // Formation begins at x=270/730; enter from x=-200/1200.
        const distance = 470 - Math.floor(local / rows) * 52;
        arrivals[index] = { start: time, travel: walking ? distance / GUILD_MOVE_SPEED : travel, lane: (random() - .5) * 48 };
      }
    }
    time += walking ? .55 + random() * .65 : .14 + random() * .22;
  }
  // Retain the original compressed schedule for recorded version 3 fights.
  const last = Math.max(...arrivals.map(arrival => arrival.start));
  if (!walking && last > 5) for (const arrival of arrivals) arrival.start *= 5 / last;
  const duration = Math.ceil(Math.max(...arrivals.map(arrival => arrival.start + arrival.travel)) * 10) / 10;
  return { arrivals, duration, walking };
}
