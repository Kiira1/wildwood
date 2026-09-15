export function createPatreonSupportForm(actions: { localDisplayName?: () => string; requestPatreonHelp: (email: string) => Promise<unknown> }) {
  const root = document.createElement("details"); root.className = "patreon-support-help";
  root.innerHTML = `<summary>Missing your frame?</summary>
    <form class="patreon-support-form">
      <label>In-game username<input name="character" readonly autocomplete="off"></label>
      <label>Patreon email<input name="email" type="email" maxlength="254" required autocomplete="email" placeholder="you@example.com"></label>
      <p>Sent privately to the developer to check your membership.</p>
      <button type="submit">Request help</button>
      <p role="status"></p>
    </form>`;
  const form = root.querySelector("form")!;
  const character = form.querySelector<HTMLInputElement>('[name="character"]')!;
  const email = form.querySelector<HTMLInputElement>('[name="email"]')!;
  const button = form.querySelector("button")!;
  const status = form.querySelector<HTMLElement>('[role="status"]')!;
  let revision = 0, busy = false;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !email.value.trim()) return;
    const version = revision;
    busy = true; button.disabled = true; status.textContent = "Sending…";
    try {
      await actions.requestPatreonHelp(email.value.trim());
      if (version !== revision) return;
      email.value = "";
      status.textContent = "Request sent. Your membership will be checked.";
    } catch (error) {
      if (version === revision) status.textContent = error instanceof Error ? error.message : "Couldn't send. Try again.";
    } finally { if (version === revision) { busy = false; button.disabled = false; } }
  });
  function reset() {
    revision++; busy = false; root.open = false; email.value = ""; status.textContent = ""; button.disabled = false;
    character.value = actions.localDisplayName?.() || "Current character";
  }
  return { element: root, reset };
}
