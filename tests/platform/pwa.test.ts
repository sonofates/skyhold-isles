import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planPrecache, renderServiceWorker } from '../../scripts/pwa/swBuilder.ts';

const enc = new TextEncoder();
function inputs(extraPublic = 'v1'): Parameters<typeof planPrecache>[0] {
  return {
    bundleFiles: ['index.html', 'assets/index-AAA.js', 'assets/index-BBB.css', 'assets/font-CCC.woff2', 'sw.js'],
    publicUrls: ['/favicon.svg', '/models/a.glb'],
    publicContent: (u) => enc.encode(u === '/models/a.glb' ? extraPublic : 'static'),
  };
}

describe('service worker plan', () => {
  it('precaches the page and hashed assets as CORE, everything else as EXTRA', () => {
    const plan = planPrecache(inputs());
    expect(plan.core).toEqual(['/', '/index.html', '/assets/index-AAA.js', '/assets/index-BBB.css', '/assets/font-CCC.woff2']);
    expect(plan.extra).toEqual(['/favicon.svg', '/models/a.glb']);
    expect(plan.core).not.toContain('/sw.js');
    expect(plan.extra).not.toContain('/sw.js');
  });

  it('version is stable for identical content and changes with any shipped file', () => {
    const a = planPrecache(inputs());
    expect(planPrecache(inputs()).version).toBe(a.version);
    expect(planPrecache(inputs('v2')).version).not.toBe(a.version);
    const moved = inputs();
    const b = planPrecache({ ...moved, bundleFiles: [...moved.bundleFiles.slice(0, 1), 'assets/index-ZZZ.js'] });
    expect(b.version).not.toBe(a.version);
  });

  it('renders a worker with no leftover placeholders and valid JSON lists', () => {
    const template = readFileSync('pwa/sw.template.js', 'utf8');
    const plan = planPrecache(inputs());
    const out = renderServiceWorker(template, plan);
    expect(out).not.toMatch(/__SW_[A-Z]+__/);
    expect(out).toContain(`const VERSION = '${plan.version}'`);
    expect(out).toContain(JSON.stringify(plan.core));
    // must be syntactically valid JavaScript
    expect(() => new Function(out)).not.toThrow();
  });

  it('keeps the update flow explicit: no unconditional skipWaiting', () => {
    const template = readFileSync('pwa/sw.template.js', 'utf8');
    expect(template).toMatch(/SKIP_WAITING/);
    const installBlock = template.slice(template.indexOf("addEventListener('install'"), template.indexOf("addEventListener('message'"));
    expect(installBlock).not.toContain('skipWaiting');
  });
});

describe('web app manifest', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
    name: string;
    display: string;
    start_url: string;
    theme_color: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
  };

  it('installs fullscreen with a name, start url and theme colour', () => {
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('ships 192 + 512 icons and a maskable one, all present on disk', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) expect(existsSync(`public${icon.src}`)).toBe(true);
  });

  it('index.html links the manifest, theme colour and touch icon', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('viewport-fit=cover');
  });
});

describe('service worker template vs the 2D build', () => {
  const tpl = readFileSync('pwa/sw.template.js', 'utf8');
  it('lets 2d.html and /art2d/ go to the network (no cache-first, no stale manifest)', () => {
    expect(tpl).toContain("url.pathname === '/2d.html' || url.pathname.startsWith('/art2d/')");
  });
  it('only stores the offline shell for the 3D page itself', () => {
    expect(tpl).toMatch(/path === '\/' \|\| path === '\/index\.html'/);
  });
});
