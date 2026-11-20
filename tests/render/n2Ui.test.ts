import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickTreeFit, TREE_FIT_STEPS, type TreeLayout } from '../../src/render2d/ui/heroScreens.ts';
import { loadFraction, shouldShowTitle, titleArt, titleLogo, TITLE_SKIP_PARAMS } from '../../src/render2d/ui/titleScreen.ts';
import { creditSections } from '../../src/render2d/ui/credits2d.ts';
import { setLocale } from '../../src/i18n/index.ts';

describe('skill tree fit (heroScreens.ts)', () => {
  it('tries the vertical tree first, largest zoom first, then the across tree largest first', () => {
    const downs = TREE_FIT_STEPS.filter((s) => s[0] === 'down').map((s) => s[1]);
    const across = TREE_FIT_STEPS.filter((s) => s[0] === 'across').map((s) => s[1]);
    expect(TREE_FIT_STEPS[0]).toEqual(['down', 1]);
    expect(TREE_FIT_STEPS.findIndex((s) => s[0] === 'across')).toBe(downs.length);
    expect([...downs].sort((a, b) => b - a)).toEqual(downs);
    expect([...across].sort((a, b) => b - a)).toEqual(across);
    // Never shrinks the vertical tree a lot (it switches layout instead), nor the across one below ~3/4.
    expect(Math.min(...downs)).toBeGreaterThanOrEqual(0.8);
    expect(Math.min(...across)).toBeGreaterThanOrEqual(0.7);
  });

  it('picks the first step that fits, the smallest across step when nothing does', () => {
    const tried: string[] = [];
    const fit = (ok: (l: TreeLayout, z: number) => boolean) =>
      pickTreeFit((l, z) => {
        tried.push(`${l}${z}`);
        return ok(l, z);
      });
    expect(fit(() => true)).toEqual(['down', 1]);
    expect(fit((l, z) => l === 'down' && z <= 0.9)).toEqual(['down', 0.88]);
    expect(fit((l, z) => l === 'across' && z <= 1)).toEqual(['across', 1]);
    expect(fit(() => false)).toEqual(TREE_FIT_STEPS[TREE_FIT_STEPS.length - 1]);
    expect(tried.length).toBeGreaterThan(0);
  });

  it('node text keeps at least 90 % of its size whatever the zoom; the across layout has its connectors', () => {
    const css = readFileSync(join(__dirname, '../../src/render2d/ui/heroScreens.css'), 'utf8');
    expect(css).toMatch(/--nt: calc\(var\(--s\) \* max\(var\(--tz\), 0\.9\)\)/);
    expect(css).toMatch(/\.pu-hnode-name \{\s*font-size: calc\(var\(--nt\)/);
    expect(css).toContain(".pu-hero-tree-grid[data-layout='across'] .pu-hnode-wrap.tier4::after");
    expect(css).toContain(".pu-hero-tree-grid[data-layout='across'] .pu-hero-cap-bar");
  });
});

describe('title screen (titleScreen.ts)', () => {
  const q = (s: string) => new URLSearchParams(s);
  const fresh = { seen: false, automated: false };

  it('shows once per session on a plain launch; deep screens, automation and ?title=0 skip it', () => {
    expect(shouldShowTitle(q(''), fresh)).toBe(true);
    expect(shouldShowTitle(q('?lang=tr'), fresh)).toBe(true);
    expect(shouldShowTitle(q(''), { seen: true, automated: false })).toBe(false);
    expect(shouldShowTitle(q(''), { seen: false, automated: true })).toBe(false);
    for (const k of TITLE_SKIP_PARAMS) expect(shouldShowTitle(q(`?${k}=x`), fresh), k).toBe(false);
    expect(shouldShowTitle(q('?screen=brief&island=1'), fresh)).toBe(false);
    expect(shouldShowTitle(q('?title=0'), fresh)).toBe(false);
    // ?title=1 wins over everything (QA, a language switch made on the title).
    expect(shouldShowTitle(q('?title=1&screen=settings'), { seen: true, automated: true })).toBe(true);
  });

  it('reads the painted key art and logos from the manifest (nested or flat), stand-ins otherwise', () => {
    expect(titleArt(null)).toEqual({ keyart: null, logo: null, logoTr: null });
    expect(titleArt({ paintedUi: { sea: 'ui/sea.webp' } })).toEqual({ keyart: null, logo: null, logoTr: null });
    const nested = titleArt({ paintedUi: { title: { keyart: 'ui/title/keyart.webp', logo: 'ui/title/logo.webp', logoTr: 'ui/title/logo-tr.webp' } } });
    expect(nested).toEqual({ keyart: '/art2d/ui/title/keyart.webp', logo: '/art2d/ui/title/logo.webp', logoTr: '/art2d/ui/title/logo-tr.webp' });
    const flat = titleArt({ paintedUi: { 'title-keyart': 'ui/title-keyart.webp', 'title-logo': 'ui/title-logo.webp' } });
    expect(flat.keyart).toBe('/art2d/ui/title-keyart.webp');
    expect(flat.logoTr).toBeNull();
    expect(titleLogo(flat, 'tr')).toBe('/art2d/ui/title-logo.webp');
    expect(titleLogo(nested, 'tr')).toBe('/art2d/ui/title/logo-tr.webp');
    expect(titleLogo(nested, 'en')).toBe('/art2d/ui/title/logo.webp');
    // Non-string values (a strip / an object) are ignored, not crashed on.
    expect(titleArt({ paintedUi: { title: { keyart: { frames: 3 } } } }).keyart).toBeNull();
  });

  it('loading fraction = finished weight over total weight', () => {
    expect(loadFraction([], [])).toBe(1);
    expect(loadFraction([], [2, 3, 1])).toBe(0);
    expect(loadFraction([3], [2, 3, 1])).toBe(0.5);
    expect(loadFraction([2, 3, 1], [2, 3, 1])).toBe(1);
  });

  it('credits: every section has a heading and lines in both languages; Fredoka keeps its licence line', () => {
    for (const lang of ['en', 'tr'] as const) {
      setLocale(lang);
      const s = creditSections();
      expect(s.length).toBeGreaterThanOrEqual(5);
      for (const sec of s) {
        expect(sec.title.trim()).not.toBe('');
        expect(sec.lines.length).toBeGreaterThan(0);
      }
      expect(s.flatMap((x) => x.lines.map((l) => l.text)).join(' ')).toContain('SIL Open Font License 1.1');
    }
    setLocale('en');
  });

  it('the title is wired in main2d and skips for deep links (game params come first)', () => {
    const main = readFileSync(join(__dirname, '../../src/render2d/main2d.ts'), 'utf8');
    const gate = main.indexOf('if (!GAME_PARAMS.some((k) => q.has(k)))');
    expect(gate).toBeGreaterThan(0);
    expect(main.indexOf('shouldShowTitle', gate)).toBeGreaterThan(gate);
    expect(main).toContain('navigator.webdriver === true');
  });
});
