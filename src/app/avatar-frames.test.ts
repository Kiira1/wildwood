import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import type { AvatarFrameState } from "../../shared/avatar-frames";

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document); vi.stubGlobal("window", window);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const player = "a".repeat(64);
const gold = (): AvatarFrameState => ({ identity: player, tier: "gold", frame: "gold", validUntilMs: Date.now() + 60_000 });
function portrait() { const el = document.createElement("span"); document.body.append(el); return el; }

it("shares membership, lookups, and sign-out across separately built game and network modules", async () => {
  const network = await import("./avatar-frames");
  vi.resetModules();
  const game = await import("./avatar-frames");
  const fetcher = vi.fn(async () => [gold()]);
  network.configureAvatarFrames(fetcher);
  game.bindAvatarFrames(network.applyAvatarFrame);
  const chat = portrait(), profile = portrait();
  game.applyAvatarFrame(chat, player);
  game.applyAvatarFrame(profile, player);
  await vi.advanceTimersByTimeAsync(40);
  expect(fetcher).toHaveBeenCalledTimes(1);
  for (const el of [chat, profile]) {
    expect(el.dataset.avatarFrame).toBe("gold");
    expect(el.querySelectorAll(".avatar-frame-art")).toHaveLength(1);
  }
  network.updateAvatarFrame({ ...gold(), frame: "silver" });
  expect(profile.dataset.avatarFrame).toBe("silver");
  network.clearAvatarFrames();
  expect(chat.dataset.avatarFrame).toBe("none");
  expect(profile.querySelector("img")).toBeNull();
});

it("shares a cached lookup across repeated renders and portraits while a request is pending", async () => {
  const frames = await import("./avatar-frames");
  let finish!: (rows: AvatarFrameState[]) => void;
  const fetcher = vi.fn(() => new Promise<AvatarFrameState[]>(resolve => { finish = resolve; }));
  frames.configureAvatarFrames(fetcher);
  const first = portrait(), second = portrait();
  frames.applyAvatarFrame(first, player);
  await vi.advanceTimersByTimeAsync(40);
  for (let i = 0; i < 100; i++) { frames.applyAvatarFrame(first, player); frames.applyAvatarFrame(second, player); }
  finish([gold()]);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(first.dataset.avatarFrame).toBe("gold");
  expect(second.querySelectorAll(".avatar-frame-art")).toHaveLength(1);
  const image = first.querySelector("img");
  frames.applyAvatarFrame(first, player);
  expect(first.querySelector("img")).toBe(image);
});
it("ignores a stale response after sign-out and hides an expired frame without another fetch", async () => {
  const frames = await import("./avatar-frames");
  let finish!: (rows: AvatarFrameState[]) => void;
  frames.configureAvatarFrames(() => new Promise(resolve => { finish = resolve; }));
  const el = portrait(); frames.applyAvatarFrame(el, player);
  await vi.advanceTimersByTimeAsync(40);
  frames.clearAvatarFrames(); finish([gold()]);
  await vi.advanceTimersByTimeAsync(1);
  expect(el.dataset.avatarFrame).toBe("none");
  frames.updateAvatarFrame(gold());
  expect(el.dataset.avatarFrame).toBe("gold");
  await vi.advanceTimersByTimeAsync(90_000);
  expect(el.dataset.avatarFrame).toBe("none");
  expect(el.querySelector("img")).toBeNull();
});
it("batches more than 50 visible players into bounded requests", async () => {
  const frames = await import("./avatar-frames");
  const fetcher = vi.fn(async (ids: string[]) => ids.map(identity => ({ identity, tier: "none" as const, frame: "none" as const, validUntilMs: 0 })));
  frames.configureAvatarFrames(fetcher);
  for (let i = 0; i < 101; i++) frames.applyAvatarFrame(portrait(), i.toString(16).padStart(64, "0"));
  await vi.advanceTimersByTimeAsync(200);
  expect(fetcher.mock.calls.map(([ids]) => ids.length)).toEqual([50, 50, 1]);
});
