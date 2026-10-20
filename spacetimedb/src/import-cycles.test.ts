import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The server build warns on circular imports, and a cycle can leave a module
// half-initialised at load. Type-only imports are erased, so they do not count.
const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts"));
const known = new Set(files);

function runtimeImports(name: string) {
  const source = readFileSync(new URL(name, dir), "utf8");
  const found = new Set<string>();
  const pattern = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["'](\.\/[^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) continue;
    const target = match[2].slice(2).replace(/\.js$/, "");
    for (const candidate of [target, `${target}.ts`]) if (known.has(candidate)) found.add(candidate);
  }
  return found;
}

function importCycles() {
  const edges = new Map(files.map(name => [name, runtimeImports(name)]));
  const cycles: string[][] = [];
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];
  const visit = (name: string) => {
    state.set(name, "open");
    stack.push(name);
    for (const next of edges.get(name) ?? []) {
      if (state.get(next) === "open") cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(name, "done");
  };
  for (const name of files) if (!state.has(name)) visit(name);
  return cycles.map(cycle => cycle.join(" -> "));
}

describe("server import graph", () => {
  it("reads the module's imports", () => {
    expect(runtimeImports("player-power.ts")).toContain("player-join-date.ts");
  });

  it("has no import cycles within spacetimedb/src", () => {
    expect(importCycles()).toEqual([]);
  });
});
