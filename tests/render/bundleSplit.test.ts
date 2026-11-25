import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * First paint of 2d.html (title screen → world map) must not need the renderer or the battle:
 * main2d.ts loads battle2d.ts on demand (docs/handoff-perf.md). A static import from any of these
 * modules into Pixi or the battle would put ~1.2 MB of JS back in front of the title screen.
 * This walks the static import graph (type-only imports skipped; dynamic `import()` is the split).
 */
const ROOT = join(__dirname, '../..');
const IMPORT_RE =
  /^\s*import\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|^\s*export\s+(?!type\b)[^'";]*?\sfrom\s+['"]([^'"]+)['"]/gm;

function staticClosure(entry: string): Map<string, string | null> {
  const parent = new Map<string, string | null>([[entry, null]]);
  const stack = [entry];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith('.ts') || !existsSync(file)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      const target = spec.startsWith('.') ? resolve(dirname(file), spec) : `npm:${spec}`;
      if (!parent.has(target)) parent.set(target, file);
      stack.push(target);
    }
  }
  return parent;
}

function chainTo(graph: Map<string, string | null>, hit: string): string {
  const chain: string[] = [];
  for (let c: string | null | undefined = hit; c; c = graph.get(c)) chain.unshift(c.replace(ROOT + '/', ''));
  return chain.join(' -> ');
}

const FIRST_PAINT = [
  'src/render2d/main2d.ts',
  'src/render2d/bootShared2d.ts',
  'src/render2d/ui/titleScreen.ts',
  'src/render2d/ui/worldMap.ts',
];
const BATTLE_ONLY = [/^npm:pixi\.js/, /^npm:@pixi\//, /\/render2d\/battle2d\.ts$/, /\/render2d\/game2d\.ts$/, /\/sim\/world\.ts$/];

describe('2d.html first paint stays light (bundle split)', () => {
  for (const file of FIRST_PAINT) {
    it(`${file} does not statically reach Pixi or the battle`, () => {
      const graph = staticClosure(join(ROOT, file));
      const hits = [...graph.keys()].filter((k) => BATTLE_ONLY.some((re) => re.test(k)));
      expect(hits.map((h) => chainTo(graph, h))).toEqual([]);
    });
  }

  it('the battle is a dynamic import of the entry', () => {
    const main = readFileSync(join(ROOT, 'src/render2d/main2d.ts'), 'utf8');
    expect(main).toContain("import('./battle2d.ts')");
    expect(main).not.toMatch(/^import [^;]*'\.\/battle2d\.ts'/m);
  });

  it("Vite's preload helper is kept out of the vendor chunks", () => {
    const cfg = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(cfg).toMatch(/name: 'preload', test: \/vite\\\/preload-helper\/, priority: 3/);
  });
});
