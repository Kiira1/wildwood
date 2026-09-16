import type { GuildBattleResult } from "../../shared/guild-combat";

export type GuildReplayEntrance = ReturnType<typeof buildGuildReplayEntrance>;
/** Seeded once per replay: varied arrivals, stable when seeking or restarting. */
export function buildGuildReplayEntrance(battle: GuildBattleResult) {
  const fighters = [...battle.attackers, ...battle.defenders];
  let seed = 2166136261;
  for (const char of JSON.stringify(fighters.map(member => [member.identity, member.fighter]))) {
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
  const teams = [shuffled(0, battle.attackers.length), shuffled(battle.attackers.length, battle.defenders.length)];
  const arrivals = fighters.map(() => ({ start: 0, travel: 0, lane: 0 }));
  let time = .08;
  while (teams.some(team => team.length)) {
    const first = teams[0].length && teams[1].length ? (random() < .5 ? 0 : 1) : teams[0].length ? 0 : 1;
    const group = [teams[first].pop()!];
    const other = teams[1 - first].length ? 1 - first : first;
    if (teams[other].length && random() > .18) group.push(teams[other].pop()!);
    for (const index of group) arrivals[index] = { start: time, travel: .65 + random() * .4, lane: (random() - .5) * 48 };
    time += .14 + random() * .22;
  }
  // Full 20-v-20 teams have a short entrance, rather than a long loading parade.
  const last = Math.max(...arrivals.map(arrival => arrival.start));
  if (last > 5) for (const arrival of arrivals) arrival.start *= 5 / last;
  const duration = Math.ceil(Math.max(...arrivals.map(arrival => arrival.start + arrival.travel)) * 10) / 10;
  return { arrivals, duration };
}

export function guildEntrancePosition(arrival: GuildReplayEntrance["arrivals"][number], time: number,
  destination: { x: number; y: number }, side: number, width: number) {
  if (time < arrival.start) return { ...destination, visible: false, entering: false };
  const progress = Math.max(0, Math.min(1, (time - arrival.start) / arrival.travel));
  if (progress === 1) return { ...destination, visible: true, entering: false };
  const startX = side ? width + 90 : -90;
  // Mostly constant walk speed with a soft settle into formation.
  const blend = 1 - (1 - progress) ** 1.3;
  const x = startX + (destination.x - startX) * blend;
  return { x, y: destination.y + arrival.lane * (1 - blend),
    visible: x > -60 && x < width + 60, entering: true };
}
