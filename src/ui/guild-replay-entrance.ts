import { buildGuildEntrance } from "../../shared/guild-entrance";
export const buildGuildReplayEntrance = buildGuildEntrance;
export type GuildReplayEntrance = ReturnType<typeof buildGuildEntrance>;

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
