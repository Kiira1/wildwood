/** Separate the moving light, stationary artwork mask, and unmasked outer halo. */
export function createAvatarFrameGlow() {
  const glow = document.createElement("span");
  glow.className = "avatar-frame-glow";
  glow.setAttribute("aria-hidden", "true");
  const mask = document.createElement("span");
  mask.className = "avatar-frame-glow-mask";
  glow.append(mask);
  return glow;
}
