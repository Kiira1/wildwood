import type { GuildPreview } from '../../shared/guilds';

/** Use the existing roster response, without a per-member presence request. */
export function guildMemberPresence(member: GuildPreview['members'][number], nowMs: number) {
  if (member.online) return 'Online';
  if (!member.lastSeenAtMs || !Number.isFinite(member.lastSeenAtMs)) return 'Offline';
  const minutes = Math.max(0, Math.floor((nowMs - member.lastSeenAtMs) / 60_000));
  if (minutes < 1) return 'Last seen just now';
  const [count, unit] = minutes >= 1440 ? [Math.floor(minutes / 1440), 'day']
    : minutes >= 60 ? [Math.floor(minutes / 60), 'hour'] : [minutes, 'minute'];
  return `Last seen ${count} ${unit}${count === 1 ? '' : 's'} ago`;
}
