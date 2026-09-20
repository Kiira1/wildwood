export type AvatarFrame = "none" | "silver" | "gold";
export type AvatarFrameState = { identity: string; tier: AvatarFrame; frame: AvatarFrame; validUntilMs: number };
export type PatreonStatus = { configured: boolean; linked: boolean; tier: AvatarFrame; frame: AvatarFrame; validUntilMs: number; preview?: boolean };
export const AVATAR_FRAME_ASSET = "assets/wildstat/avatar-frames/supporter.webp";
export const PATREON_PAGE = "https://www.patreon.com/c/wildstat/membership";
export function allowedAvatarFrame(tier: AvatarFrame, frame: string): frame is AvatarFrame {
  return frame === "none" || (frame === "silver" && tier !== "none") || (frame === "gold" && tier === "gold");
}
