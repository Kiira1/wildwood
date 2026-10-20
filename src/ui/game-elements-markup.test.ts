import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameDocument } from "../../tests/helpers/game-document";
import { createGameElements } from "./game-elements";

// The game throws on startup when a required element is missing, and no other
// test boots the game. 0.916.7 shipped lookups of popups whose markup was removed.

const srcRoot = new URL("../", import.meta.url);
// The Balance Lab has its own page, and dom.ts only defines the helpers.
const skippedFiles = new Set(["balance/main.ts", "game/runtime/dom.ts"]);

function gameSourceFiles() {
  return readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
    .filter(path => path.endsWith(".ts") && !path.endsWith(".test.ts") && !skippedFiles.has(path))
    .map(path => ({ path, source: readFileSync(new URL(path, srcRoot), "utf8") }))
    .filter(file => /\brequired(Element|Selector)\b/.test(file.source));
}

afterEach(() => vi.unstubAllGlobals());

describe("game element lookups", () => {
  it("finds every element the game builder requires in the startup page", () => {
    vi.stubGlobal("document", createGameDocument());
    const skinTones = { names: ["Light", "Dark"], colors: ["#f1c27d", "#8d5524"] };

    expect(() => createGameElements(skinTones)).not.toThrow();
  });

  it("finds every literal id and selector any startup controller requires", () => {
    const document = createGameDocument();
    const files = gameSourceFiles();
    const missing: string[] = [];
    let checked = 0;
    for (const { path, source } of files) {
      for (const [, kind, argument] of source.matchAll(/\brequired(Element|Selector)(?:<[^>]*>)?\(\s*([^)]*)\)/g)) {
        const literal = /^["'`]([^"'`$]+)["'`]$/.exec(argument.trim());
        // A computed id cannot be checked here; pass the id itself instead.
        if (!literal) {
          missing.push(`${path}: required${kind}(${argument}) is not a literal`);
          continue;
        }
        checked += 1;
        const found = kind === "Element" ? document.getElementById(literal[1]) : document.querySelector(literal[1]);
        if (!found) missing.push(`${path}: ${literal[1]}`);
      }
    }

    expect(files.map(file => file.path)).toContain("ui/game-elements.ts");
    expect(checked).toBeGreaterThan(300);
    expect(missing).toEqual([]);
  });
});
