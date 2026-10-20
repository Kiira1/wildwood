import { afterEach, describe, expect, it, vi } from "vitest";
import { createStartupController, loadingDescriptionCase } from "./startup-controller";

type FakeElement = {
  hidden: boolean; disabled: boolean; textContent: string; value: string;
  style: { display: string; width: string };
  classList: { add: () => void; remove: () => void; toggle: () => void };
  addEventListener: (name: string, listener: () => void) => void;
  click: () => void;
};

function harness(initialStages: [string, boolean, number][], overrides: Partial<Parameters<typeof createStartupController>[0]> = {}) {
  let stages = initialStages;
  const elements = new Map<string, FakeElement>();
  vi.stubGlobal("document", {
    getElementById(id: string) {
      if (!elements.has(id)) {
        const listeners: (() => void)[] = [];
        elements.set(id, {
          hidden: false, disabled: false, textContent: "", value: "",
          style: { display: "", width: "" },
          classList: { add() {}, remove() {}, toggle() {} },
          addEventListener: (name, listener) => { if (name === "click") listeners.push(listener); },
          click: () => { for (const listener of listeners) listener(); },
        });
      }
      return elements.get(id)!;
    },
  });
  vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  const completed = vi.fn(() => startup.refreshLoading());
  const startup = createStartupController({
    accountState: () => undefined, connected: () => true, knownCharacter: () => "",
    knownCharacterGender: () => 0, defaultPlayerName: () => "WANDERER",
    getLoadingStages: () => stages, onLoadingComplete: completed,
    onShowAccountChoice() {}, acceptLegalTerms: async () => ({ ok: true }),
    onLegalAccepted() {}, onContinueGuest: () => ({}), onBeginAdventure() {},
    signIn: () => undefined, takeOverSession: () => undefined,
    onAccountActionStarted() {}, onAccountActionCompleted() {}, onAccountActionFailed() {},
    onRetryConnection() {}, showMessage() {},
    ...overrides,
  });
  return { startup, completed, elements, setStages: (next: typeof stages) => { stages = next; } };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("loading description case", () => {
  it("turns legacy all-caps notices into readable title case", () => {
    expect(loadingDescriptionCase("SIGNING OUT OTHER TAB…")).toBe("Signing Out Other Tab…");
    expect(loadingDescriptionCase("Loading Map Artwork")).toBe("Loading Map Artwork");
  });
});

describe("startup loading presentation", () => {
  it("shows every ready stage for 80ms, with the bar at what the stages before it finished, and completes once", () => {
    vi.useFakeTimers();
    const h = harness([["Connection", true, 12], ["Profile", true, 56], ["Starting", true, 100]]);
    h.startup.refreshLoading();
    for (const [label, finished] of [["Connection", 0], ["Profile", 12], ["Starting", 56]] as const) {
      expect(h.elements.get("loadingDetail")!.textContent).toBe(label);
      expect(h.elements.get("loadingFill")!.style.width).toBe(`${finished}%`);
      vi.advanceTimersByTime(79);
      h.startup.refreshLoading();
      expect(h.completed).not.toHaveBeenCalled();
      expect(h.elements.get("loadingDetail")!.textContent).toBe(label);
      vi.advanceTimersByTime(1);
    }
    expect(h.startup.isLoadingSequenceComplete()).toBe(true);
    expect(h.elements.get("loadingFill")!.style.width).toBe("100%");
    h.startup.refreshLoading(); vi.runOnlyPendingTimers();
    expect(h.completed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("creeps toward a slow stage without reaching it, and never moves the bar back", () => {
    vi.useFakeTimers();
    const h = harness([["Connection", false, 50], ["Starting", true, 100]]);
    const fill = h.elements.get("loadingFill")!;
    fill.style.width = "37%";
    h.startup.refreshLoading();
    expect(fill.style.width).toBe("37%");
    vi.advanceTimersByTime(60_000);
    const crept = Number.parseFloat(fill.style.width);
    expect(crept).toBeGreaterThan(40);
    expect(crept).toBeLessThan(50);
    h.startup.showConnectionFailure("World sync timed out");
    vi.advanceTimersByTime(1_000);
    expect(fill.style.width).toBe(`${crept}%`);
  });

  it("waits for real readiness without adding another delay after a slow stage", () => {
    vi.useFakeTimers();
    const h = harness([["Connection", false, 12], ["Starting", true, 100]]);
    h.startup.refreshLoading(); vi.advanceTimersByTime(800);
    expect(h.completed).not.toHaveBeenCalled();
    expect(h.elements.get("loadingDetail")!.textContent).toBe("Connection");
    h.setStages([["Connection", true, 12], ["Starting", true, 100]]);
    h.startup.refreshLoading(); vi.advanceTimersByTime(0);
    expect(h.elements.get("loadingDetail")!.textContent).toBe("Starting");
    vi.advanceTimersByTime(200);
    expect(h.completed).toHaveBeenCalledTimes(1);
  });

  it("rechecks readiness when a pending stage timer fires", () => {
    vi.useFakeTimers();
    const h = harness([["Starting", true, 100]]);
    h.startup.refreshLoading();
    h.setStages([["Starting", false, 100]]);
    vi.advanceTimersByTime(200);
    expect(h.completed).not.toHaveBeenCalled();
    h.setStages([["Starting", true, 100]]);
    h.startup.refreshLoading(); vi.advanceTimersByTime(0);
    expect(h.completed).toHaveBeenCalledTimes(1);
  });

  it("cancels completion on failure and starts a fresh paced sequence on retry", () => {
    vi.useFakeTimers();
    const h = harness([["Starting", true, 100]]);
    h.startup.refreshLoading(); vi.advanceTimersByTime(40);
    h.startup.showConnectionFailure("World sync timed out");
    vi.advanceTimersByTime(500);
    expect(h.completed).not.toHaveBeenCalled();
    expect(h.elements.get("loadingDetail")!.textContent).toBe("World sync timed out");
    expect(h.elements.get("connectionRetryBtn")!.hidden).toBe(false);
    h.startup.showConnecting(); vi.advanceTimersByTime(79);
    expect(h.completed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.completed).toHaveBeenCalledTimes(1);
  });

  it("does not spend visible stage time behind account choice", () => {
    vi.useFakeTimers();
    const h = harness([["Starting", true, 100]]);
    h.startup.refreshLoading(); vi.advanceTimersByTime(40);
    h.startup.showAccountChoice(); h.startup.refreshLoading(); vi.advanceTimersByTime(1000);
    expect(h.completed).not.toHaveBeenCalled();
    h.startup.showLoading(); vi.advanceTimersByTime(79);
    expect(h.completed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.completed).toHaveBeenCalledTimes(1);
  });
});

describe("startup account choice", () => {
  it("offers Use Another Account only beside a found character and sends it to the account switch", () => {
    let name = "";
    const signIn = vi.fn(async () => ({ ok: true, redirecting: true }));
    const switchAccount = vi.fn(async () => ({ ok: true, redirecting: true }));
    const onAccountActionStarted = vi.fn();
    const h = harness([["Starting", true, 100]], { knownCharacter: () => name, signIn, switchAccount, onAccountActionStarted });
    h.startup.showAccountChoice();
    const button = h.elements.get("useAnotherAccountBtn")!;
    expect(button.hidden).toBe(true);
    name = "Gehn";
    h.startup.showAccountChoice();
    expect(button.hidden).toBe(false);
    button.click();
    expect(onAccountActionStarted).toHaveBeenCalledWith("sign-in", "OPENING SIGN-IN…");
    expect(switchAccount).toHaveBeenCalledOnce();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("lets a browser with no account and no server connection press REGISTER", () => {
    const signIn = vi.fn(async () => ({ ok: true, redirecting: true }));
    const h = harness([["Starting", true, 100]], {
      connected: () => false, signIn,
      accountState: () => ({ knownAccount: false, signInRequired: false, signInReady: true }),
    });
    h.startup.showAccountChoice();
    const button = h.elements.get("signInFromStartBtn")!;
    expect(button.textContent).toBe("REGISTER");
    expect(button.disabled).toBe(false);
    button.click();
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("still waits for the server before linking a saved guest", () => {
    const h = harness([["Starting", true, 100]], {
      connected: () => false,
      accountState: () => ({ knownAccount: false, signInRequired: false, signInReady: false }),
    });
    h.startup.showAccountChoice();
    expect(h.elements.get("signInFromStartBtn")!.disabled).toBe(true);
    expect(h.elements.get("accountChoiceDetail")!.textContent).toBe("CONNECTING ACCOUNT OPTIONS…");
  });
});
