import { AGE_SLIDER_MAX, MINIMUM_PLAYER_AGE } from "../../shared/legal";

type LegalGateElements = {
  panel: HTMLElement;
  ageSlider: HTMLInputElement;
  ageOutput: HTMLOutputElement;
  continueButton: HTMLButtonElement;
  status: HTMLElement;
  /** Hidden or reworded on the start screen, which no longer asks the age. */
  intro?: HTMLElement | null; ageControl?: HTMLElement | null; notice?: HTMLElement | null;
};

type LegalGateDependencies = {
  accept: (age: number) => Promise<{ ok?: boolean; error?: string } | undefined> | { ok?: boolean; error?: string } | undefined;
  onAccepted: () => void;
  /**
   * False on the start screen: it only agrees to the Terms, and chat asks the age later.
   * Then the slider is hidden and Continue needs no age.
   */
  askAge?: boolean;
  /** An under-13 answer given in chat: the start screen says so and offers no Continue. */
  blocked?: () => boolean;
};
const UNDER_AGE = `WildStat is currently available to players age ${MINIMUM_PLAYER_AGE} and older.`;

export function legalGateElements(documentValue = document): LegalGateElements {
  function get<T extends HTMLElement>(id: string) {
    const element = documentValue.getElementById(id);
    if (!element) throw new Error(`Missing legal gate element #${id}`);
    return element as T;
  }
  return {
    panel: get("legalGatePanel"),
    ageSlider: get("legalAgeSlider"),
    ageOutput: get<HTMLOutputElement>("legalAgeOutput"),
    continueButton: get<HTMLButtonElement>("legalContinueBtn"),
    status: get("legalGateStatus"),
    intro: documentValue.getElementById("legalGateIntro"),
    ageControl: documentValue.getElementById("legalAgeSlider")?.parentElement ?? null,
    notice: documentValue.getElementById("legalAgreementNotice"),
  };
}

export function createLegalGateController(
  dependencies: LegalGateDependencies,
  elements = legalGateElements(),
) {
  let ageSelected = false;
  let pending = false;
  let statusOverride = "";

  const askAge = dependencies.askAge ?? true;
  function render() {
    if (!askAge) return renderTerms();
    const age = Number(elements.ageSlider.value);
    const eligible = ageSelected && Number.isInteger(age) && age >= MINIMUM_PLAYER_AGE;
    elements.ageSlider.classList.toggle("is-unset", !ageSelected);
    elements.ageSlider.setAttribute("aria-valuetext", ageSelected
      ? age >= AGE_SLIDER_MAX ? `${AGE_SLIDER_MAX} or older` : String(age)
      : "Not selected");
    elements.ageOutput.textContent = ageSelected
      ? age >= AGE_SLIDER_MAX ? `${AGE_SLIDER_MAX}+` : String(age)
      : "";
    elements.continueButton.disabled = pending || !eligible;
    elements.continueButton.textContent = pending ? "Saving…" : "Continue";
    elements.status.classList.toggle("is-blocked", ageSelected && !eligible);
    elements.status.textContent = statusOverride || (!ageSelected
      ? "Select your age to continue."
      : !eligible
        ? UNDER_AGE
        : "");
  }

  /** The start screen: the Terms and Continue, or the under-13 notice in their place. */
  function renderTerms() {
    const blocked = dependencies.blocked?.() === true;
    if (elements.ageControl) elements.ageControl.hidden = true;
    if (elements.intro) elements.intro.textContent = blocked ? "Sorry" : "Welcome to WildStat";
    if (elements.notice) elements.notice.hidden = blocked;
    elements.continueButton.hidden = blocked;
    elements.continueButton.disabled = pending || blocked;
    elements.continueButton.textContent = pending ? "Saving…" : "Continue";
    elements.status.classList.toggle("is-blocked", blocked);
    elements.status.textContent = statusOverride || (blocked ? UNDER_AGE : "");
  }

  async function accept() {
    if (elements.continueButton.disabled || (askAge && !ageSelected)) return;
    pending = true;
    statusOverride = "";
    render();
    const result = await dependencies.accept(Number(elements.ageSlider.value));
    pending = false;
    if (result?.ok !== true) {
      statusOverride = result?.error || "Could not save your agreement. Try again.";
      render();
      return;
    }
    elements.panel.hidden = true;
    dependencies.onAccepted();
  }

  function onAgeInput() {
    ageSelected = true;
    statusOverride = "";
    render();
  }

  function onContinue() {
    void accept();
  }

  elements.ageSlider.addEventListener("input", onAgeInput);
  elements.ageSlider.addEventListener("click", onAgeInput);
  elements.continueButton.addEventListener("click", onContinue);

  return {
    dispose() {
      elements.ageSlider.removeEventListener("input", onAgeInput);
      elements.ageSlider.removeEventListener("click", onAgeInput);
      elements.continueButton.removeEventListener("click", onContinue);
    },
    hide() { elements.panel.hidden = true; },
    show() {
      elements.panel.hidden = false;
      render();
    },
  };
}

export type { LegalGateDependencies, LegalGateElements };
