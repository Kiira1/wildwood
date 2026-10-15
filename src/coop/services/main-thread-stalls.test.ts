import { expect, it } from "vitest";
import { createMainThreadStalls } from "./main-thread-stalls";

it("counts only the part of each long task inside the round trip", () => {
  const stalls = createMainThreadStalls();
  stalls.note(100, 200); // 100-300
  stalls.note(900, 400); // 900-1300
  expect(stalls.blockedMs(200, 1000)).toBe(200);
  expect(stalls.blockedMs(400, 800)).toBe(0);
});

it("says unknown where the browser has no long-task timing", () => {
  expect(createMainThreadStalls().blockedMs(0, 1000)).toBeNull();
});
