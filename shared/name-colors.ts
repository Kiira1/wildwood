/**
 * The colors a player can pick for their name in chat. Zero is Auto: the pastel the
 * name always had, picked from the identity. The rest are the same soft pastels as Auto's,
 * so a picked name sits with every other one.
 */
export const NAME_COLOR_AUTO = 0;
export const NAME_COLORS = [
  { name: "Auto", color: "" },
  { name: "White", color: "#ffffff" },
  { name: "Red", color: "#ffb8b8" },
  { name: "Orange", color: "#ffd1aa" },
  { name: "Gold", color: "#ffe7a8" },
  { name: "Lime", color: "#e4f5b3" },
  { name: "Green", color: "#c9f5c2" },
  { name: "Mint", color: "#bff3e7" },
  { name: "Cyan", color: "#bce7ff" },
  { name: "Blue", color: "#d0d9ff" },
  { name: "Purple", color: "#e1c7ff" },
  { name: "Pink", color: "#ffc3dd" },
] as const;

export function isValidNameColor(value: number) {
  return Number.isInteger(value) && value >= 0 && value < NAME_COLORS.length;
}

/** The chosen color's hex, or "" for Auto and anything unknown. */
export function nameColorHex(value: number | undefined) {
  return value !== undefined && isValidNameColor(value) ? NAME_COLORS[value].color : "";
}
