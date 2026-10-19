import { expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { createDevBugDot, hasUnseenBug } from "./dev-bug-dot";

it("shows the developer a dot for a bug report newer than the Bugs tab last showed, until it is looked at", () => {
  const { document } = parseHTML("<html><body><button id=a></button><button id=b></button></body></html>");
  const targets = [document.getElementById("a")!, document.getElementById("b")!] as unknown as HTMLElement[];
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  let reports = [{ reportedAtMs: 100 }], developer = true;
  const dot = createDevBugDot({ targets, reports: () => reports, isDeveloper: () => developer, storage });
  const shown = () => targets.map(target => !(target.querySelector(".dev-bug-dot") as HTMLElement).hidden);
  expect(shown()).toEqual([true, true]);
  dot.markSeen();
  expect(shown()).toEqual([false, false]);
  reports = [...reports, { reportedAtMs: 200 }];
  dot.render();
  expect(shown()).toEqual([true, true]);
  developer = false;
  dot.render();
  expect(shown()).toEqual([false, false]);
  // Remembered on this device.
  developer = true;
  dot.markSeen();
  const again = createDevBugDot({ targets, reports: () => reports, isDeveloper: () => true, storage });
  again.render();
  expect(hasUnseenBug(reports, 200)).toBe(false);
  expect(shown()).toEqual([false, false]);
});
