import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The parts of a browser a booted game waits on, served from public/ as the
 * site would serve them: images load with their real size (from the file's
 * header), fetch returns the shipped files, and anything else never answers.
 */

const PUBLIC = fileURLToPath(new URL("../../../public/", import.meta.url));
const ORIGIN = "https://wildstatmmo.com/";

function publicPath(source: string) {
  try {
    const url = new URL(source, ORIGIN);
    if (url.origin !== new URL(ORIGIN).origin) return null;
    const path = PUBLIC + decodeURIComponent(url.pathname).replace(/^\//, "");
    return existsSync(path) ? path : null;
  } catch { return null; }
}

const sizes = new Map<string, { width: number; height: number } | null>();
/** Width and height from a PNG, WebP, JPEG or SVG header. */
export function imageSize(path: string) {
  if (sizes.has(path)) return sizes.get(path)!;
  let size: { width: number; height: number } | null = null;
  try {
    const bytes = readFileSync(path);
    if (bytes.toString("ascii", 1, 4) === "PNG") size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    else if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
      const chunk = bytes.toString("ascii", 12, 16);
      if (chunk === "VP8X") size = { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      else if (chunk === "VP8L") {
        const bits = bytes.readUInt32LE(21);
        size = { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      } else if (chunk === "VP8 ") size = { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      for (let offset = 2; offset < bytes.length;) {
        const marker = bytes[offset + 1];
        const length = bytes.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xc3) { size = { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }; break; }
        offset += 2 + length;
      }
    } else if (path.endsWith(".svg")) {
      const text = bytes.toString("utf8");
      const width = Number(/width="([\d.]+)/.exec(text)?.[1]), height = Number(/height="([\d.]+)/.exec(text)?.[1]);
      const box = /viewBox="[\d.\s-]+?\s([\d.]+)\s([\d.]+)"/.exec(text);
      size = width && height ? { width, height } : box ? { width: Number(box[1]), height: Number(box[2]) } : { width: 64, height: 64 };
    }
  } catch { size = null; }
  sizes.set(path, size);
  return size;
}

type Listener = (event: { type: string; target: unknown }) => void;

/** An <img> that loads shipped files at their real size and fails anything else. */
export class LoadingImage {
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  width = 0;
  height = 0;
  crossOrigin: string | null = null;
  decoding = "auto";
  onload: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private source = "";
  get src() { return this.source; }
  set src(value: string) {
    this.source = value;
    this.complete = false;
    const path = publicPath(value);
    const size = path ? imageSize(path) : null;
    queueMicrotask(() => {
      if (this.source !== value) return;
      this.complete = true;
      if (size) {
        this.naturalWidth = this.width = size.width;
        this.naturalHeight = this.height = size.height;
        this.emit("load");
      } else this.emit("error");
    });
  }
  decode() { return this.naturalWidth ? Promise.resolve() : Promise.reject(new Error("Image failed")); }
  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: Listener) { this.listeners.get(type)?.delete(listener); }
  setAttribute(name: string, value: string) { if (name === "src") this.src = value; }
  getAttribute(name: string) { return name === "src" ? this.source : null; }
  /** Releasing an image drops its source (a map's art unloaded on travel). */
  removeAttribute(name: string) { if (name === "src") { this.source = ""; this.complete = false; this.naturalWidth = this.naturalHeight = this.width = this.height = 0; } }
  private emit(type: "load" | "error") {
    const event = { type, target: this };
    (type === "load" ? this.onload : this.onerror)?.(event);
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

/** fetch for the site's own files; anything else (the network) never answers unless `route` does. */
export function siteFetch(route?: (url: URL, init?: RequestInit) => Response | Promise<Response> | null) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ORIGIN);
    const routed = route?.(url, init);
    if (routed) return routed;
    const path = publicPath(url.href);
    if (path) {
      const body = readFileSync(path);
      const type = path.endsWith(".json") ? "application/json" : path.endsWith(".html") ? "text/html" : "application/octet-stream";
      return new Response(body, { status: 200, headers: { "content-type": type } });
    }
    return new Promise<Response>(() => {});
  };
}
