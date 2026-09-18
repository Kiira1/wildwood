/** A manual lookup avoids subscribing to every player's map or movement. */
export function createPlayerTravelControl(parent: HTMLElement, dependencies: {
  allowed: () => boolean;
  travel: (query: string) => Promise<void>;
  showMessage: (message: string, color: string) => void;
}) {
  const form = document.createElement("form");
  form.className = "setting-row dev-player-travel";
  form.innerHTML = `<label for="devPlayerTravelName">Teleport to player</label>
    <div class="dev-player-travel-actions"><input id="devPlayerTravelName" type="text" maxlength="80" placeholder="Username or account ID" autocomplete="off" required>
    <button class="secondary-button" type="submit">Teleport</button></div>`;
  const input = form.querySelector("input")!;
  const button = form.querySelector("button")!;
  let pending = false;
  const render = () => {
    form.hidden = !dependencies.allowed();
    input.disabled = button.disabled = pending || form.hidden;
    button.textContent = pending ? "Teleporting…" : "Teleport";
  };
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const query = input.value.trim();
    if (pending || !query || !dependencies.allowed()) return;
    pending = true; render();
    try { await dependencies.travel(query); }
    catch (error) { dependencies.showMessage(error instanceof Error ? error.message : "Teleport failed. Try again.", "#ff9b91"); }
    finally { pending = false; render(); }
  });
  parent.prepend(form); render();
  return { render, element: form };
}
