import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickTreeFit, TREE_FIT_STEPS, type TreeLayout } from '../../src/render2d/ui/heroScreens.ts';
import { letterArc, loadFraction, shouldShowTitle, titleArt, titleLogo, TITLE_SKIP_PARAMS } from '../../src/render2d/ui/titleScreen.ts';
import { creditSections } from '../../src/render2d/ui/credits2d.ts';
import { setLocale, t } from '../../src/i18n/index.ts';
import { keyDir, pickInDirection, repeatDue, stickDir, type NavRect } from '../../src/render2d/ui/navFocus.ts';
import { nearestPoint, padKey } from '../../src/render2d/ui/padCursor.ts';
import { ARMORED_MIN, foeMarkNames } from '../../src/render2d/ui/foeMarks.ts';
import { clampUiScale, defaultGraphics, parseGraphics } from '../../src/render2d/ui/graphicsSettings.ts';
import { setUserUiScale, uiScale, WAVE_EASE_SEC, WAVE_EASE_ZOOM, waveEaseZoom } from '../../src/render2d/uiLayout.ts';
import { uiUnit } from '../../src/render2d/hudDock.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { primaryEndAction } from '../../src/render2d/endPanel.ts';
import { LOAD_TIPS, pickLoadTip } from '../../src/render2d/ui/transition2d.ts';

