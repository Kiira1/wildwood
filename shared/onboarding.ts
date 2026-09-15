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

export const ONBOARDING_STEP = { move: 1, profile: 2, spitter: 3, regen: 4, death: 5, complete: 6 } as const;
