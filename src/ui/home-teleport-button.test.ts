import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { bindHomeTeleportButton } from "./home-teleport-button";

function setup(teleport: () => Promise<boolean>) {
  const { document, Event } = parseHTML('<button id="home">Home</button>');
  const button = document.querySelector("button")! as unknown as HTMLButtonElement;
  const showFailure = vi.fn();
  bindHomeTeleportButton(button, { beforeTeleport: vi.fn(), teleport, showFailure });
  return { button, showFailure, click: () => button.dispatchEvent(new Event("click")) };
}

afterEach(() => vi.useRealTimers());

describe("Home toolbar cooldown", () => {
  it("blocks repeat clicks while teleporting and for five seconds after success", async () => {
    vi.useFakeTimers();
    let finish!: (changed: boolean) => void;
    const teleport = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const { button, click } = setup(teleport);
    click(); click();
    expect(teleport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(button.disabled).toBe(true);
    finish(true);
    await vi.advanceTimersByTimeAsync(4_999);
    click();
    expect(teleport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(button.disabled).toBe(false);
    click();
    expect(teleport).toHaveBeenCalledTimes(2);
  });

  it.each([false, new Error("offline")])("allows immediate retries after an unsuccessful teleport: %s", async result => {
    const teleport = vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    const { button, click, showFailure } = setup(teleport);
    click();
    await Promise.resolve();
    expect(button.disabled).toBe(false);
    expect(showFailure).toHaveBeenCalledWith(result instanceof Error);
    click();
    expect(teleport).toHaveBeenCalledTimes(2);
  });
});
