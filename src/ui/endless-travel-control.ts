type EndlessTravelDependencies = {
  allowed: () => boolean;
  travel: (number: number) => Promise<boolean>;
  showMessage: (message: string, color: string) => void;
};

/** Also usable by a local guest with only the server's narrow travel permission. */
export function createEndlessTravelControl(parent: HTMLElement, dependencies: EndlessTravelDependencies) {
  const row = document.createElement("form");
  row.className = "setting-row";
  row.hidden = true;
  row.innerHTML = `<span>ENDLESS · DEV</span><div class="dev-load-test-actions">
    <input type="number" min="1" max="${Number.MAX_SAFE_INTEGER}" step="1" value="1" inputmode="numeric" aria-label="Endless map number" required />
    <button class="secondary-button" type="submit">GO</button></div>`;
  const input = row.querySelector("input")!;
  const button = row.querySelector("button")!;
  parent.append(row);
  let pending = false;
  function render() {
    row.hidden = !dependencies.allowed();
    input.disabled = button.disabled = pending || row.hidden;
    button.textContent = pending ? "GOING…" : "GO";
  }
  row.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending || !dependencies.allowed()) return;
    const number = Number(input.value);
    if (!Number.isSafeInteger(number) || number < 1) {
      dependencies.showMessage("ENTER A POSITIVE WHOLE MAP NUMBER", "#ffbc91");
      return;
    }
    pending = true;
    render();
    try {
      if (!await dependencies.travel(number)) dependencies.showMessage("TELEPORT UNAVAILABLE · TRY AGAIN", "#ffbc91");
    } catch (error) {
      dependencies.showMessage(error instanceof Error ? error.message : "TELEPORT FAILED · TRY AGAIN", "#ffbc91");
    } finally {
      pending = false;
      render();
    }
  });
  render();
  return { render, element: row };
}
