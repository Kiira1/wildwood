/**
 * The colors a player can pick for their name in chat (Ryan, 2026-10-13). Zero is Auto: the pastel the
 * name always had, picked from the identity. The rest stay light enough to read on the black chat panel.
 */
export const NAME_COLOR_AUTO = 0;
export const NAME_COLORS = [
  { name: "Auto", color: "" },
  { name: "White", color: "#ffffff" },
  { name: "Red", color: "#ff7b7b" },
  { name: "Orange", color: "#ffab5e" },
  { name: "Gold", color: "#ffd75e" },
  { name: "Lime", color: "#c6f06a" },
  { name: "Green", color: "#72ef58" },
  { name: "Mint", color: "#6ff0c4" },
  { name: "Cyan", color: "#6fe3ff" },
  { name: "Blue", color: "#8fb0ff" },
  { name: "Purple", color: "#c49bff" },
  { name: "Pink", color: "#ff9bd8" },
] as const;

export function isValidNameColor(value: number) {
  return Number.isInteger(value) && value >= 0 && value < NAME_COLORS.length;
}

/** The chosen color's hex, or "" for Auto and anything unknown. */
export function nameColorHex(value: number | undefined) {
  return value !== undefined && isValidNameColor(value) ? NAME_COLORS[value].color : "";
}
