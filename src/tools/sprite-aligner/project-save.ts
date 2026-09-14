import { parseDraft, type Draft } from "./state";

const ENDPOINT = "/__sprite-aligner/alignment";
const REVISION_KEY = "wildstat-character-studio-project-revision";
type Snapshot = { draft: Draft | null; revision: string | null; path: string };
type Options = {
  getDraft: () => Draft;
  restore: (draft: Draft) => void;
  status: (message: string, error?: boolean) => void;
};

export function createProjectSave(options: Options) {
  const saveButton = document.getElementById("export") as HTMLButtonElement;
  const loadButton = document.getElementById("loadProject") as HTMLButtonElement;
  let revision: string | null = null, initialized = false, conflict = false;
  let pending: string | null = null, writing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = () => JSON.stringify(options.getDraft());
  const remember = () => { try { localStorage.setItem(REVISION_KEY, revision ?? ""); } catch { /* File save still succeeded. */ } };
  async function read(): Promise<Snapshot> {
    const response = await fetch(ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error("Project save unavailable. Your browser draft is safe; use Save to project to retry.");
    const result = await response.json() as Snapshot;
    if (!result || !(result.revision === null || typeof result.revision === "string")) throw new Error("Restart the sprite aligner to enable project saving.");
    return { ...result, draft: result.draft ? parseDraft(result.draft) : null };
  }
  function showConflict() {
    conflict = true;
    saveButton.textContent = "Save this draft instead";
    loadButton.hidden = false;
    options.status("Project changed elsewhere. Load saved, or save this draft instead.", true);
  }
  async function flush() {
    clearTimeout(timer);
    if (!initialized || conflict || writing || pending === null) return;
    writing = true;
    const text = pending; pending = null;
    options.status("Saving to project…");
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "x-wildstat-aligner": "1" },
        body: JSON.stringify({ draft: JSON.parse(text), revision }) });
      if (response.status === 409) { pending ??= text; showConflict(); return; }
      const result = await response.json() as { revision: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Project save failed. Your browser draft is safe.");
      revision = result.revision; remember();
      if (pending === null) options.status("Saved to project ✓");
    } catch (error) {
      pending ??= text;
      options.status(error instanceof Error ? error.message : "Project save failed. Your browser draft is safe.", true);
      return;
    } finally { writing = false; }
    if (pending !== null) void flush();
  }
  function changed() {
    pending = current();
    if (conflict) return;
    clearTimeout(timer);
    options.status("Unsaved project changes…");
    timer = setTimeout(() => void flush(), 600);
  }
  async function initialize(hasLocalDraft: boolean) {
    const initial = current();
    try {
      const saved = await read(); revision = saved.revision; initialized = true;
      let previousRevision: string | null = null;
      try { previousRevision = localStorage.getItem(REVISION_KEY); } catch { /* Browser storage may be disabled. */ }
      if (saved.draft && !hasLocalDraft && current() === initial && pending === null) {
        options.restore(saved.draft); remember(); options.status("Loaded project alignment"); return;
      }
      if (saved.draft && JSON.stringify(saved.draft) !== current() && previousRevision !== revision) { showConflict(); return; }
      if (saved.draft && JSON.stringify(saved.draft) === current()) {
        pending = null; remember(); options.status("Saved to project ✓"); return;
      }
      pending = current(); await flush();
    } catch (error) { options.status(error instanceof Error ? error.message : "Project save unavailable. Your browser draft is safe.", true); }
  }
  saveButton.addEventListener("click", async () => {
    if (writing) return;
    if (!initialized) { await initialize(true); return; }
    if (conflict) {
      // An explicit overwrite uses a fresh revision; another intervening write
      // still produces a conflict instead of silently overwriting it.
      try { revision = (await read()).revision; }
      catch { options.status("Could not reach the project. Your browser draft is safe.", true); return; }
      conflict = false; loadButton.hidden = true; saveButton.textContent = "Save to project";
    }
    pending = current(); await flush();
  });
  loadButton.addEventListener("click", async () => {
    const initial = current();
    try {
      const saved = await read();
      if (!saved.draft || current() !== initial) return;
      options.restore(saved.draft); revision = saved.revision; remember();
      conflict = false; pending = null; loadButton.hidden = true; saveButton.textContent = "Save to project";
      options.status("Loaded project alignment");
    } catch { options.status("Could not load the project. Your browser draft is safe.", true); }
  });
  window.addEventListener("beforeunload", event => {
    if (pending !== null || writing) { event.preventDefault(); event.returnValue = ""; }
  });
  return { changed, initialize };
}
