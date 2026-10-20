import { expect, it } from "vitest";
import { reducerEventMs } from "./reducer-event-time";

it("reads the server's time only from replies to this client's own calls", () => {
  expect(reducerEventMs({ event: { tag: "Reducer", value: { timestamp: { microsSinceUnixEpoch: 1_234_567_890n } } } })).toBe(1_234_567);
  expect(reducerEventMs({ event: { tag: "Transaction" } })).toBeNull();
  expect(reducerEventMs({ event: { tag: "SubscribeApplied" } })).toBeNull();
  expect(reducerEventMs(undefined)).toBeNull();
});
