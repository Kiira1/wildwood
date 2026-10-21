import { createGuildService } from "./guild-service";
import { createSocialService } from "./social-service";

type Dependencies = Parameters<typeof createSocialService>[0] & Parameters<typeof createGuildService>[0];

/** Guild membership and social chat share the root connection. */
export function createCommunityServices(dependencies: Dependencies) {
  return { guildService: createGuildService(dependencies), socialService: createSocialService(dependencies) };
}
