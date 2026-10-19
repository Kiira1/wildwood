import { afterEach, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { installBuildHotkeys } from "./build-hotkeys";
import { defaultBindings, setControlBindings, withKey } from "./control-bindings";

afterEach(() => setControlBindings(defaultBindings()));

it("equips Build 1-3 on 1, 2 and 3, follows a remap, and leaves typing alone", () => {
  const { document, window } = parseHTML("<html><body><input id=chat></body></html>");
  const equipped: number[] = [];
  const stop = installBuildHotkeys(document as unknown as Document, slot => equipped.push(slot));
  const press = (code: string, target: EventTarget = document.body) => target.dispatchEvent(Object.assign(new window.Event("keydown", { bubbles: true, cancelable: true }), { code }));
  press("Digit1"); press("Digit3"); press("Digit4");
  expect(equipped).toEqual([0, 2]);
  press("Digit2", document.getElementById("chat")!);
  expect(equipped).toEqual([0, 2]);
  setControlBindings(withKey(defaultBindings(), "build2", "KeyB"));
  press("KeyB");
  expect(equipped).toEqual([0, 2, 1]);
  stop();
  press("Digit1");
  expect(equipped).toEqual([0, 2, 1]);
});
