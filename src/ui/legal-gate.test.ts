import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { createLegalGateController, legalGateElements } from "./legal-gate";
import { MINIMUM_PLAYER_AGE } from "../../shared/legal";

describe("age selection consent", () => {
  it("requires an eligible age and an explicit Continue click beneath both policy links", async () => {
    const { document } = parseHTML(readFileSync("public/index.html", "utf8"));
    const elements = legalGateElements(document);
    const accept = vi.fn(async () => ({ ok: true })), onAccepted = vi.fn();
    const gate = createLegalGateController({ accept, onAccepted }, elements);
    gate.show();
    expect(document.querySelector("#legalTermsLink")!.getAttribute("href")).toBe("terms.html");
    expect(document.querySelector("#legalPrivacyLink")!.getAttribute("href")).toBe("privacy.html");
    expect(elements.continueButton.disabled).toBe(true);
    elements.ageSlider.value = String(MINIMUM_PLAYER_AGE - 1); elements.ageSlider.click();
    expect(elements.continueButton.disabled).toBe(true);
    elements.ageSlider.value = String(MINIMUM_PLAYER_AGE); elements.ageSlider.click();
    expect(elements.continueButton.disabled).toBe(false);
    expect(accept).not.toHaveBeenCalled();
    elements.continueButton.click(); elements.continueButton.click();
    await Promise.resolve();
    expect(accept).toHaveBeenCalledExactlyOnceWith(MINIMUM_PLAYER_AGE);
    expect(onAccepted).toHaveBeenCalledOnce();
    gate.dispose();
  });

  it("on the loading screen asks only for the Terms with one Play button, or shows the under-13 notice in their place", async () => {
    const { document } = parseHTML(readFileSync("public/index.html", "utf8"));
    const elements = legalGateElements(document);
    let blocked = false;
    const accept = vi.fn(async () => ({ ok: true })), onAccepted = vi.fn();
    const gate = createLegalGateController({ accept, onAccepted, askAge: false, blocked: () => blocked }, elements);
    gate.show();
    expect(elements.panel.closest("#connectionPanel")).not.toBeNull();
    expect(elements.ageControl!.hidden).toBe(true);
    expect(elements.intro!.hidden).toBe(true);
    expect(elements.continueButton.textContent).toBe("Play");
    expect(elements.notice!.textContent).toContain("By pressing Play");
    expect(document.querySelector("#legalTermsLink")!.getAttribute("href")).toBe("terms.html");
    expect(document.querySelector("#legalPrivacyLink")!.getAttribute("href")).toBe("privacy.html");
    expect(elements.continueButton.disabled).toBe(false);
    elements.continueButton.click();
    await Promise.resolve();
    expect(accept).toHaveBeenCalledOnce();
    expect(onAccepted).toHaveBeenCalledOnce();
    blocked = true;
    gate.show();
    expect([elements.continueButton.hidden, elements.notice!.hidden, elements.intro!.hidden]).toEqual([true, true, false]);
    expect(elements.status.textContent).toContain(`${MINIMUM_PLAYER_AGE} and older`);
    gate.dispose();
  });
});
