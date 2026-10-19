import { actionForKey, onControlAction, type ControlAction } from "./control-bindings";

const BUILD_ACTIONS: readonly ControlAction[] = ["build1", "build2", "build3"];

/** Build 1-3 on their keys (1, 2, 3 unless remapped) and any controller button bound to them: equip that build. */
export function installBuildHotkeys(doc: Document, equip: (slot: number) => void) {
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
    const slot = BUILD_ACTIONS.indexOf(actionForKey(event.code) as ControlAction);
    if (slot < 0) return;
    event.preventDefault();
    equip(slot);
  };
  doc.addEventListener("keydown", onKey);
  const stops = BUILD_ACTIONS.map((action, slot) => onControlAction(doc, action, () => equip(slot)));
  return () => { doc.removeEventListener("keydown", onKey); for (const stop of stops) stop(); };
}
