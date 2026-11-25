/**
 * Bundle report for the 2D game (docs/handoff-perf.md).
 *
 * Builds with the repo's vite config into a scratch dir and prints, for 2d.html:
 * - `initial`: the entry chunk + its static imports (what the browser must fetch before main() runs),
 * - `map`: initial + the title screen + world map closures (first paint of title → world map),
 * - `battle`: initial + the battle path (game2d, battle HUD),
 * - `total`: every JS/CSS file the build emits,
 * and the biggest modules of the initial set (so a regression names its culprit).
 *
 * Usage: `npm run perf:bundle` (writes nothing into the repo; `--json` prints a machine summary,
 * `--out=DIR` keeps the build somewhere else, default a temp dir that is deleted afterwards).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, type Plugin, type Rollup } from 'vite';

type Bundle = Rollup.OutputBundle;

interface Sizes {
  js: number;
  css: number;
  jsGz: number;
  cssGz: number;
  files: number;
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const outArg = args.find((a) => a.startsWith('--out='))?.slice('--out='.length);

function cssOf(out: Rollup.OutputChunk): string[] {
  const meta = (out as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata;
  return [...(meta?.importedCss ?? [])];
}

/** Static closure (chunk.imports) of the given chunk files, plus the CSS those chunks import. */
function closure(bundle: Bundle, roots: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const out = bundle[f];
    if (!out || out.type !== 'chunk') continue;
    stack.push(...out.imports, ...cssOf(out));
  }
  return seen;
}

function sizeOf(bundle: Bundle, files: Iterable<string>): Sizes {
  const s: Sizes = { js: 0, css: 0, jsGz: 0, cssGz: 0, files: 0 };
  for (const f of files) {
    const out = bundle[f];
    if (!out) continue;
    const code = out.type === 'chunk' ? out.code : out.source;
    const buf = typeof code === 'string' ? Buffer.from(code) : Buffer.from(code);
    if (f.endsWith('.js')) {
      s.js += buf.length;
      s.jsGz += gzipSync(buf).length;
    } else if (f.endsWith('.css')) {
      s.css += buf.length;
      s.cssGz += gzipSync(buf).length;
    } else continue;
    s.files += 1;
  }
  return s;
}

/** Chunk files whose facade (or any module) id ends with one of the given source paths. */
function chunksFor(bundle: Bundle, sources: string[]): string[] {
  const hits: string[] = [];
  for (const [file, out] of Object.entries(bundle)) {
    if (out.type !== 'chunk') continue;
    const ids = Object.keys(out.modules);
    if (sources.some((s) => ids.some((id) => id.endsWith(s)))) hits.push(file);
  }
  return hits;
}

function entryFor(bundle: Bundle, html: string): string {
  for (const [file, out] of Object.entries(bundle)) {
    if (out.type === 'chunk' && out.isEntry && out.facadeModuleId?.endsWith('/' + html)) return file;
  }
  throw new Error(`no entry for ${html}`);
}

const ROOT = process.cwd() + '/';
const kb = (n: number): string => `${(n / 1024).toFixed(1)} kB`;

function report(bundle: Bundle): void {
  const entry = entryFor(bundle, '2d.html');
  const initial = closure(bundle, [entry]);
  const map = closure(bundle, [entry, ...chunksFor(bundle, ['/render2d/ui/titleScreen.ts', '/render2d/ui/worldMap.ts'])]);
  const battle = closure(bundle, [entry, ...chunksFor(bundle, ['/render2d/game2d.ts', '/render2d/ui/battleHud.ts'])]);
  const all = Object.keys(bundle).filter((f) => f.endsWith('.js') || f.endsWith('.css'));
  const rows: [string, Sizes][] = [
    ['initial (2d.html static)', sizeOf(bundle, initial)],
    ['title + world map', sizeOf(bundle, map)],
    ['battle', sizeOf(bundle, battle)],
    ['total emitted', sizeOf(bundle, all)],
  ];
  // Biggest source modules of the initial set (rendered, pre-minify-ish lengths per module).
  const mods: [string, number][] = [];
  for (const f of initial) {
    const out = bundle[f];
    if (!out || out.type !== 'chunk') continue;
    for (const [id, m] of Object.entries(out.modules)) mods.push([id.startsWith(ROOT) ? id.slice(ROOT.length) : id, m.renderedLength]);
  }
  mods.sort((a, b) => b[1] - a[1]);
  const big = Object.entries(bundle)
    .filter(([f]) => f.endsWith('.js'))
    .map(([f, o]) => [f, o.type === 'chunk' ? o.code.length : 0] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  if (asJson) {
    const order = (set: Set<string>): string[] => [...set].sort();
    const paths = { initial: order(initial), map: order(map), battle: order(battle) };
    const chunkModules: Record<string, [string, number][]> = {};
    for (const [f, o] of Object.entries(bundle)) {
      if (o.type !== 'chunk') continue;
      chunkModules[f] = Object.entries(o.modules)
        .map(([id, m]) => [id.startsWith(ROOT) ? id.slice(ROOT.length) : id, m.renderedLength] as [string, number])
        .sort((a, b) => b[1] - a[1]);
    }
    process.stdout.write(JSON.stringify({ rows: Object.fromEntries(rows), modules: mods, chunks: big, paths, chunkModules }, null, 1) + '\n');
    return;
  }
  process.stdout.write('\n2D bundle (2d.html)\n');
  for (const [name, s] of rows) {
    process.stdout.write(
      `${name.padEnd(26)} JS ${kb(s.js).padStart(10)} (gz ${kb(s.jsGz).padStart(9)})  CSS ${kb(s.css).padStart(9)} (gz ${kb(s.cssGz).padStart(8)})  files ${s.files}\n`,
    );
  }
  process.stdout.write('\nlargest chunks:\n');
  for (const [f, n] of big) process.stdout.write(`  ${kb(n).padStart(10)}  ${f}\n`);
  process.stdout.write('\nlargest modules in the initial set:\n');
  for (const [id, n] of mods.slice(0, 30)) process.stdout.write(`  ${kb(n).padStart(10)}  ${id}\n`);
}

function reporter(): Plugin {
  return {
    name: 'skyhold-bundle-report',
    apply: 'build',
    generateBundle(_o, bundle) {
      report(bundle);
    },
  };
}

const outDir = outArg ?? mkdtempSync(join(tmpdir(), 'skyhold-bundle-'));
try {
  await build({ logLevel: 'error', plugins: [reporter()], build: { outDir, emptyOutDir: true, reportCompressedSize: false } });
} finally {
  if (!outArg) rmSync(outDir, { recursive: true, force: true });
}
