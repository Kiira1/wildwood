import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";
import { parseDraft, type Draft } from "../src/tools/sprite-aligner/state";

export const ALIGNMENT_FILE = "art-source/alignments/character-alignment.json";
const ENDPOINT = "/__sprite-aligner/alignment";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export class AlignmentConflict extends Error {}

export function alignmentStore(repo: string, vendorIds: Set<string>) {
  const file = resolve(repo, ALIGNMENT_FILE);
  const backup = resolve(repo, "local-data/sprite-aligner-backups/character-alignment.previous.json");
  const validate = (value: unknown) => parseDraft(value, id => vendorIds.has(id));
  let queue: Promise<unknown> = Promise.resolve();
  async function read() {
    try {
      const text = await readFile(file, "utf8");
      return { draft: validate(JSON.parse(text)), revision: hash(text), path: ALIGNMENT_FILE };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { draft: null, revision: null, path: ALIGNMENT_FILE };
      throw error;
    }
  }
  async function atomicWrite(path: string, text: string) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = path + "." + randomUUID() + ".tmp";
    try { await writeFile(temporary, text, { flag: "wx" }); await rename(temporary, path); }
    finally { await unlink(temporary).catch(() => {}); }
  }
  function save(value: unknown, revision: unknown) {
    const draft = validate(value);
    const operation = queue.then(async () => {
      const current = await read();
      if (revision !== current.revision) throw new AlignmentConflict("The project alignment changed in another tab. Load it before saving.");
      const text = JSON.stringify(draft, null, 2) + "\n";
      const nextRevision = hash(text);
      if (nextRevision !== current.revision) {
        if (current.draft) await atomicWrite(backup, JSON.stringify(current.draft, null, 2) + "\n");
        await atomicWrite(file, text);
      }
      return { revision: nextRevision, path: ALIGNMENT_FILE };
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return { read, save };
}

export function spriteAlignerStorage(repo: string, vendorIds: Set<string>): Plugin {
  const store = alignmentStore(repo, vendorIds);
  return { name: "wildstat-aligner-storage", configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split("?")[0] !== ENDPOINT) { next(); return; }
      const send = (status: number, value: unknown) => {
        response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(value));
      };
      const host = request.headers.host;
      if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) { send(403, { error: "Local access only." }); return; }
      void (async () => {
        if (request.method === "GET") { send(200, await store.read()); return; }
        if (request.method !== "POST") { send(405, { error: "Method not allowed." }); return; }
        if (request.headers.origin !== "http://" + host || request.headers["x-wildstat-aligner"] !== "1"
          || !request.headers["content-type"]?.startsWith("application/json")) {
          send(403, { error: "Save from the local sprite aligner." }); return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          const buffer = Buffer.from(chunk);
          size += buffer.length;
          if (size > 1_000_000) { send(413, { error: "Alignment is too large." }); return; }
          chunks.push(buffer);
        }
        let body: { draft: Draft; revision: string | null };
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); parseDraft(body.draft, id => vendorIds.has(id)); }
        catch { send(400, { error: "Invalid alignment file." }); return; }
        send(200, await store.save(body.draft, body.revision));
      })().catch(error => send(error instanceof AlignmentConflict ? 409 : 500, {
        error: error instanceof AlignmentConflict ? error.message : "Could not save the project file. Your browser draft is still available.",
      }));
    });
  } };
}
