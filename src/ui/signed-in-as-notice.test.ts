import { describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createSignedInAsNotice } from "./signed-in-as-notice";

function setup(initial = "") {
  const { document } = parseHTML("<html><body></body></html>");
  let name = initial;
  const switchAccount = vi.fn();
  const notice = createSignedInAsNotice({ root: document as unknown as Document, name: () => name, switchAccount });
  const strip = document.getElementById("signedInAsNotice") as any;
  const buttons = strip.querySelectorAll("button") as any[];
  const click = (button: any) => button.dispatchEvent(new document.defaultView!.Event("click"));
  return { notice, strip, switchButton: buttons[0], keepButton: buttons[1], click, switchAccount, setName: (value: string) => { name = value; } };
}

describe("signed in as another character", () => {
  it("stays hidden until a sign-in loads someone else", () => {
    const f = setup();
    f.notice.poll();
    expect(f.strip.style.display).toBe("none");
    f.setName("Gehn");
    f.notice.poll();
    expect(f.strip.style.display).toBe("flex");
    expect(f.strip.textContent).toContain("Signed In As Gehn · Not You?");
    expect(f.strip.getAttribute("role")).toBe("status");
  });
  it("switches account on request and can be dismissed to keep playing", () => {
    const f = setup("Gehn");
    f.notice.poll();
    f.click(f.switchButton);
    expect(f.switchAccount).toHaveBeenCalledOnce();
    const kept = setup("Gehn");
    kept.notice.poll();
    kept.click(kept.keepButton);
    expect(kept.strip.style.display).toBe("none");
    kept.notice.poll();
    expect(kept.strip.style.display).toBe("none");
    expect(kept.switchAccount).not.toHaveBeenCalled();
  });
});
