import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Runtime imports between shared/*.ts files; type-only imports are erased, so they cannot loop.
const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'));
const known = new Set(files);
function imports(name: string) {
  const source = readFileSync(join(dir, name), 'utf8');
  const found = new Set<string>();
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"](\.\/[^'"]+)['"]/g)) {
    if (match[1]) continue;
    const target = match[2].slice(2).replace(/\.js$/, '');
    const file = known.has(target) ? target : `${target}.ts`;
    if (known.has(file)) found.add(file);
  }
  return found;
}

describe('shared modules', () => {
  it('import one another without cycles', () => {
    const edges = new Map(files.map(name => [name, imports(name)]));
    const state = new Map<string, 'open' | 'done'>();
    const cycles: string[] = [];
    const visit = (name: string, path: string[]) => {
      state.set(name, 'open');
      for (const next of edges.get(name)!) {
        if (state.get(next) === 'open') cycles.push([...path.slice(path.indexOf(next)), next].join(' -> '));
        else if (!state.has(next)) visit(next, [...path, next]);
      }
      state.set(name, 'done');
    };
    for (const name of files) if (!state.has(name)) visit(name, [name]);
    expect(cycles).toEqual([]);
  });
});
