import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { listFilesAsUrls, planPrecache, readPublicFile, renderServiceWorker } from './scripts/pwa/swBuilder.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** Emits dist/sw.js (versioned by a hash of every shipped file) for offline play + update prompts. */
function skyholdServiceWorker(): Plugin {
  const publicDir = resolve(ROOT, 'public');
  return {
    name: 'skyhold-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const template = readFileSync(resolve(ROOT, 'pwa/sw.template.js'), 'utf8');
      const publicUrls = listFilesAsUrls(publicDir).filter((u) => u !== '/sw.js');
      const plan = planPrecache({
        bundleFiles: Object.keys(bundle),
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
});
