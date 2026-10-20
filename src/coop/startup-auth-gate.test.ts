import { describe, expect, it, vi } from "vitest";
import { createStartupAuthGate, loadDeferredGameBundle, preloadDeferredGameBundle, requestDeferredGameAssets, type StartupAuthElements } from "./startup-auth-gate";

class FakeElement {
  hidden = false;
  disabled = false;
  checked = false;
  textContent = "";
  value = "50";
  style = { display: "", width: "" };
  classes = new Set<string>();
  private listeners = new Map<string, Set<(event: Event) => void>>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    toggle: (name: string, active?: boolean) => {
      const enabled = active ?? !this.classes.has(name);
      if (enabled) this.classes.add(name);
      else this.classes.delete(name);
      return enabled;
    },
  };
  addEventListener(name: string, listener: (event: Event) => void) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }
  removeEventListener(name: string, listener: (event: Event) => void) {
    this.listeners.get(name)?.delete(listener);
  }
  setAttribute() {}
  click() {
    for (const listener of this.listeners.get("click") ?? []) listener({ stopPropagation() {} } as Event);
  }
}

function elements() {
  return {
    start: new FakeElement(),
    connectionPanel: new FakeElement(),
    accountChoicePanel: new FakeElement(),
    accountCharacter: new FakeElement(),
    accountCharacterName: new FakeElement(),
    accountChoiceDetail: new FakeElement(),
    signInButton: new FakeElement(),
    guestButton: new FakeElement(),
    switchAccountButton: new FakeElement(),
    consentSignInButton: new FakeElement(),
    loadingDetail: new FakeElement(),
    loadingFill: new FakeElement(),
    legal: {
      panel: new FakeElement(),
      ageSlider: new FakeElement(),
      ageOutput: new FakeElement(),
      agreement: new FakeElement(),
      termsLink: new FakeElement(),
      continueButton: new FakeElement(),
      status: new FakeElement(),
    },
  } as unknown as StartupAuthElements & {
    signInButton: FakeElement;
    guestButton: FakeElement;
    switchAccountButton: FakeElement;
    consentSignInButton: FakeElement;
    connectionPanel: FakeElement;
    legal: { panel: FakeElement; continueButton: FakeElement; status: FakeElement };
  };
}

