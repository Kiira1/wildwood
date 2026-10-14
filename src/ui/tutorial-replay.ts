/**
 * Settings' Replay Tutorial: runs the first lessons again from the start, whether or not they were finished.
 * Not in a duel, a challenge, or before the game has started; the game says why instead.
 */
export function installTutorialReplay(o: {
  doc: Document;
  blocked: () => string | null;
  begin: () => void;
  showMessage: (text: string, color: string) => void;
}) {
  const button = o.doc.getElementById("replayTutorialBtn");
  button?.addEventListener("click", () => {
    const reason = o.blocked();
    if (reason) { o.showMessage(reason, "#ff9b91"); return; }
    // Settings closes as its Back does, so nothing is left open over the lessons.
    o.doc.getElementById("closeSettingsBtn")?.click();
    o.begin();
  });
}

/** Why a replay cannot start now, or null. */
export function tutorialReplayBlocked(state: { running: boolean; inTutorial: boolean; dueling: boolean; challenge: boolean }) {
  if (state.inTutorial) return "Already in the Tutorial";
  if (!state.running) return "Start the Game First";
  if (state.dueling) return "Finish Your Duel First";
  if (state.challenge) return "Finish Your Challenge First";
  return null;
}
