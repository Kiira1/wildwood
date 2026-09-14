import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createProjectSave } from "./project-save";
import { freshDraft } from "./state";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  const { document } = parseHTML('<button id="export">Save to project</button><button id="loadProject" hidden>Load saved</button>');
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  let draft = freshDraft();
  const status = vi.fn();
  const saver = createProjectSave({ getDraft: () => draft, restore: value => { draft = value; }, status });
  return { saver, status, document, get draft() { return draft; } };
}
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body });
describe("automatic project saving", () => {
  it("exports an existing browser draft on first use, then coalesces edits", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(response({ draft: null, revision: null }))
      .mockResolvedValueOnce(response({ revision: "first" })).mockResolvedValue(response({ revision: "second" }));
    vi.stubGlobal("fetch", fetch);
    const test = setup();
    await test.saver.initialize(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    test.draft.skinTone = 1; test.saver.changed();
    test.draft.skinTone = 2; test.saver.changed();
    await vi.advanceTimersByTimeAsync(600);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({ draft: { skinTone: 2 }, revision: "first" });
    expect(test.status).toHaveBeenLastCalledWith("Saved to project ✓");
  });
  it("restores a project in a fresh browser without overwriting it", async () => {
    const saved = freshDraft(); saved.skinTone = 0;
    const fetch = vi.fn().mockResolvedValue(response({ draft: saved, revision: "existing" }));
    vi.stubGlobal("fetch", fetch);
    const test = setup(); await test.saver.initialize(false);
    expect(test.draft).toEqual(saved);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("pauses autosave when another tab changed the project", async () => {
    vi.useFakeTimers();
    const saved = freshDraft(); saved.skinTone = 0;
    const fetch = vi.fn().mockResolvedValue(response({ draft: saved, revision: "newer" }));
    vi.stubGlobal("fetch", fetch);
    const test = setup(); await test.saver.initialize(true);
    test.draft.skinTone = 2; test.saver.changed(); await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(test.document.getElementById("export")!.textContent).toBe("Save this draft instead");
  });
});