describe('skill tree fit (heroScreens.ts)', () => {
  it('tries the vertical tree first, largest zoom first, then the across tree largest first', () => {
    const downs = TREE_FIT_STEPS.filter((s) => s[0] === 'down').map((s) => s[1]);
    const across = TREE_FIT_STEPS.filter((s) => s[0] === 'across').map((s) => s[1]);
    expect(TREE_FIT_STEPS[0]).toEqual(['down', 1]);
    expect(TREE_FIT_STEPS.findIndex((s) => s[0] === 'across')).toBe(downs.length);
    expect([...downs].sort((a, b) => b - a)).toEqual(downs);
    expect([...across].sort((a, b) => b - a)).toEqual(across);
    // Never shrinks the vertical tree a lot (it switches layout instead); the across one goes to
    // ~0.6 only for big interface sizes on phones (node text keeps 90 % anyway).
    expect(Math.min(...downs)).toBeGreaterThanOrEqual(0.8);
    expect(Math.min(...across)).toBeGreaterThanOrEqual(0.5);
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

  it('letters ride a symmetric arc: middle highest, ends dipped and leaning outwards', () => {
    expect(letterArc(0, 1)).toEqual({ lift: 0, tilt: 0 });
    const n = 15;
    const arc = Array.from({ length: n }, (_, i) => letterArc(i, n));
    expect(arc[7]).toEqual({ lift: 0, tilt: 0 });
    expect(arc[0]).toEqual({ lift: 1, tilt: -1 });
    expect(arc[14]).toEqual({ lift: 1, tilt: 1 });
    for (let i = 0; i < n; i++) {
      expect(arc[i].lift).toBeCloseTo(arc[n - 1 - i].lift, 6);
      expect(arc[i].tilt).toBeCloseTo(-arc[n - 1 - i].tilt, 6);
    }
  });

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

describe('menu navigation (navFocus.ts)', () => {
  const r = (x: number, y: number, w = 100, h = 40): NavRect => ({ x, y, w, h });

  it('picks the nearest control that way; straight ahead beats a closer one off to the side', () => {
    const from = r(0, 0);
    // A row of planks to the right, one a little lower but much closer.
    const cands = [r(400, 0), r(150, 120), r(200, 0)];
    expect(pickInDirection(from, 'right', cands)).toBe(2);
    expect(pickInDirection(from, 'down', cands)).toBe(1);
    expect(pickInDirection(from, 'left', cands)).toBe(-1);
    expect(pickInDirection(from, 'up', cands)).toBe(-1);
    // Overlapping spans count as straight ahead (no side penalty).
    expect(pickInDirection(r(0, 0, 100, 40), 'down', [r(60, 80, 300, 40), r(-200, 70, 100, 40)])).toBe(0);
  });

  it('a same-row neighbour a few px higher is not "up"; boxes beyond the edge win (phone briefing)', () => {
    // Phone briefing: Play beside the difficulty row (3 px higher), the hero chip and the modes above.
    const play = r(598, 293, 173, 53);
    const diffHard = r(414, 290, 175, 48);
    const endless = r(446, 218, 316, 44);
    expect(pickInDirection(play, 'up', [diffHard, endless])).toBe(1);
    // From the right column, ← reaches the hero chip's buttons, not the difficulty row below them.
    expect(pickInDirection(endless, 'left', [diffHard, r(283, 243, 108, 44)])).toBe(1);
    // Nothing strictly beyond the edge: fall back to centres (still finds a partly overlapping box).
    expect(pickInDirection(r(0, 0, 100, 100), 'right', [r(40, 0, 100, 100)])).toBe(0);
  });

  it('keys and the stick map to directions (WASD only where letters are allowed)', () => {
    expect(keyDir('ArrowUp', false)).toBe('up');
    expect(keyDir('ArrowRight', true)).toBe('right');
    expect(keyDir('w', false)).toBeNull();
    expect(keyDir('W', true)).toBe('up');
    expect(keyDir('a', true)).toBe('left');
    expect(keyDir('Enter', true)).toBeNull();
    expect(stickDir(0.2, -0.3)).toBeNull();
    expect(stickDir(0.9, 0.2)).toBe('right');
    expect(stickDir(-0.2, -0.8)).toBe('up');
    expect(stickDir(-0.7, 0.6)).toBe('left');
  });

  it('a held direction moves at once, again after 380 ms, then every 110 ms', () => {
    expect(repeatDue(0, 0, 0)).toBe(true);
    expect(repeatDue(200, 0, 1)).toBe(false);
    expect(repeatDue(380, 0, 1)).toBe(true);
    expect(repeatDue(450, 380, 2)).toBe(false);
    expect(repeatDue(490, 380, 2)).toBe(true);
  });
});

describe('pad cursor (padCursor.ts)', () => {
  it('nearest target and the pad buttons the run understands', () => {
    expect(nearestPoint({ x: 0, y: 0 }, [])).toBe(-1);
    expect(nearestPoint({ x: 10, y: 10 }, [{ x: 100, y: 0 }, { x: 12, y: 14 }, { x: -50, y: 9 }])).toBe(1);
    expect(padKey('x')).toBe('n');
    expect(padKey('y')).toBe('H');
    expect(padKey('lb')).toBe('Q');
    expect(padKey('rb')).toBe('W');
    expect(padKey('lt')).toBe('E');
    expect(padKey('rt')).toBe('R');
    expect(padKey('start')).toBe(' ');
    expect(padKey('a')).toBeNull();
  });
});

describe('accessibility', () => {
  it('foe kinds carry shapes, not only colours: crown / wing / shield', () => {
    expect(foeMarkNames({ flying: false, armored: false, boss: false })).toEqual([]);
    expect(foeMarkNames({ flying: true, armored: false, boss: false })).toEqual(['wing']);
    expect(foeMarkNames({ flying: false, armored: true, boss: true })).toEqual(['crown', 'shield']);
    // Heavy armour = the brute and up; light skirmishers stay unmarked.
    const armored = Object.values(ENEMY_DEFS).filter((d) => d.armor >= ARMORED_MIN).map((d) => d.type).sort();
    expect(armored).toContain('brute');
    expect(armored).toContain('golem');
    expect(armored).not.toContain('grunt');
    expect(armored).not.toContain('runner');
  });

  it('interface size is stored 90–130 % in 5 % steps; old saves load at 100 %', () => {
    expect(defaultGraphics(false).uiScale).toBe(1);
    expect(parseGraphics({}).uiScale).toBe(1);
    expect(parseGraphics({ uiScale: 2 }).uiScale).toBe(1.3);
    expect(parseGraphics({ uiScale: 0.5 }).uiScale).toBe(0.9);
    expect(parseGraphics({ uiScale: 1.12 }).uiScale).toBe(1.1);
    expect(clampUiScale('big')).toBe(1);
  });

  it('the HUD unit and scale follow the interface size', () => {
    const u = uiUnit(1920, 1080);
    const k = uiScale(1920, 1080);
    setUserUiScale(1.3);
    expect(uiUnit(1920, 1080)).toBeCloseTo(u * 1.3, 6);
    expect(uiScale(1920, 1080)).toBeCloseTo(k * 1.3, 6);
    // Phones never go under the touch floor (8.5 px unit, 0.5 layout scale).
    setUserUiScale(0.9);
    expect(uiUnit(844, 390)).toBe(8.5);
    expect(uiScale(844, 390)).toBe(0.5);
    setUserUiScale(1);
    expect(uiUnit(1920, 1080)).toBe(u);
  });
});

describe('juice', () => {
  it('wave-start camera ease: a soft bump that starts and ends at 1', () => {
    expect(waveEaseZoom(-1)).toBe(1);
    expect(waveEaseZoom(0)).toBe(1);
    expect(waveEaseZoom(WAVE_EASE_SEC)).toBe(1);
    expect(waveEaseZoom(WAVE_EASE_SEC / 2)).toBeCloseTo(1 + WAVE_EASE_ZOOM, 6);
    expect(waveEaseZoom(0.05)).toBeLessThan(1.001);
    expect(WAVE_EASE_ZOOM).toBeLessThanOrEqual(0.02);
  });

  it('2d.html boot screen and the page veil share one look; boot fades instead of vanishing', () => {
    const html = readFileSync(join(__dirname, '../../2d.html'), 'utf8');
    expect(html).toContain('<div id="boot" class="boot-look">');
    expect(html).toMatch(/#boot,\s*\.boot-look \{/);
    const main = readFileSync(join(__dirname, '../../src/render2d/main2d.ts'), 'utf8');
    expect(main).not.toContain("getElementById('boot')?.remove()");
    expect(main).toContain('dismissBoot()');
  });
});

describe('end board', () => {
  it('the glowing medallion is Next isle after a win, Retry after a defeat', () => {
    expect(primaryEndAction(true)).toBe('next');
    expect(primaryEndAction(false)).toBe('retry');
  });
});

describe('battle loading tips', () => {
  it('picks every tip across 0..1 and never runs off the list', () => {
    expect(pickLoadTip(0)).toBe(LOAD_TIPS[0]);
    expect(pickLoadTip(0.9999)).toBe(LOAD_TIPS[LOAD_TIPS.length - 1]);
    expect(pickLoadTip(1)).toBe(LOAD_TIPS[LOAD_TIPS.length - 1]);
    expect(new Set(Array.from({ length: 200 }, (_, i) => pickLoadTip(i / 200))).size).toBe(LOAD_TIPS.length);
  });

  it('every tip reads as a sentence in both languages', () => {
    for (const lang of ['en', 'tr'] as const) {
      setLocale(lang);
      for (const k of LOAD_TIPS) expect(t(k)).toMatch(/^[A-ZÇĞİÖŞÜ].{20,}\.$/u);
    }
    setLocale('en');
  });
});
