import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type Rollup } from 'vite';
import { listFilesAsUrls, planPrecache, readPublicFile, renderServiceWorker } from './scripts/pwa/swBuilder.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

type Bundle = Rollup.OutputBundle;

/**
 * Output files reachable only from the `from` HTML entry (not from `other`): JS chunks plus the
 * CSS/assets they import. Used to keep the 2D slice out of the 3D game's precache.
 */
function chunksOnlyReachableFrom(bundle: Bundle, from: string, other: string): Set<string> {
  const reach = (html: string): Set<string> => {
    const seen = new Set<string>();
    const stack: string[] = [];
    for (const [file, out] of Object.entries(bundle)) {
      if (out.type === 'chunk' && out.isEntry && out.facadeModuleId?.endsWith('/' + html)) stack.push(file);
    }
    while (stack.length > 0) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const out = bundle[f];
      if (!out || out.type !== 'chunk') continue;
      const meta = (out as { viteMetadata?: { importedCss?: Set<string>; importedAssets?: Set<string> } }).viteMetadata;
      for (const dep of [...out.imports, ...out.dynamicImports, ...(meta?.importedCss ?? []), ...(meta?.importedAssets ?? [])]) {
        stack.push(dep);
      }
    }
    return seen;
  };
  const a = reach(from);
  const b = reach(other);
  if (b.size === 0) return new Set();
  return new Set([...a].filter((f) => !b.has(f)));
}

/** Emits dist/sw.js (versioned by a hash of every shipped file) for offline play + update prompts. */
function skyholdServiceWorker(): Plugin {
  const publicDir = resolve(ROOT, 'public');
  return {
    name: 'skyhold-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const template = readFileSync(resolve(ROOT, 'pwa/sw.template.js'), 'utf8');
      // The 2D slice (2d.html, its chunks and public/art2d) is not part of the offline 3D game.
      const publicUrls = listFilesAsUrls(publicDir).filter((u) => u !== '/sw.js' && !u.startsWith('/art2d/'));
      const only2d = chunksOnlyReachableFrom(bundle, '2d.html', 'index.html');
      const plan = planPrecache({
        bundleFiles: Object.keys(bundle).filter((f) => f !== '2d.html' && !only2d.has(f)),
        publicUrls,
        publicContent: (u) => readPublicFile(publicDir, u),
        salt: template,
      });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: renderServiceWorker(template, plan) });
    },
  };
}

export default defineConfig({
  plugins: [skyholdServiceWorker()],
  build: {
    rollupOptions: {
      // index.html = the Three.js game (unchanged); 2d.html = the Pixi 2D slice (art-2d P0).
      input: {
        main: resolve(ROOT, 'index.html'),
        slice2d: resolve(ROOT, '2d.html'),
      },
      output: {
        // three.js (~60% of the JS) changes far less often than game code: its own chunk downloads in
        // parallel with the app chunk and stays cached across deploys.
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/pixi.js/') || id.includes('/node_modules/@pixi/')) return 'pixi';
          return undefined;
        },
      },
    },
  },
});
