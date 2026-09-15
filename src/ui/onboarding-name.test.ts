import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { chooseOnboardingName } from "./onboarding-name";

afterEach(() => vi.unstubAllGlobals());
function fixture(needsName = true) {
  const { document, window } = parseHTML("<html><body></body></html>");
  vi.stubGlobal("document", document);
  const abort = new AbortController();
  const commit = vi.fn(async (_name: string | null): Promise<{ ok: boolean; error?: string }> => ({ ok: true }));
  const result = chooseOnboardingName({ title: "Choose a username", needsName, commit, signal: abort.signal });
  const submit = () => document.querySelector("form")!.dispatchEvent(new window.Event("submit", { cancelable: true }));
  return { document, abort, commit, result, submit };
}
describe("tutorial username", () => {
  it("skips without submitting a replacement username", async () => {
    const f = fixture();
    f.document.querySelector<HTMLInputElement>("input")!.value = "Unsubmitted";
    f.document.querySelector<HTMLButtonElement>(".onboarding-skip")!.click();
    expect(await f.result).toBe(true);
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(null);
    expect(f.document.querySelector(".onboarding-name")).toBeNull();
  });
  it("keeps the form on a rejected name and prevents duplicate submissions", async () => {
    const f = fixture();
    f.document.querySelector<HTMLInputElement>("input")!.value = "  Player  ";
    f.commit.mockResolvedValueOnce({ ok: false, error: "Name unavailable" });
    f.submit(); f.submit();
    await Promise.resolve(); await Promise.resolve();
    expect(f.commit).toHaveBeenCalledExactlyOnceWith("Player");
    expect(f.document.querySelector("[role=status]")!.textContent).toBe("Name unavailable");
    f.submit();
    expect(await f.result).toBe(true);
  });
  it("finishes silently when a name was already chosen", async () => {
    const f = fixture(false);
    expect(await f.result).toBe(true);
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(null);
    expect(f.document.querySelector(".onboarding-name")).toBeNull();
  });
  it("offers a retry instead of a second name field when finishing fails", async () => {
    const { document, window } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    const commit = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }));
    commit.mockResolvedValueOnce({ ok: false, error: "Reconnect and try again." });
    const result = chooseOnboardingName({ title: "Choose a username", needsName: false, commit, signal: new AbortController().signal });
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector<HTMLElement>(".onboarding-name")!.hidden).toBe(false);
    expect(document.querySelector<HTMLInputElement>("input")!.hidden).toBe(true);
    expect(document.querySelector("[role=status]")!.textContent).toBe("Reconnect and try again.");
    document.querySelector("form")!.dispatchEvent(new window.Event("submit", { cancelable: true }));
    expect(await result).toBe(true);
    expect(commit).toHaveBeenCalledTimes(2);
  });
  it("closes on account cancellation without completing onboarding", async () => {
    const f = fixture();
    f.abort.abort();
    expect(await f.result).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.document.querySelector(".onboarding-name")).toBeNull();
  });
});
