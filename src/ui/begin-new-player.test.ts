import { describe, expect, it } from "vitest";
import { beginNewPlayer } from "./startup-runtime";

describe("a new character's first moments", () => {
  const run = (tutorialRequired: boolean | undefined) => {
    const steps: string[] = [];
    beginNewPlayer({
      recordGameplayReady: () => steps.push("ready"),
      settings: { useNewPlayerDefaults: () => steps.push("defaults") },
      onboarding: tutorialRequired === undefined ? undefined : { required: () => tutorialRequired },
      startGame: () => steps.push("tutorial"),
      intro: { showNewPlayerIntro: () => steps.push("intro") },
    });
    return steps;
  };

  it("applies the new-player settings before the tutorial starts", () => {
    expect(run(true)).toEqual(["ready", "defaults", "tutorial"]);
  });

  it("applies them before the intro when there is no tutorial", () => {
    expect(run(false)).toEqual(["ready", "defaults", "intro"]);
    expect(run(undefined)).toEqual(["ready", "defaults", "intro"]);
  });
});
