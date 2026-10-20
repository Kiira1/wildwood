import { table, t, SenderError } from "spacetimedb/server";
import type { Identity } from "spacetimedb";
import type { ModuleReducerCtx } from "./index";
import { ONBOARDING_DAMAGE_REWARD, ONBOARDING_REGEN_REWARD, ONBOARDING_STEP, nextOnboardingStep, onboardingLessonAt, onboardingPending } from "../../shared/onboarding";
import { readPlayerProgress } from "./wide-stats";

export const playerOnboarding = table({ name: "player_onboarding", public: false }, {
  identity: t.identity().primaryKey(), step: t.u8(),
});
export function needsOnboarding(ctx: ModuleReducerCtx, identity: Identity) {
  return onboardingPending(ctx.db.playerOnboarding.identity.find(identity)?.step ?? 0);
}
export function advanceOnboarding(ctx: ModuleReducerCtx, step: number, writeProgress: (progress: any) => void) {
  const state = ctx.db.playerOnboarding.identity.find(ctx.sender);
  if (step < 2 || step > ONBOARDING_STEP.complete) throw new SenderError("Invalid tutorial step.");
  if (!state) {
    // A character from before the tutorial can replay it from Settings; finishing marks it done, with no rewards.
    if (step !== ONBOARDING_STEP.complete) throw new SenderError("This character does not need the tutorial.");
    ctx.db.playerOnboarding.insert({ identity: ctx.sender, step });
    return;
  }
  if (step <= state.step) return;
  // A retired step resumes at the lesson after it; recording that lesson or finishing it both count.
  const lesson = onboardingLessonAt(state.step);
  // Remove in the next client-break release: a 0.916.14 tab still reports the retired portrait lesson (2) after Move.
  const oldClientPortrait = step === 2 && state.step === ONBOARDING_STEP.move;
  // The final step can also be reached through Skip tutorial. It grants no unearned rewards.
  if (step !== ONBOARDING_STEP.complete && step !== lesson && step !== nextOnboardingStep(lesson) && !oldClientPortrait) {
    throw new SenderError("Finish the current tutorial step first.");
  }
  const progress = readPlayerProgress(ctx, ctx.sender);
  if (!progress) throw new SenderError("Character unavailable.");
  writeProgress({ ...progress,
    damage: progress.damage + (step === ONBOARDING_STEP.regen ? ONBOARDING_DAMAGE_REWARD : 0),
    regen: progress.regen + (step === ONBOARDING_STEP.death ? ONBOARDING_REGEN_REWARD : 0),
    introComplete: step === ONBOARDING_STEP.complete || progress.introComplete,
  });
  ctx.db.playerOnboarding.identity.update({ ...state, step });
}
export function mergeOnboarding(ctx: ModuleReducerCtx, guest: Identity, account: Identity) {
  const state = ctx.db.playerOnboarding.identity.find(guest);
  if (ctx.db.playerOnboarding.identity.find(account)) ctx.db.playerOnboarding.identity.delete(account);
  if (state) {
    ctx.db.playerOnboarding.insert({ ...state, identity: account });
    ctx.db.playerOnboarding.identity.delete(guest);
  }
}
