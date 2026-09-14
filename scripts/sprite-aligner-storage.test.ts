import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALIGNMENT_FILE, AlignmentConflict, alignmentStore } from "./sprite-aligner-storage";
import { freshDraft } from "../src/tools/sprite-aligner/state";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup(vendorIds = new Set<string>()) {
  const root = await mkdtemp(join(tmpdir(), "wildstat-aligner-save-"));
  directories.push(root);
  return { root, store: alignmentStore(root, vendorIds) };
}
describe("sprite aligner project files", () => {
  it("saves vendor transforms to the fixed project path and backs up the preceding file", async () => {
    const { root, store } = await setup(new Set(["vendor:test-sword"]));
    const first = freshDraft();
    first.outfit.rightHandItem = "vendor:test-sword";
    first.adjustments["weapon:vendor:test-sword"] = { x: 12, y: 4, scale: .9, angle: -28, flipX: true, pivotX: .15, pivotY: .5 };
    const saved = await store.save(first, null);
    expect(JSON.parse(await readFile(join(root, ALIGNMENT_FILE), "utf8"))).toEqual(first);
    const second = structuredClone(first); second.adjustments["weapon:vendor:test-sword"].angle = -45;
    await store.save(second, saved.revision);
    expect((await store.read()).draft).toEqual(second);
    expect(JSON.parse(await readFile(join(root, "local-data/sprite-aligner-backups/character-alignment.previous.json"), "utf8"))).toEqual(first);
  });
  it("serializes competing saves and rejects stale revisions", async () => {
    const { store } = await setup();
    const first = freshDraft(), second = freshDraft(); second.skinTone = 0;
    const results = await Promise.allSettled([store.save(first, null), store.save(second, null)]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: expect.any(AlignmentConflict) });
    expect((await store.read()).draft).toEqual(first);
  });
  it("rejects invalid transforms without modifying a good saved alignment", async () => {
    const { store } = await setup();
    const good = freshDraft(), saved = await store.save(good, null);
    expect(() => store.save({ ...good, adjustments: { "weapon:starter_stone": { x: 0, y: 0, scale: 1, angle: Infinity } } }, saved.revision)).toThrow();
    expect(await store.read()).toMatchObject({ draft: good, revision: saved.revision });
  });
});
