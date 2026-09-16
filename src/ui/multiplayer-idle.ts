export const MULTIPLAYER_IDLE_MS = 5 * 60_000;

/** User input only: combat, autofarm, incoming chat, and rendering never renew this. */
export function installMultiplayerIdle(doc: Document, expire: () => void) {
  const win = doc.defaultView!;
  let enabled = false, lastInputAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pointers = new Set<number>(), keys = new Set<string>();
  const events = ["pointerdown", "pointermove", "pointerup", "pointercancel", "keydown", "keyup", "wheel", "input", "touchmove"];
  function check() {
    clearTimeout(timer);
    if (!enabled) return;
    const held = !doc.hidden && (pointers.size > 0 || keys.size > 0);
    if (held) lastInputAt = Date.now();
    const remaining = MULTIPLAYER_IDLE_MS - (Date.now() - lastInputAt);
    if (remaining <= 0) { enabled = false; expire(); return; }
    timer = setTimeout(check, held ? Math.min(1000, remaining) : remaining);
  }
  function input(event: Event) {
    if (!event.isTrusted) return;
    // Expire an overdue background session before this new input can renew it.
    if (enabled && Date.now() - lastInputAt >= MULTIPLAYER_IDLE_MS && !pointers.size && !keys.size) check();
    if (event.type === "pointerdown") pointers.add((event as PointerEvent).pointerId);
    if (event.type === "pointerup" || event.type === "pointercancel") pointers.delete((event as PointerEvent).pointerId);
    if (event.type === "keydown") keys.add((event as KeyboardEvent).code);
    if (event.type === "keyup") keys.delete((event as KeyboardEvent).code);
    lastInputAt = Date.now();
  }
  function releaseHeldInput() {
    if (pointers.size || keys.size) lastInputAt = Date.now();
    pointers.clear(); keys.clear();
  }
  function blur() { releaseHeldInput(); check(); }
  function visibility() { if (doc.hidden) releaseHeldInput(); check(); }
  for (const event of events) doc.addEventListener(event, input, { capture: true, passive: true });
  win.addEventListener("blur", blur);
  doc.addEventListener("visibilitychange", visibility);
  return {
    setEnabled(value: boolean) { enabled = value; lastInputAt = Date.now(); check(); },
    dispose() {
      clearTimeout(timer);
      for (const event of events) doc.removeEventListener(event, input, true);
      win.removeEventListener("blur", blur);
      doc.removeEventListener("visibilitychange", visibility);
    },
  };
}
