import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Recursively lists files under `dir` as URL paths (`/models/a.glb`), sorted for stable output. */
export function listFilesAsUrls(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFilesAsUrls(full, `${prefix}/${name}`));
    else out.push(`${prefix}/${name}`);
  }
  return out.sort();
}

export interface SwInputs {
  /** Emitted bundle files (relative, e.g. `assets/index-abc.js`, `index.html`). */
  bundleFiles: readonly string[];
  /** Static files copied from /public as URL paths. */
  publicUrls: readonly string[];
  /** Content of every public file keyed by URL, for the version hash. */
  publicContent: (url: string) => Uint8Array;
  /** Extra text mixed into the version hash (the worker template), so logic changes rotate the cache. */
  salt?: string;
}

export interface SwPlan {
  version: string;
  core: string[];
  extra: string[];
}

/**
 * Chooses what the worker precaches. CORE (must succeed): the page and its hashed code/styles/fonts.
 * EXTRA (best effort): models, icons and other static files.
 */
export function planPrecache(inputs: SwInputs): SwPlan {
  const bundle = inputs.bundleFiles.map((f) => `/${f}`).filter((u) => u !== '/sw.js');
  // index.html is emitted by Vite's html plugin after this hook runs, so name it explicitly.
  const core = ['/', '/index.html', ...bundle.filter((u) => u.startsWith('/assets/'))];
  const coreSet = new Set(core);
  const extra = [...bundle, ...inputs.publicUrls]
    .filter((u) => u !== '/sw.js' && !coreSet.has(u))
    .filter((u, i, all) => all.indexOf(u) === i)
    .sort();
  const h = createHash('sha1');
  h.update(inputs.salt ?? '');
  for (const u of [...core].sort()) h.update(`${u}\n`);
  for (const u of inputs.publicUrls) {
    h.update(`${u}:`);
    h.update(inputs.publicContent(u));
  }
  return { version: h.digest('hex').slice(0, 12), core, extra };
}

export function renderServiceWorker(template: string, plan: SwPlan): string {
  return template
    .replaceAll('__SW_VERSION__', plan.version)
    .replaceAll('__SW_CORE__', JSON.stringify(plan.core))
    .replaceAll('__SW_EXTRA__', JSON.stringify(plan.extra));
}

export function readPublicFile(publicDir: string, url: string): Uint8Array {
  return readFileSync(join(publicDir, url));
}
