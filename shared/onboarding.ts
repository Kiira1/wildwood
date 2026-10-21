export const ONBOARDING_ENEMY_HP = 10;
export const ONBOARDING_REGEN_ENEMY_HP = 25;
export const ONBOARDING_DAMAGE_REWARD = 1;
export const ONBOARDING_REGEN_REWARD = .2;
// Missing state belongs to an existing character and always skips onboarding.
export function onboardingPending(step: number) { return step >= 1 && step <= 5; }

// A private client instance in the regular world runtime. Account presence stays
// hidden at the forest arrival until the final server acknowledgement.
export const ONBOARDING_MAP_ID = "first_steps";
// Extra lawn keeps the compact lesson area framed on desktop and ultrawide screens.
export const ONBOARDING_WORLD = { width: 3600, height: 2400, spawn: { x: 1800, y: 1370 } } as const;
export const ONBOARDING_ART_OFFSET = { x: 1300, y: 650 } as const;
export const ONBOARDING_ENEMY_POSITION = { x: 1800, y: 1060 } as const;

// Stored step ids are saved data and never renumbered; 2 is retired.
export const ONBOARDING_STEP = { move: 1, spitter: 3, regen: 4, death: 5, complete: 6 } as const;
export const ONBOARDING_LESSONS = [ONBOARDING_STEP.move, ONBOARDING_STEP.spitter, ONBOARDING_STEP.regen, ONBOARDING_STEP.death] as const;
/** The lesson after `step`, or complete after the last; a retired id moves on to the lesson after it. */
export function nextOnboardingStep(step: number): number {
  return ONBOARDING_LESSONS.find(lesson => lesson > step) ?? ONBOARDING_STEP.complete;
}
/** The lesson a saved step resumes at: itself, or the next lesson for a retired id. */
export function onboardingLessonAt(step: number): number {
  return (ONBOARDING_LESSONS as readonly number[]).includes(step) || step >= ONBOARDING_STEP.complete ? step : nextOnboardingStep(step);
}
/** What moving from saved step `from` to `to` pays: each lesson's reward once, and a skip pays the ones not yet paid. */
export function onboardingRewardsBetween(from: number, to: number) {
  const crosses = (step: number) => from < step && step <= to;
  return { damage: crosses(ONBOARDING_STEP.regen) ? ONBOARDING_DAMAGE_REWARD : 0, regen: crosses(ONBOARDING_STEP.death) ? ONBOARDING_REGEN_REWARD : 0 };
}
