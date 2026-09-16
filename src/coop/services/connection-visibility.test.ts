import { expect, it } from "vitest";
import { createConnectionVisibility } from "./connection-visibility";
import { normalizeConnectionDiagnostic } from "../../../shared/connection-diagnostics";
it("distinguishes background, recent return, and ordinary foreground events", () => {
  let now = 0; const visibility = createConnectionVisibility(() => now);
  expect(visibility.snapshot().activity).toBe("foreground");
  visibility.hide(); now = 3000; visibility.hide();
  expect(visibility.snapshot()).toMatchObject({ activity: "background", hiddenForMs: 3000 });
  visibility.show(); now = 3500; visibility.show();
  expect(visibility.snapshot()).toEqual({ activity: "tab-return", hiddenForMs: 3000, sinceVisibleMs: 500 });
  now = 34000; expect(visibility.snapshot().activity).toBe("foreground");
});
it("keeps protocol faults distinct even when they happen after a tab return", () => {
  const sample = { eventId: "abcdefgh", kind: "socket-close", code: 1002, activity: "tab-return", hiddenForMs: 3000 };
  expect(normalizeConnectionDiagnostic(sample)).toMatchObject({ category: "protocol-error", activity: "tab-return", hiddenForMs: 3000, code: 1002 });
  expect(normalizeConnectionDiagnostic({ ...sample, code: 1006 })).toMatchObject({ category: "tab-away", code: 1006 });
  expect(normalizeConnectionDiagnostic({ ...sample, activity: "foreground", code: 1006 })).toMatchObject({ category: "connection-failure" });
  expect(normalizeConnectionDiagnostic({ ...sample, kind: "connection-reset", intentional: true, detail: "route-change" })).toMatchObject({ category: "portal-transition" });
});
it("does not call old foreground logs normal or infer a tab switch they did not record", () => {
  expect(normalizeConnectionDiagnostic({ eventId: "abcdefgh", kind: "socket-close", code: 1006, hidden: false })).toMatchObject({ activity: "unknown", category: "connection-failure" });
});
