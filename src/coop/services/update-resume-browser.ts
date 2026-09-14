import { createUpdateResumeStore, inferLegacyUpdateResumeMode, type UpdateResumeMode } from "./update-resume-store";

export function consumeUpdateResumeMode(options: { version: string; store: ReturnType<typeof createUpdateResumeStore>; consumedKey: string; tabKey: string; tokenKey: string }): UpdateResumeMode | null {
  const { version: GAME_VERSION, store: updateResumeStore, consumedKey: updateResumeConsumedKey, tabKey: authTabKey, tokenKey: accountTokenKey } = options;
  const requestedVersion = new URL(window.location.href).searchParams.get("v") ?? "";
  const explicitMode = updateResumeStore.consume(requestedVersion);
  if (requestedVersion !== GAME_VERSION) return null;

  try {
    const consumedVersion = sessionStorage.getItem(updateResumeConsumedKey) ?? "";
    if (explicitMode) {
      sessionStorage.setItem(updateResumeConsumedKey, requestedVersion);
      return explicitMode;
    }

    // Clients predating the explicit handoff still leave a per-tab world ID.
    // Consume it once so the first deployment of this feature also resumes.
    const legacyMode = inferLegacyUpdateResumeMode({
      requestedVersion,
      currentVersion: GAME_VERSION,
      hadPlayableTab: Boolean(sessionStorage.getItem(authTabKey)),
      hasAccountToken: Boolean(localStorage.getItem(accountTokenKey)),
      consumedVersion,
    });
    if (legacyMode) sessionStorage.setItem(updateResumeConsumedKey, requestedVersion);
    return legacyMode;
  } catch {
    return explicitMode;
  }
}

