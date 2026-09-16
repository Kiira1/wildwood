/** Curated ticker copy. Names are linked Patreon supporters' in-game names only. */
export const PATREON_SUPPORTER_NAMES = ["Epicmetheus", "Gehn", "Kiira", "Marze", "Skittle", "TacoMel"] as const;
export const GAME_TIPS = [
  "From 1,000 armor onward, every thousandfold increase in armor halves damage taken.",
  "Base attack speed is capped at 2.62/s.",
  "Toggle the eye to enable or disable multiplayer.",
  "Multiplayer automatically turns off after 5 minutes without manual movement, including while chatting or autofarming.",
  "Weekly top guilds will soon receive gems.",
  `Thank you to these Patreon supporters for paying for this game's development and costs: ${PATREON_SUPPORTER_NAMES.join(", ")}.`,
] as const;

export function pickGameTip(previous: number, random = Math.random) {
  const choices = GAME_TIPS.map((_, index) => index).filter(index => index !== previous);
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}
