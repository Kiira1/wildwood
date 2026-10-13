import { createLegalGateController } from "./legal-gate";

type AgeResult = { ok?: boolean; error?: string; blocked?: boolean } | undefined;

/**
 * The age question, asked the first time chat is opened rather than on the start screen (Ryan, 2026-10-13).
 * 13 and older opens chat. Under 13 blocks the game as the start screen did: the page reloads onto its notice.
 */
export function createChatAgeGate(options: {
  verifyAge: (age: number) => Promise<AgeResult> | AgeResult;
  onVerified: () => void;
  reload?: () => void;
  documentValue?: Document;
}) {
  const doc = options.documentValue ?? document;
  const get = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const overlay = get("chatAgeGate");
  const gate = createLegalGateController({
    accept: async age => {
      const result = await options.verifyAge(age);
      if (result?.blocked) window.setTimeout(options.reload ?? (() => window.location.reload()), 2_500);
      return result;
    },
    onAccepted: () => { overlay.hidden = true; options.onVerified(); },
  }, {
    panel: get("chatAgeGate").querySelector<HTMLElement>(".chat-age-gate-modal")!,
    ageSlider: get<HTMLInputElement>("chatAgeSlider"),
    ageOutput: get<HTMLOutputElement>("chatAgeOutput"),
    continueButton: get<HTMLButtonElement>("chatAgeContinueBtn"),
    status: get("chatAgeStatus"),
  });
  const close = () => { overlay.hidden = true; };
  get("chatAgeBackBtn").addEventListener("click", close);
  return {
    open() { overlay.hidden = false; gate.show(); },
    close,
    isOpen: () => !overlay.hidden,
  };
}
