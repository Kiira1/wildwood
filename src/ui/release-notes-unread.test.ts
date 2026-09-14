import { afterEach, expect, it, vi } from "vitest";
import { createReleaseNotesIndicator } from "./release-notes-unread";

const active: ReturnType<typeof createReleaseNotesIndicator>[] = [];
afterEach(() => { active.splice(0).forEach(indicator => indicator.dispose()); vi.unstubAllGlobals(); });
function setup() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  let releases = [{ version: "dot-test", notes: ["New notes"] }];
  function indicator() {
    const attributes = new Map<string, string>();
    const control = createReleaseNotesIndicator({ setAttribute: (key, value) => attributes.set(key, value) }, () => releases);
    active.push(control);
    return { ...control, unread: () => attributes.get("data-unread-notes") };
  }
  return { indicator, setReleases: (next: typeof releases) => { releases = next; } };
}

it("stays unread until opened, synchronizes both version buttons, and remembers reopening", () => {
  const h = setup();
  const signin = h.indicator();
  const game = h.indicator();
  expect(signin.unread()).toBe("true");
  expect(game.unread()).toBe("true");
  game.markRead();
  expect(signin.unread()).toBe("false");
  expect(game.unread()).toBe("false");
  expect(h.indicator().unread()).toBe("false");
  h.setReleases([{ version: "dot-test-next", notes: ["Next update"] }]);
  game.refresh();
  expect(game.unread()).toBe("true");
  game.markRead();
  h.setReleases([{ version: "dot-test-next", notes: ["Next update", "Additional note"] }]);
  game.refresh();
  expect(game.unread()).toBe("true");
});

it("does not show a dot for an empty notes list", () => {
  const h = setup();
  h.setReleases([]);
  expect(h.indicator().unread()).toBe("false");
});
