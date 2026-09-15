/** One small optional name form, shown only after the map has faded to black. */
export function chooseOnboardingName(options: {
  title: string;
  needsName?: boolean;
  commit: (name: string | null) => Promise<{ ok: boolean; error?: string }>;
  signal: AbortSignal;
}) {
  return new Promise<boolean>(resolve => {
    if (options.signal.aborted) { resolve(false); return; }
    const host = document.createElement("section");
    host.className = "onboarding-name";
    host.setAttribute("role", "dialog"); host.setAttribute("aria-modal", "true"); host.setAttribute("aria-labelledby", "onboardingNameTitle");
    host.innerHTML = '<form><label id="onboardingNameTitle" for="onboardingUsername"></label><input id="onboardingUsername" name="username" placeholder="Username" autocomplete="nickname" autocapitalize="none" spellcheck="false" maxlength="20"><p role="status"></p><button type="submit" class="window-back-button">Continue</button><button type="button" class="onboarding-skip">Skip</button></form>';
    const needsName = options.needsName !== false;
    host.querySelector("label")!.textContent = needsName ? options.title : "Ready to play";
    const form = host.querySelector("form")!, input = host.querySelector("input")!, status = host.querySelector("p")!;
    const buttons = [...host.querySelectorAll("button")];
    if (!needsName) { input.hidden = true; buttons[1].hidden = true; host.hidden = true; }
    let pending = false;
    const close = (success: boolean) => { options.signal.removeEventListener("abort", abort); host.remove(); resolve(success); };
    const abort = () => close(false);
    options.signal.addEventListener("abort", abort, { once: true });
    async function submit(skip: boolean) {
      if (pending) return;
      const name = input.value.trim().replace(/\s+/g, " ");
      skip ||= !needsName;
      if (!skip && !name) { input.focus(); return; }
      pending = true; buttons.forEach(button => { button.disabled = true; }); input.disabled = true; input.blur();
      status.textContent = "";
      let result;
      try { result = await options.commit(skip ? null : name); } catch { result = { ok: false, error: "Connection interrupted. Try again." }; }
      if (options.signal.aborted) return;
      if (result.ok) { close(true); return; }
      host.hidden = false;
      if (!needsName) buttons[0].textContent = "Retry";
      pending = false; buttons.forEach(button => { button.disabled = false; }); input.disabled = false;
      status.textContent = result.error || "Could not continue. Try again.";
    }
    form.addEventListener("submit", event => { event.preventDefault(); void submit(false); });
    buttons[1].addEventListener("click", () => { void submit(true); });
    document.body.append(host);
    if (!needsName) void submit(true);
  });
}
