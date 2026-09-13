import { expect, it, vi } from "vitest";
import { createProfileDirectory } from "./profile-directory";
import type { Identity } from "spacetimedb";
it("prunes inactive sender metadata after a busy chat session without evicting the current player", () => {
  const directory = createProfileDirectory({ localIdentity: () => "me", shouldRetain: (id: string) => id === "visible", notify: vi.fn() } as never);
  const remember = (id: string) => directory.rememberChatSender({ identity: id, identityValue: { toHexString: () => id } as Identity, name: id, isGuest: false });
  remember("me"); remember("visible");
  for (let i = 0; i < 10000; i++) remember(String(i));
  expect(directory.identityFor("0")).toBeUndefined();
  expect(directory.identityFor("9999")).toBeDefined();
  expect(directory.identityFor("me")).toBeDefined();
  expect(directory.identityFor("visible")).toBeDefined();
});
