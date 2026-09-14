import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, relative, basename } from "node:path";
import { createHash } from "node:crypto";
import { ITEM_PRESENTATIONS } from "../src/game/item-presentation";

/** Local-only metadata. Vendor artwork is served on demand, never bundled into the game. */
export function scanVendorWeapons(repo: string) {
  const root = resolve(repo, "art-source/vendor");
  if (!existsSync(root)) return [];
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const gameArt = new Map<string, string>();
  for (const [id, value] of Object.entries(ITEM_PRESENTATIONS)) {
    const world = value.world;
    if (world?.kind !== "SPRITE" || world.layer !== "HAND") continue;
    const path = resolve(repo, "public", world.source);
    const bytes = world.source.startsWith("data:image/png;base64,")
      ? Buffer.from(world.source.split(",")[1], "base64")
      : existsSync(path) ? readFileSync(path) : null;
    if (bytes) gameArt.set(hash(bytes), id);
  }
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.png$/i.test(entry.name))
    .map(entry => resolve(entry.parentPath, entry.name))
    .filter(path => path.includes("[Expansion]") && path.includes("/HandRight/") && !path.includes("/Arrow/"))
    .map(path => {
      const source = "/" + relative(repo, path).split("/").map(encodeURIComponent).join("/");
      const category = basename(resolve(path, ".."));
      const label = basename(path, ".png").replace(/^FA_WP_Main_/, "").replace(/_/g, " · ").replace(/([a-z])([A-Z])/g, "$1 $2");
      return { id: "vendor:" + relative(root, path), source, category, label, gameItemId: gameArt.get(hash(readFileSync(path))) };
    }).sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}