describe("startup auth gate", () => {
  it("shows age and Terms immediately after Guest Login", async () => {
    const ui = elements();
    const loadGame = vi.fn(async () => {});
    let state = { signInReady: true, guestSessionApproved: false };
    const gate = createStartupAuthGate({
      accountState: () => state,
      knownCharacter: () => "",
      signIn: async () => ({ ok: true, redirecting: true }),
      continueAsGuest: () => {
        state = { ...state, guestSessionApproved: true };
        return { ok: true };
      },
      legalConsentAccepted: () => false,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: () => () => {},
      loadGame,
    }, ui);

    gate.start();
    expect(ui.accountChoicePanel.hidden).toBe(false);

    ui.guestButton.click();
    await Promise.resolve();

    expect(ui.legal.panel.hidden).toBe(false);
    expect(ui.accountChoicePanel.hidden).toBe(true);
    expect(loadGame).not.toHaveBeenCalled();
  });

  it("shows age and Terms immediately after registration returns", async () => {
    const ui = elements();
    const loadGame = vi.fn(async () => {});
    let state = { signInReady: true, gameSessionApproved: false };
    const gate = createStartupAuthGate({
      accountState: () => state,
      knownCharacter: () => "",
      signIn: async () => {
        state = { ...state, gameSessionApproved: true };
        return { ok: true, redirecting: false };
      },
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => false,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: () => () => {},
      loadGame,
    }, ui);

    gate.start();
    ui.signInButton.click();
    await Promise.resolve();

    expect(ui.legal.panel.hidden).toBe(false);
    expect(ui.accountChoicePanel.hidden).toBe(true);
    expect(loadGame).not.toHaveBeenCalled();
  });

  it("keeps the game unloaded while the player is choosing an identity", () => {
    const ui = elements();
    const loadGame = vi.fn(async () => {});
    const gate = createStartupAuthGate({
      accountState: () => ({ signInReady: true }),
      knownCharacter: () => "",
      signIn: async () => ({ ok: true, redirecting: true }),
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: () => () => {},
      loadGame,
    }, ui);

    gate.start();

    expect(ui.accountChoicePanel.hidden).toBe(false);
    expect(ui.connectionPanel.hidden).toBe(true);
    expect(loadGame).not.toHaveBeenCalled();
  });

  it("does not request game.js while OAuth is redirecting", async () => {
    const ui = elements();
    const loadGame = vi.fn(async () => {});
    const gate = createStartupAuthGate({
      accountState: () => ({ signInReady: true }),
      knownCharacter: () => "WANDERER",
      signIn: async () => ({ ok: true, redirecting: true }),
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: () => () => {},
      loadGame,
    }, ui);
    gate.start();

    ui.signInButton.click();
    await Promise.resolve();

    expect(ui.accountChoicePanel.hidden).toBe(false);
    expect(ui.connectionPanel.hidden).toBe(true);
    expect(ui.accountChoiceDetail.textContent).toBe("Opening Sign-In…");
    expect(loadGame).not.toHaveBeenCalled();
  });

  it("re-enables account choices after an OAuth navigation is canceled", async () => {
    const ui = elements();
    let state = { signInReady: true, returningFromSignIn: false };
    let notify = () => {};
    const gate = createStartupAuthGate({
      accountState: () => state,
      knownCharacter: () => "WANDERER",
      signIn: async () => {
        state = { ...state, returningFromSignIn: true };
        return { ok: true, redirecting: true };
      },
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: (listener) => { notify = listener; return () => {}; },
      loadGame: async () => {},
    }, ui);
    gate.start();

    ui.signInButton.click();
    await Promise.resolve();
    expect(ui.connectionPanel.hidden).toBe(true);

    state = { signInReady: true, returningFromSignIn: false };
    notify();

    expect(ui.connectionPanel.hidden).toBe(true);
    expect(ui.accountChoicePanel.hidden).toBe(false);
    expect(ui.signInButton.disabled).toBe(false);
    expect(ui.guestButton.disabled).toBe(false);
  });

  it("keeps registration visible while OAuth opens", async () => {
    const ui = elements();
    const gate = createStartupAuthGate({
      accountState: () => ({ signInReady: true }),
      knownCharacter: () => "",
      signIn: async () => ({ ok: true, redirecting: true }),
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: () => () => {},
      loadGame: async () => {},
    }, ui);
    gate.start();

    ui.signInButton.click();
    await Promise.resolve();

    expect(ui.accountChoicePanel.hidden).toBe(false);
    expect(ui.connectionPanel.hidden).toBe(true);
    expect(ui.accountChoiceDetail.textContent).toBe("Opening Registration…");
  });

  it("loads once after OAuth has approved the account session", () => {
    const ui = elements();
    let state = { signInReady: true, gameSessionApproved: false };
    let notify = () => {};
    const loadGame = vi.fn(async () => {});
    const gate = createStartupAuthGate({
      accountState: () => state,
      knownCharacter: () => "WANDERER",
      signIn: () => ({ ok: true }),
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: (listener) => { notify = listener; return () => {}; },
      loadGame,
    }, ui);
    gate.start();

    state = { ...state, gameSessionApproved: true };
    notify();
    notify();

    expect(ui.connectionPanel.hidden).toBe(false);
    expect(ui.accountChoicePanel.hidden).toBe(true);
    expect(ui.loadingDetail.textContent).toBe("Loading Your Character");
    expect(loadGame).toHaveBeenCalledTimes(1);
  });

  it("keeps OAuth return on loading and hides release notes", () => {
    const ui = elements();
    const releaseNotes = { show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
    const gate = createStartupAuthGate({
      accountState: () => ({ signInReady: true, returningFromSignIn: true, authInProgress: true }),
      knownCharacter: () => "WANDERER",
      signIn: () => ({ ok: true, redirecting: true }),
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: () => () => {},
      loadGame: async () => {},
      releaseNotes,
    }, ui);

    gate.start();

    expect(ui.connectionPanel.hidden).toBe(false);
    expect(ui.accountChoicePanel.hidden).toBe(true);
    expect(ui.loadingDetail.textContent).toBe("Verifying Sign-In");
    expect(releaseNotes.hide).toHaveBeenCalled();
    expect(releaseNotes.show).not.toHaveBeenCalled();
  });

  it("shows release notes only while account choice is idle", async () => {
    const ui = elements();
    const releaseNotes = { show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
    const gate = createStartupAuthGate({
      accountState: () => ({ signInReady: true }),
      knownCharacter: () => "WANDERER",
      signIn: () => ({ ok: true, redirecting: true }),
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: () => () => {},
      loadGame: async () => {},
      releaseNotes,
    }, ui);

    gate.start();
    expect(releaseNotes.show).toHaveBeenCalledTimes(1);

    ui.signInButton.click();
    await Promise.resolve();
    expect(releaseNotes.hide).toHaveBeenCalled();
  });

  it("returns to account choice only when sign-in fails", async () => {
    const ui = elements();
    const releaseNotes = { show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
    const gate = createStartupAuthGate({
      accountState: () => ({ signInReady: true }),
      knownCharacter: () => "WANDERER",
      signIn: async () => ({ ok: false, error: "SIGN-IN FAILED" }),
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: () => () => {},
      loadGame: async () => {},
      releaseNotes,
    }, ui);
    gate.start();

    ui.signInButton.click();
    expect(ui.connectionPanel.hidden).toBe(true);
    await Promise.resolve();

    expect(ui.connectionPanel.hidden).toBe(true);
    expect(ui.accountChoicePanel.hidden).toBe(false);
    expect(ui.accountChoiceDetail.textContent).toBe("SIGN-IN FAILED · TRY AGAIN OR USE GUEST LOGIN");
    expect(releaseNotes.show).toHaveBeenCalledTimes(2);
  });

  it("shows the callback timeout instead of replacing it with the normal sign-in prompt", () => {
    const ui = elements();
    const gate = createStartupAuthGate({
      accountState: () => ({
        knownAccount: true,
        signInReady: true,
        notice: "SIGN-IN TIMED OUT · TRY AGAIN",
      }),
      knownCharacter: () => "TACOMEL",
      signIn: () => ({ ok: true, redirecting: true }),
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: () => () => {},
      loadGame: async () => {},
    }, ui);

    gate.start();

    expect(ui.accountChoiceDetail.textContent).toBe("SIGN-IN TIMED OUT · TRY AGAIN OR USE GUEST LOGIN");
  });

  it("switches to Guest before loading the game", async () => {
    const ui = elements();
    const order: string[] = [];
    let state = { signInReady: true, guestSessionApproved: false };
    const gate = createStartupAuthGate({
      accountState: () => state,
      knownCharacter: () => "ACCOUNT HERO",
      signIn: () => ({ ok: true, redirecting: true }),
      continueAsGuest: () => {
        order.push("guest");
        state = { ...state, guestSessionApproved: true };
        return { ok: true };
      },
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: () => () => {},
      loadGame: async () => { order.push("game"); },
    }, ui);
    gate.start();

    ui.guestButton.click();
    await Promise.resolve();

    expect(order).toEqual(["guest", "game"]);
    expect(ui.loadingDetail.textContent).toBe("Loading Guest Profile");
  });
});

describe("deferred game assets", () => {
  function preloadDocument(present: string[] = []) {
    const appended: Record<string, unknown>[] = [];
    const listeners = new Map<string, () => void>();
    const doc = {
      head: { append: (link: Record<string, unknown>) => { appended.push(link); present.push(link.id as string); } },
      getElementById: (id: string) => id === "wildstatCoopScript" ? { dataset: { gameSrc: "assets/wildstat/game.abc.js" } } : present.includes(id) ? {} : null,
      createElement: () => ({ addEventListener: (event: string, listener: () => void) => listeners.set(event, listener) }),
    } as unknown as Document;
    return { doc, appended, listeners };
  }
  it("fetches game.js once, on the first frame, and says when it has downloaded", async () => {
    const { doc, appended, listeners } = preloadDocument();
    const downloaded = preloadDeferredGameBundle(doc, false);
    expect(downloaded).toBeInstanceOf(Promise);
    expect(preloadDeferredGameBundle(doc, false)).toBeNull();
    expect(appended).toEqual([expect.objectContaining({ id: "wildstatGamePreload", rel: "preload", as: "script", href: "assets/wildstat/game.abc.js" })]);
    listeners.get("load")!();
    await expect(downloaded).resolves.toBeUndefined();
  });
  it("does not preload under Data Saver or once game.js is loading", () => {
    expect(preloadDeferredGameBundle(preloadDocument().doc, true)).toBeNull();
    expect(preloadDeferredGameBundle(preloadDocument(["wildstatGameScript"]).doc, false)).toBeNull();
  });
  it("checks the deployed version when an old hashed game bundle fails", async () => {
    const listeners = new Map<string, () => void>();
    const script = {
      id: "", src: "", async: true, remove: vi.fn(),
      addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
    };
    const checkForUpdate = vi.fn();
    const doc = {
      body: { classList: { add: vi.fn() }, append: vi.fn() },
      querySelectorAll: () => [],
      getElementById: (id: string) => id === "wildstatCoopScript" ? { dataset: { gameSrc: "assets/wildstat/game.oldhash.js" } } : null,
      createElement: () => script,
    } as unknown as Document;
    const loading = loadDeferredGameBundle(doc, checkForUpdate);
    const failed = expect(loading).rejects.toThrow("Failed to load assets/wildstat/game.oldhash.js");
    listeners.get("error")!();
    await failed;
    expect(script.remove).toHaveBeenCalledOnce();
    expect(checkForUpdate).toHaveBeenCalledOnce();
  });

  it("requests game-only images when the loading screen hands off to game.js", () => {
    const addClass = vi.fn();
    const image = { dataset: { gameSrc: "assets/wildstat/gender/male-v2.webp" }, src: "" };
    requestDeferredGameAssets({
      body: { classList: { add: addClass } },
      querySelectorAll: () => [image],
    } as unknown as Document);

    expect(addClass).toHaveBeenCalledWith("is-loading-game-assets");
    expect(image.src).toBe("assets/wildstat/gender/male-v2.webp");
    expect(image.dataset.gameSrc).toBeUndefined();
  });
});

describe("outbound sign-in presentation", () => {
  it("keeps the account screen visible until navigation instead of flashing verification first", async () => {
    const ui = elements();
    let notify = () => {};
    let state = { signInReady: true, returningFromSignIn: false };
    let finish!: (result: { ok: boolean; redirecting: boolean }) => void;
    const gate = createStartupAuthGate({
      accountState: () => state,
      knownCharacter: () => "Player",
      signIn: () => new Promise(resolve => { finish = resolve; }),
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: listener => { notify = listener; return () => {}; },
      loadGame: async () => {},
    }, ui);
    gate.start();
    ui.signInButton.click();
    expect(ui.accountChoicePanel.hidden).toBe(false);
    expect(ui.connectionPanel.hidden).toBe(true);
    expect(ui.signInButton.disabled).toBe(true);
    state = { ...state, returningFromSignIn: true };
    notify();
    expect(ui.accountChoicePanel.hidden).toBe(false);
    expect(ui.connectionPanel.hidden).toBe(true);
    finish({ ok: true, redirecting: true });
    await Promise.resolve();
    expect(ui.connectionPanel.hidden).toBe(true);
    gate.dispose();
  });

  it("offers Use Another Account beside a found character, and it never signs in silently", async () => {
    const ui = elements();
    let name = "";
    const signIn = vi.fn(async () => ({ ok: true, redirecting: true }));
    const switchAccount = vi.fn(async () => ({ ok: true, redirecting: true }));
    let notify = () => {};
    const gate = createStartupAuthGate({
      accountState: () => ({ signInReady: true }),
      knownCharacter: () => name,
      signIn, switchAccount,
      continueAsGuest: () => ({ ok: true }),
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: listener => { notify = listener; return () => {}; },
      loadGame: async () => {},
    }, ui);
    gate.start();
    expect(ui.switchAccountButton.hidden).toBe(true);
    name = "Gehn";
    notify();
    expect(ui.switchAccountButton.hidden).toBe(false);
    ui.switchAccountButton.click();
    await Promise.resolve();
    expect(switchAccount).toHaveBeenCalledOnce();
    expect(signIn).not.toHaveBeenCalled();
    expect(ui.accountChoiceDetail.textContent).toBe("Opening Sign-In…");
    expect(ui.switchAccountButton.disabled).toBe(true);
    expect(ui.signInButton.disabled).toBe(true);
    gate.dispose();
  });
});

describe("guest by default", () => {
  function gate(options: {
    state: Record<string, unknown>;
    legalAccepted?: boolean;
    signIn?: () => Promise<{ ok: boolean; error?: string; redirecting?: boolean }>;
    gameDownload?: Promise<void> | null;
  }) {
    const ui = elements();
    const order: string[] = [];
    let state = options.state;
    let accepted = options.legalAccepted ?? false;
    let notify = () => {};
    const loadGame = vi.fn(async () => { order.push("game"); });
    const continueAsGuest = vi.fn(() => {
      order.push("guest");
      state = { ...state, guestSessionApproved: true };
      return { ok: true };
    });
    const signIn = vi.fn(options.signIn ?? (async () => ({ ok: true, redirecting: true })));
    const startup = createStartupAuthGate({
      accountState: () => state,
      knownCharacter: () => "",
      signIn,
      continueAsGuest,
      legalConsentAccepted: () => accepted,
      acceptLegalTerms: async () => { order.push("terms"); accepted = true; return { ok: true }; },
      subscribe: listener => { notify = listener; return () => {}; },
      loadGame,
      gameDownload: options.gameDownload,
    }, ui);
    return { ui, order, loadGame, continueAsGuest, signIn, startup, setState: (next: Record<string, unknown>) => { state = next; notify(); } };
  }

  it("shows a new visitor the Terms and Play on the loading screen, with Sign In, and no account choice", () => {
    const { ui, startup, continueAsGuest } = gate({ state: { signInReady: true, guestByDefault: true } });
    startup.start();
    expect(ui.accountChoicePanel.hidden).toBe(true);
    expect(ui.connectionPanel.hidden).toBe(false);
    expect(ui.connectionPanel.classes.has("is-consent")).toBe(true);
    expect(ui.legal.panel.hidden).toBe(false);
    expect(ui.legal.continueButton.textContent).toBe("Play");
    expect(ui.consentSignInButton.hidden).toBe(false);
    expect(continueAsGuest).not.toHaveBeenCalled();
  });

  it("records the agreement first, then starts the guest, then runs the game: one tap", async () => {
    const { ui, startup, order } = gate({ state: { signInReady: true, guestByDefault: true } });
    startup.start();
    ui.legal.continueButton.click();
    await vi.waitFor(() => expect(order).toEqual(["terms", "guest", "game"]));
    expect(ui.loadingDetail.textContent).toBe("Loading Guest Profile");
    expect(ui.connectionPanel.classes.has("is-consent")).toBe(false);
  });

  it("starts a visitor who already agreed as a guest without any tap", async () => {
    const { startup, order } = gate({ state: { signInReady: true, guestByDefault: true }, legalAccepted: true });
    startup.start();
    await vi.waitFor(() => expect(order).toEqual(["guest", "game"]));
  });

  it("waits on loading, choosing nothing, until the account restore has finished", () => {
    const { ui, startup, setState, continueAsGuest } = gate({ state: { signInReady: true, restoring: true }, legalAccepted: true });
    startup.start();
    expect(ui.accountChoicePanel.hidden).toBe(true);
    expect(ui.legal.panel.hidden).toBe(true);
    expect(ui.loadingDetail.textContent).toBe("Starting WildStat");
    expect(continueAsGuest).not.toHaveBeenCalled();
    setState({ signInReady: true, restoring: false, guestByDefault: false, knownAccount: true });
    expect(ui.accountChoicePanel.hidden).toBe(false);
    expect(continueAsGuest).not.toHaveBeenCalled();
  });

  it("lets Sign In under Play leave before any guest exists, and stays on that screen if it fails", async () => {
    const { ui, startup, signIn, continueAsGuest } = gate({
      state: { signInReady: true, guestByDefault: true },
      signIn: async () => ({ ok: false, error: "SIGN-IN NOT STARTED" }),
    });
    startup.start();
    ui.consentSignInButton.click();
    expect(ui.loadingDetail.textContent).toBe("Opening Sign-In…");
    expect(ui.consentSignInButton.disabled).toBe(true);
    await vi.waitFor(() => expect(ui.loadingDetail.textContent).toBe("Sign-In Failed · Try Again"));
    expect(signIn).toHaveBeenCalledOnce();
    expect(continueAsGuest).not.toHaveBeenCalled();
    expect(ui.accountChoicePanel.hidden).toBe(true);
    expect(ui.legal.panel.hidden).toBe(false);
    expect(ui.consentSignInButton.disabled).toBe(false);
  });

  it("hides Sign In once an account is signed in and only the Terms remain", () => {
    const { ui, startup } = gate({ state: { signInReady: true, gameSessionApproved: true } });
    startup.start();
    expect(ui.legal.panel.hidden).toBe(false);
    expect(ui.consentSignInButton.hidden).toBe(true);
  });

  it("moves the bar while game.js downloads, and holds at the download until Play", async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const gameDownload = new Promise<void>(resolve => { finish = resolve; });
      const { ui, startup } = gate({ state: { signInReady: true, guestByDefault: true }, gameDownload });
      startup.start();
      expect(ui.loadingFill.style.width).toBe("3%");
      expect(ui.loadingDetail.textContent).toBe("Downloading Game");
      vi.advanceTimersByTime(5_000);
      const crept = Number.parseFloat(ui.loadingFill.style.width);
      expect(crept).toBeGreaterThan(3);
      expect(crept).toBeLessThan(30);
      finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(ui.loadingFill.style.width).toBe("30%");
      expect(ui.loadingDetail.textContent).toBe("Game Downloaded");
      vi.advanceTimersByTime(5_000);
      expect(ui.loadingFill.style.width).toBe("30%");
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers the choice again, instead of retrying, when the automatic guest start fails", async () => {
    const ui = elements();
    const continueAsGuest = vi.fn(() => ({ ok: false, error: "SIGNING OUT" }));
    let notify = () => {};
    createStartupAuthGate({
      accountState: () => ({ signInReady: true, guestByDefault: true }),
      knownCharacter: () => "",
      signIn: async () => ({ ok: true, redirecting: true }),
      continueAsGuest,
      legalConsentAccepted: () => true,
      acceptLegalTerms: async () => ({ ok: true }),
      subscribe: listener => { notify = listener; return () => {}; },
      loadGame: async () => {},
    }, ui).start();
    await vi.waitFor(() => expect(ui.accountChoicePanel.hidden).toBe(false));
    expect(ui.accountChoiceDetail.textContent).toBe("GUEST LOGIN FAILED · TRY AGAIN");
    notify(); notify();
    await Promise.resolve();
    expect(continueAsGuest).toHaveBeenCalledOnce();
    expect(ui.accountChoicePanel.hidden).toBe(false);
  });
});
