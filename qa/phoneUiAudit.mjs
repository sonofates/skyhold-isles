// Phone UI audit: measures touch targets (>= 44x44), adjacent target spacing (>= 8px),
// text sizes (>= 14px body/button, >= 12px secondary/caption), button icon sizes (>= 24px),
// and viewport/overflow/clipping/overlap issues across every 2D screen in EN and TR at
// 932x430, 844x390 and 667x375 with a mobile touch context (isMobile, hasTouch, dpr 3, iPhone UA).
//
// Usage:
//   node qa/phoneUiAudit.mjs [filter] [--base=http://127.0.0.1:4381] [--lang=en,tr]
//     [--size=932x430,844x390,667x375] [--shots=docs/phoneui/before] [--shotsize=932x430]
//     [--json=docs/phoneui/before.json] [--report=docs/phoneui/before.txt] [--jobs=3]
//     [--desktop-shots=docs/phoneui/desktop-before]
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditPage } from './uiAuditLib.mjs';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const candidates = [
      '/home/claude/ci/kaginawa-r22/package.json',
      join(process.cwd(), 'package.json'),
    ];
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      try {
        const req = createRequire(p);
        return req('playwright-core');
      } catch {
        // try next
      }
    }
    throw new Error('Could not load playwright or playwright-core');
  }
}

function findChromiumExecutable() {
  const cacheDir = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cacheDir)) return undefined;
  const dirs = readdirSync(cacheDir)
    .filter((d) => d.startsWith('chromium_headless_shell-') || d.startsWith('chromium-'))
    .sort()
    .reverse();
  for (const d of dirs) {
    const p1 = join(cacheDir, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (existsSync(p1)) return p1;
    const p2 = join(cacheDir, d, 'chrome-linux64', 'chrome');
    if (existsSync(p2)) return p2;
  }
  return undefined;
}

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const LANGS = (arg('lang') ?? 'en,tr').split(',').filter(Boolean);
const SHOTS = arg('shots') ?? null;
const SHOT_SIZES = (arg('shotsize') ?? '932x430').split(',').filter(Boolean);
const DESKTOP_SHOTS = arg('desktop-shots') ?? null;
const JSON_OUT = arg('json') ?? null;
const REPORT = arg('report') ?? null;
const JOBS = Number(arg('jobs') ?? 3);
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

const ALL_PHONE_SIZES = [
  { key: '932x430', w: 932, h: 430, dpr: 3, touch: true },
  { key: '844x390', w: 844, h: 390, dpr: 3, touch: true },
  { key: '667x375', w: 667, h: 375, dpr: 3, touch: true },
];
const SIZES = ALL_PHONE_SIZES.filter((s) => !arg('size') || arg('size').split(',').includes(s.key));

const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const N = IDS.length;
const pad = (a, v) => [...a, ...Array(Math.max(0, N - a.length)).fill(v)];
const makeSave = (stars, unlocked, extra = {}) =>
  JSON.stringify({
    ids: IDS,
    progress: {
      version: 2,
      unlockedLevelIndex: unlocked,
      bestStars: pad(stars, 0),
      bestEndlessWaves: pad([0, 23], 0),
      bestLives: pad(stars.map((s) => (s ? 12 + s * 2 : 0)), 0),
      clears: pad(stars.map((s) => (s > 0 ? 1 + s : 0)), 0),
      workshop: { treasury: 1 },
      challengeClears: Array.from({ length: N }, (_, i) => [['bowless'], [], [], ['quietGuns']][i] ?? []),
      daily: { lastDay: -1, streak: 2, bestStreak: 4, total: 5 },
      difficultyWins: { easy: pad([1], 0), normal: pad([3, 3, 2, 2, 0, 2, 3, 2, 3], 0), hard: pad([2, 0, 0, 3], 0) },
      heroes: {
        selectedHero: 'bran',
        roster: { bran: { xp: 3200, skills: [] }, wren: { xp: 600, skills: [] }, mira: { xp: 0, skills: [] } },
      },
      market: {
        crystals: 120,
        inventory: { emberPot: 3, frostLantern: 2, skyPurse: 2, heartstone: 1, cloudguard: 1, galeBell: 1 },
        loadout: ['emberPot', 'frostLantern', 'skyPurse'],
      },
      ...extra,
    },
  });

const SEED = makeSave([3, 3, 2, 3, 1, 2, 3, 2, 3], 9);
const FRESH = makeSave([], 0, {
  challengeClears: Array.from({ length: N }, () => []),
  difficultyWins: { easy: pad([], 0), normal: pad([], 0), hard: pad([], 0) },
  heroes: { selectedHero: 'bran', roster: { bran: { xp: 0, skills: [] } } },
});
const STORY_SEEN = JSON.stringify(IDS.flatMap((id) => [`${id}:intro`, `${id}:outro`]));

// [name, query, seed, action, opts]
const SCREENS = [
  ['title', '?title=1&titlemenu=1', SEED, 'title'],
  ['map', '', SEED, null],
  ['brief', '?screen=brief&island=1', SEED, null],
  ['brief-fresh', '?screen=brief&island=0', FRESH, null],
  ['brief-modes', '?screen=brief&island=0&pick=bowless', SEED, null],
  ['brief-locked', '?screen=brief&island=12', SEED, null],
  ['workshop', '?screen=workshop', SEED, null],
  ['herosel', '?screen=herosel', SEED, null],
  ['heroes', '?screen=heroes', SEED, null],
  ['heroes-node', '?screen=heroes', SEED, 'treeNode'],
  ['logbook', '?screen=logbook', SEED, null],
  ['logbook-feats', '?screen=logbook&tab=feats', SEED, null],
  ['daily', '?screen=daily', SEED, null],
  ['market', '?screen=market', SEED, null],
  ['beltpick', '?screen=brief&island=1', SEED, 'beltpick'],
  ['store', '?screen=store&iapmock=1', SEED, 'store', { nativeIos: true }],
  ['settings-general', '?screen=settings&settab=general', SEED, null],
  ['settings-audio', '?screen=settings&settab=audio', SEED, null],
  ['settings-graphics', '?screen=settings&settab=graphics', SEED, null],
  ['settings-controls', '?screen=settings&settab=controls', SEED, null],
  ['credits', '?screen=credits', SEED, null],
  ['story', '?level=i02&story=intro', SEED, 'story', { storySeen: false }],
  ['story-3beat', '?level=l1c&story=intro', SEED, 'story', { storySeen: false }],
  ['hud', '?level=i02&hero=bran', SEED, 'hud'],
  ['hud-ring', '?level=i02&hero=bran', SEED, 'ring'],
  ['hud-tower', '?level=i02&hero=bran', SEED, 'tower'],
  ['hud-spec-card', '?level=i02&hero=bran', SEED, 'specCard'],
  ['hud-spec-hint', '?level=i02&hero=bran&spechint=1', SEED, 'specHint'],
  ['hud-foe', '?level=i02&hero=bran', SEED, 'foe'],
  ['hud-coach', '?level=l1c&hero=bran', FRESH, 'coach', { coach: true }],
  ['hud-newfoe', '?level=i09&hero=bran', null, 'newfoe', { foesFresh: true }],
  ['hud-codex', '?level=i09&hero=bran', SEED, 'codex'],
  ['hud-codex-spec', '?level=i09&hero=bran', SEED, 'codexSpec'],
  ['hud-pause', '?level=i02&hero=bran', SEED, 'pause'],
  ['hud-confirm', '?level=i02&hero=bran', SEED, 'confirm'],
  ['end-won', '?level=i02&hero=bran', SEED, 'win'],
  ['end-lost', '?level=i02&hero=bran', SEED, 'lose'],
];

/**
 * In-page phone ergonomics audit:
 * - smallTarget: interactive element < 44x44 CSS px
 * - tightGap: two visible adjacent interactive elements < 8px apart
 * - smallIcon: primary icon inside an interactive button < 24px
 * - textUnder12: any visible text node < 12px
 * - bodyUnder14: body/info/button text node < 14px (and >= 12px)
 * - viewportClip: visible element/panel clipped by or outside the viewport
 * Plus all layout/clipping/overlap checks from auditPage().
 */
function phoneAuditInPage(baseProblems) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const violations = [];
  const add = (kind, at, text, detail) =>
    violations.push({
      kind,
      at,
      text: (text ?? '').trim().replace(/\s+/g, ' ').slice(0, 50),
      detail,
    });

  const label = (e) => {
    const c = typeof e.className === 'string' ? e.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
    const id = e.getAttribute?.('data-testid');
    return `${e.tagName.toLowerCase()}${c ? '.' + c : ''}${id ? `[${id}]` : ''}`;
  };

  const isVisible = (e) => {
    for (let n = e; n && n instanceof Element; n = n.parentElement) {
      if (n.hidden) return false;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };

  const isScrolledOut = (rect, e) => {
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const sy = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
      const sx = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
      if (!sx && !sy) continue;
      const ar = a.getBoundingClientRect();
      if (sy && (rect.bottom <= ar.top + 2 || rect.top >= ar.bottom - 2)) return true;
      if (sx && (rect.right <= ar.left + 2 || rect.left >= ar.right - 2)) return true;
    }
    return false;
  };

  const clipToScrollAncestors = (rect, e) => {
    let { left, top, right, bottom } = rect;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const sy = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
      const sx = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
      if (!sx && !sy) continue;
      const ar = a.getBoundingClientRect();
      if (sy) {
        top = Math.max(top, ar.top);
        bottom = Math.min(bottom, ar.bottom);
      }
      if (sx) {
        left = Math.max(left, ar.left);
        right = Math.min(right, ar.right);
      }
    }
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };

  // Active roots: topmost overlay if open, else all .pu roots.
  const overlays = Array.from(document.querySelectorAll('.pu-overlay')).filter((e) => isVisible(e) && !e.classList.contains('closing'));
  const roots = overlays.length
    ? [overlays[overlays.length - 1]]
    : Array.from(document.querySelectorAll('.pu')).filter((r) => isVisible(r) && !r.parentElement?.closest('.pu'));

  // 1. Interactive elements: touch target >= 44x44, spacing >= 8px, icon >= 24px
  const INTERACTIVE_SEL = 'button, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="slider"], a[href]';
  const targets = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll(INTERACTIVE_SEL)) {
      if (!isVisible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (isScrolledOut(r, el)) continue;
      // Map island buttons are scrolled horizontally off-screen when outside viewport
      if (r.right <= 0 || r.left >= W || r.bottom <= 0 || r.top >= H) {
        if (!el.closest('.pu-map-scroll')) {
          add('viewportClip', label(el), el.textContent || el.getAttribute('aria-label'), `offscreen ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`);
        }
        continue;
      }
      const clipped = clipToScrollAncestors(r, el);
      const partly = clipped.width < r.width - 1 || clipped.height < r.height - 1;
      if (!partly) {
        if (r.width < 43.5 || r.height < 43.5) {
          add('smallTarget', label(el), el.textContent || el.getAttribute('aria-label'), `${r.width.toFixed(1)}x${r.height.toFixed(1)}px (< 44x44)`);
        }
        // Check viewport edge clipping for non-scrolling buttons
        if (!el.closest('.pu-map-scroll') && (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)) {
          add('viewportClip', label(el), el.textContent || el.getAttribute('aria-label'), `extends past viewport (${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)} in ${W}x${H})`);
        }
        // Check primary icon size inside buttons (>= 24px)
        const icon = el.querySelector(':scope > .pu-glyph, :scope > img.pu-hero-chip-tree-icon, :scope > .pu-ab-icon, :scope > .pu-item-socket, :scope > .pu-hero-face, :scope > .pu-cx-medal');
        if (icon && isVisible(icon)) {
          const ir = icon.getBoundingClientRect();
          if (Math.max(ir.width, ir.height) < 23.5) {
            add('smallIcon', label(el), el.textContent || el.getAttribute('aria-label'), `icon ${ir.width.toFixed(1)}x${ir.height.toFixed(1)}px (< 24px)`);
          }
        }
      }
      if (clipped.width >= 2 && clipped.height >= 2) {
        targets.push({ el, r: clipped, partly });
      }
    }
  }

  // Adjacent spacing check (>= 8px edge-to-edge)
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // Floating map edge pan buttons sit over the horizontally scrolling island track by design.
      const aPan = a.el.classList.contains('pu-map-pan');
      const bPan = b.el.classList.contains('pu-map-pan');
      if ((aPan && b.el.classList.contains('pu-node')) || (bPan && a.el.classList.contains('pu-node'))) continue;
      const dx = Math.max(0, Math.max(a.r.left - b.r.right, b.r.left - a.r.right));
      const dy = Math.max(0, Math.max(a.r.top - b.r.bottom, b.r.top - a.r.bottom));
      const dist = Math.hypot(dx, dy);
      if (dist < 7.5) {
        add('tightGap', `${label(a.el)} <-> ${label(b.el)}`, `${(a.el.textContent || '').trim().slice(0, 18)} / ${(b.el.textContent || '').trim().slice(0, 18)}`, `gap ${dist.toFixed(1)}px (< 8px)`);
      }
    }
  }

  // 2. Text size check: >= 12px for all text, >= 14px for body/info/button labels
  const SECONDARY_SEL = [
    'small',
    '.pu-round-label',
    '.pu-badge',
    '.pu-market-count',
    '.pu-market-new',
    '.pu-market-owned',
    '.pu-market-slotn',
    '.pu-beltchip-uses',
    '.pu-ab-key',
    '.pu-item-stock',
    '.pu-hero-lvl',
    '.pu-hero-xp-text',
    '.pu-bar span',
    '.pu-feat-new',
    '.pu-foe-tag',
    '.pu-wave-new',
    '.pu-plank-sub',
    '.pu-meta-foot',
    '.pu-cx-kicker',
    '.pu-cx-count',
    '.pu-cx-name',
    '.pu-hnode-name',
    '.pu-story-kicker',
    '.pu-node-ribbon',
    '.pu-coach-n',
    '.pu-beltpick-n',
    '.pu-market-tag',
    '.pu-market-why',
    '.pu-hero-tab-name',
    '.pu-diff-desc',
    '.pu-spec-note',
    '.pu-spec-need',
    '.pu-hero-node-why',
    '.pu-diff-badge',
    '.pu-newfoe-tag',
    '.pu-cx-stat > span',
  ].join(', ');

  for (const root of roots) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const txt = (n.nodeValue ?? '').trim();
      if (!txt) continue;
      const pe = n.parentElement;
      if (!pe || !isVisible(pe)) continue;
      if (pe.closest('svg, style, script')) continue;
      if (pe.closest('[role="tooltip"]')?.hidden) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) continue;
      const cText = clipToScrollAncestors(r, pe);
      if (isScrolledOut(r, pe) || cText.width < r.width - 1 || cText.height < r.height - 1) continue;
      if (r.right <= 0 || r.left >= W || r.bottom <= 0 || r.top >= H) continue;
      const cs = getComputedStyle(pe);
      const fs = parseFloat(cs.fontSize) || 0;
      // Account for CSS transform scaling (e.g. dockCard scale)
      let scaleY = 1;
      for (let a = pe; a && a !== document.body; a = a.parentElement) {
        const t = getComputedStyle(a).transform;
        if (t && t !== 'none' && t.startsWith('matrix(')) {
          const parts = t.slice(7, -1).split(',').map(Number);
          const sy = Math.hypot(parts[2] || 0, parts[3] || 1);
          if (Number.isFinite(sy) && sy > 0.01) scaleY *= sy;
        }
      }
      const effFs = fs * scaleY;
      const isSecondary = !!pe.closest(SECONDARY_SEL);
      if (effFs < 11.75) {
        add('textUnder12', label(pe), txt, `${effFs.toFixed(1)}px${scaleY < 0.99 ? ` (${fs.toFixed(1)}x${scaleY.toFixed(2)})` : ''} (< 12px)`);
      } else if (!isSecondary && effFs < 13.75) {
        add('bodyUnder14', label(pe), txt, `${effFs.toFixed(1)}px${scaleY < 0.99 ? ` (${fs.toFixed(1)}x${scaleY.toFixed(2)})` : ''} (< 14px body)`);
      }
    }
  }

  // 3. Sheet/panel viewport & safe-area clip check, panel fill ratio (< 0.6 when not scrolling),
  //    and button label clipping check.
  const unionArea = (rects) => {
    if (!rects.length) return 0;
    const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
    let area = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      const dx = xs[i + 1] - xs[i];
      if (dx <= 0.1) continue;
      const mx = (xs[i] + xs[i + 1]) / 2;
      const ys = [];
      for (const r of rects) {
        if (r.x0 <= mx && r.x1 >= mx) ys.push([r.y0, r.y1]);
      }
      if (!ys.length) continue;
      ys.sort((a, b) => a[0] - b[0]);
      let cur0 = ys[0][0];
      let cur1 = ys[0][1];
      let span = 0;
      for (let j = 1; j < ys.length; j++) {
        if (ys[j][0] <= cur1) cur1 = Math.max(cur1, ys[j][1]);
        else {
          span += Math.max(0, cur1 - cur0);
          cur0 = ys[j][0];
          cur1 = ys[j][1];
        }
      }
      span += Math.max(0, cur1 - cur0);
      area += dx * span;
    }
    return area;
  };

  // Safe area bounds (when env(safe-area-inset-*) is set in CSS)
  const firstPu = document.querySelector('.pu');
  const puCs = firstPu ? getComputedStyle(firstPu) : null;
  const safeT = parseFloat(puCs?.getPropertyValue('--safe-t') || '0') || 0;
  const safeR = parseFloat(puCs?.getPropertyValue('--safe-r') || '0') || 0;
  const safeB = parseFloat(puCs?.getPropertyValue('--safe-b') || '0') || 0;
  const safeL = parseFloat(puCs?.getPropertyValue('--safe-l') || '0') || 0;
  const safeMinX = safeL;
  const safeMaxX = W - safeR;
  const safeMinY = safeT;
  const safeMaxY = H - safeB;

  const panelMetrics = [];

  for (const root of roots) {
    const sheets = root.matches('.pu-sheet') ? [root] : Array.from(root.querySelectorAll('.pu-sheet'));
    for (const sh of sheets) {
      if (!isVisible(sh)) continue;
      const r = sh.getBoundingClientRect();
      if (r.left < safeMinX - 1 || r.top < safeMinY - 1 || r.right > safeMaxX + 1 || r.bottom > safeMaxY + 1) {
        add('viewportClip', label(sh), '', `sheet ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)} outside safe ${safeMinX},${safeMinY}-${safeMaxX},${safeMaxY}`);
      }
      const closeBtn = sh.querySelector(':scope > .pu-sheet-close');
      if (closeBtn && isVisible(closeBtn)) {
        const cr = closeBtn.getBoundingClientRect();
        if (cr.left < safeMinX - 1 || cr.top < safeMinY - 1 || cr.right > safeMaxX + 1 || cr.bottom > safeMaxY + 1) {
          add('viewportClip', label(closeBtn), 'close', `close btn ${Math.round(cr.left)},${Math.round(cr.top)}-${Math.round(cr.right)},${Math.round(cr.bottom)} outside safe`);
        }
      }

      // Check if sheet scrolls vertically
      const scrollEls = [sh, ...sh.querySelectorAll('*')].filter((el) => {
        if (!isVisible(el)) return false;
        const cs = getComputedStyle(el);
        return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4;
      });
      const scrolling = scrollEls.length > 0;

      // Measure inner parchment area (excluding 9-slice border frame)
      const scs = getComputedStyle(sh);
      const bt = parseFloat(scs.borderTopWidth) || 0;
      const br = parseFloat(scs.borderRightWidth) || 0;
      const bb = parseFloat(scs.borderBottomWidth) || 0;
      const bl = parseFloat(scs.borderLeftWidth) || 0;
      const inner = {
        x0: r.left + bl,
        y0: r.top + bt,
        x1: r.right - br,
        y1: r.bottom - bb,
      };
      const innerW = Math.max(1, inner.x1 - inner.x0);
      const innerH = Math.max(1, inner.y1 - inner.y0);
      const innerArea = innerW * innerH;

      // Collect semantic content blocks (without flex-stretched empty wrappers)
      const BLOCK_SEL = [
        '.pu-set-row',
        '.pu-tabs',
        '.pu-brief-row',
        '.pu-brief-medal',
        '.pu-loadout',
        '.pu-mode',
        '.pu-modes-head',
        '.pu-diff-row',
        '.pu-diff-desc',
        '.pu-brief-play',
        '.pu-daily-island',
        '.pu-chips',
        '.pu-rule',
        '.pu-story-kicker',
        '.pu-panel:not(:only-child)',
        '.pu-vignette',
        '.pu-panel-text',
        '.pu-story-actions > *',
        '.pu-confirm-text',
        '.pu-confirm-row > *',
        '.pu-credits-sec',
        '.pu-credits-thanks',
        '.pu-store-intro',
        '.pu-store-empty',
        '.pu-store-item',
        '.pu-store-foot > *',
        '.pu-beltpick-item',
        '.pu-beltpick-foot > *',
        '.pu-meta-head',
        '.pu-meta-note',
        '.pu-meta-foot',
        '.pu-hero-roster',
        '.pu-hero-art',
        '.pu-hero-info > *',
        '.pu-hero-actions > *',
        '.pu-market-stall',
        '.pu-market-belt',
        '.pu-market-item',
        '.pu-spec-kicker',
        '.pu-spec-col',
        '.pu-spec-note',
        '.pu-ws-col',
        '.pu-lb-totals',
        '.pu-ledger-row',
        '.pu-feat',
        '.pu-cx-tabs',
        '.pu-cx-grid',
        '.pu-cx-detail',
        '.pu-hero-tree-top',
        '.pu-hero-tree-main',
      ].join(', ');

      const blockRects = [];
      const matched = Array.from(sh.querySelectorAll(BLOCK_SEL)).filter((el) => {
        if (!isVisible(el)) return false;
        if (el.closest('.pu-sheet-title, .pu-sheet-close')) return false;
        return true;
      });
      for (const el of matched) {
        const er = el.getBoundingClientRect();
        if (er.width < 2 || er.height < 2) continue;
        // Pad each block slightly (+6px) to account for normal inter-item gaps/margins
        const x0 = Math.max(inner.x0, er.left - 6);
        const y0 = Math.max(inner.y0, er.top - 6);
        const x1 = Math.min(inner.x1, er.right + 6);
        const y1 = Math.min(inner.y1, er.bottom + 6);
        if (x1 > x0 && y1 > y0) blockRects.push({ x0, y0, x1, y1 });
      }
      // Also include any visible direct buttons inside sheet body not already covered
      for (const el of sh.querySelectorAll('button, [role="button"]')) {
        if (!isVisible(el) || el.classList.contains('pu-sheet-close')) continue;
        const er = el.getBoundingClientRect();
        if (er.width < 2 || er.height < 2) continue;
        const x0 = Math.max(inner.x0, er.left - 6);
        const y0 = Math.max(inner.y0, er.top - 6);
        const x1 = Math.min(inner.x1, er.right + 6);
        const y1 = Math.min(inner.y1, er.bottom + 6);
        if (x1 > x0 && y1 > y0) blockRects.push({ x0, y0, x1, y1 });
      }

      const contentArea = unionArea(blockRects);
      const fillRatio = contentArea / innerArea;
      panelMetrics.push({
        at: label(sh),
        w: Math.round(r.width),
        h: Math.round(r.height),
        scrolling,
        fillRatio: Number(fillRatio.toFixed(3)),
      });
      if (!scrolling && fillRatio < 0.6) {
        add(
          'lowFill',
          label(sh),
          '',
          `fill ${(fillRatio * 100).toFixed(1)}% (< 60%, non-scrolling; sheet ${Math.round(r.width)}x${Math.round(r.height)} in ${W}x${H})`,
        );
      }
    }
  }

  // 3b. Button label clipping check: catches any button whose label is clipped by the viewport,
  //     by its own box, or by an ancestor container (including action/footer buttons pushed past a
  //     scroll box edge, like the story panel's Skip / Next buttons).
  const ACTION_BTN_SEL = [
    '.pu-story-actions button',
    '.pu-brief-actions button',
    '.pu-hero-actions button',
    '.pu-confirm-row button',
    '.pu-store-foot button',
    '.pu-beltpick-foot button',
    '.pu-pause-menu button',
    '.pu-plank.primary',
    '.pu-sheet-close',
  ].join(', ');
  const FLOATING_LABEL_SEL = '.pu-round-label, .pu-badge, .pu-hero-lvl, .pu-market-count, .pu-market-new, .pu-beltchip-uses, .pu-market-owned, .pu-market-slotn';
  const LIST_SCROLLER_SEL =
    '.pu-ws-cols, .pu-ledger, .pu-cx-grid, .pu-market-grid, .pu-market .pu-sheet-body, .pu-hero-tree .pu-sheet-body, .pu-hero-sel-grid, .pu-brief-body, .pu-beltpick-grid, .pu-settings .pu-sheet-body, .pu-map-scroll';
  for (const root of roots) {
    for (const btn of root.querySelectorAll('button, [role="button"], [role="tab"], [role="radio"]')) {
      if (!isVisible(btn)) continue;
      if (btn.closest('.pu-map-scroll')) continue;
      const br = btn.getBoundingClientRect();
      if (br.width < 2 || br.height < 2) continue;
      const isAction = btn.matches(ACTION_BTN_SEL);
      const inListScroller = !!btn.closest(LIST_SCROLLER_SEL);
      const clippedBtn = clipToScrollAncestors(br, btn);
      const partlyScrolled = clippedBtn.width < br.width - 1 || clippedBtn.height < br.height - 1;
      const scrolledOut = isScrolledOut(br, btn);
      if ((scrolledOut || partlyScrolled) && !isAction && inListScroller) continue;
      const btnText = (btn.textContent || '').trim();
      if (!btnText) continue;

      // Check every visible text node inside the button
      const tw = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
      let labelClipped = null;
      for (let tn = tw.nextNode(); tn; tn = tw.nextNode()) {
        if (!(tn.nodeValue || '').trim()) continue;
        const pe = tn.parentElement;
        if (!pe || !isVisible(pe)) continue;
        const rng = document.createRange();
        rng.selectNodeContents(tn);
        const tr = rng.getBoundingClientRect();
        if (tr.width < 0.5 || tr.height < 0.5) continue;
        const isFloating = !!pe.closest(FLOATING_LABEL_SEL);
        // Clipped by viewport / safe area
        if (tr.left < safeMinX - 1 || tr.top < safeMinY - 1 || tr.right > safeMaxX + 1 || tr.bottom > safeMaxY + 1) {
          labelClipped = `label outside viewport (${Math.round(tr.left)},${Math.round(tr.top)}-${Math.round(tr.right)},${Math.round(tr.bottom)})`;
          break;
        }
        // Clipped by button's own box (skip intentional floating captions/badges outside round/portrait buttons)
        if (!isFloating && (tr.left < br.left - 1.5 || tr.right > br.right + 1.5 || tr.top < br.top - 2 || tr.bottom > br.bottom + 2)) {
          labelClipped = `label spills out of button (${Math.round(tr.width)}x${Math.round(tr.height)} vs ${Math.round(br.width)}x${Math.round(br.height)})`;
          break;
        }
        // Clipped by any clipping/scrolling ancestor
        for (let a = btn.parentElement; a && a !== document.body; a = a.parentElement) {
          const acs = getComputedStyle(a);
          const cy = acs.overflowY === 'hidden' || acs.overflowY === 'clip' || acs.overflowY === 'auto' || acs.overflowY === 'scroll';
          const cx = acs.overflowX === 'hidden' || acs.overflowX === 'clip' || acs.overflowX === 'auto' || acs.overflowX === 'scroll';
          if (!cx && !cy) continue;
          // Skip list-scroll rows that are intentionally scrolled partly at the edge of a scrolling list
          if (!isAction && inListScroller && (acs.overflowY === 'auto' || acs.overflowY === 'scroll')) continue;
          const ar = a.getBoundingClientRect();
          const ax0 = ar.left + a.clientLeft;
          const ay0 = ar.top + a.clientTop;
          const ax1 = ax0 + a.clientWidth;
          const ay1 = ay0 + a.clientHeight;
          if ((cx && (tr.left < ax0 - 1 || tr.right > ax1 + 1)) || (cy && (tr.top < ay0 - 1 || tr.bottom > ay1 + 1))) {
            labelClipped = `label clipped by ${label(a)} (text y=${Math.round(tr.top)}..${Math.round(tr.bottom)} vs box y=${Math.round(ay0)}..${Math.round(ay1)})`;
            break;
          }
        }
        if (labelClipped) break;
      }
      if (!labelClipped && (btn.scrollWidth > btn.clientWidth + 2 || btn.scrollHeight > btn.clientHeight + 2)) {
        const bcs = getComputedStyle(btn);
        if (bcs.overflowX === 'hidden' || bcs.overflowX === 'clip' || bcs.overflowY === 'hidden' || bcs.overflowY === 'clip') {
          labelClipped = `button content overflow (${btn.scrollWidth}x${btn.scrollHeight} > ${btn.clientWidth}x${btn.clientHeight})`;
        }
      }
      if (labelClipped) {
        add('buttonLabelClip', label(btn), btnText, labelClipped);
      }
    }
  }

  // 4. Include layout/clip/overlap problems from uiAuditLib
  for (const p of baseProblems) {
    if (['clipped', 'overflow', 'offscreen', 'cut', 'overlap', 'covered'].includes(p.kind)) {
      add(`layout:${p.kind}`, p.at, p.text, p.detail);
    }
  }

  return { violations, targetCount: targets.length, panelMetrics };
}

async function act(page, action, key, size) {
  const p0 = () => page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'), null, { timeout: 60000 });
  switch (action) {
    case 'treeNode': {
      const n = page.locator('[data-testid^="tree2d-node-"]').nth(1);
      await n.click({ timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(350);
      break;
    }
    case 'beltpick': {
      const slot = page.locator('[data-testid="brief2d-belt-slot-0"]').first();
      await slot.click({ timeout: 15000 }).catch(() => undefined);
      await page.waitForSelector('.pu-beltpick', { timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      break;
    }
    case 'title':
      await page.waitForFunction(() => window.__title?.state().phase === 'menu', null, { timeout: 30000 }).catch(() => undefined);
      await page.waitForTimeout(900);
      break;
    case 'story':
      await page.waitForSelector('.pu-story', { timeout: 30000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      break;
    case 'hud':
    case 'coach':
      await p0();
      await page.waitForTimeout(action === 'coach' ? 2200 : 1200);
      break;
    case 'foe': {
      await p0();
      await page.evaluate(() => {
        window.__p0.replay.cmd({ k: 'wave' });
        window.__p0.replay.step(90);
      });
      await page.evaluate(() => window.__p0.freeze(true));
      const at = await page.evaluate(() => window.__p0.foeAt());
      if (at) {
        await page.evaluate(([x, y]) => window.__p0.hero.tap(x, y), [at.x, at.y]);
        await page.evaluate(() => window.__p0.freeze(false));
        await page.waitForFunction(() => window.__p0.foe().shown, null, { timeout: 6000 }).catch(() => undefined);
        await page.waitForTimeout(350);
        await page.evaluate(() => window.__p0.freeze(true));
      }
      break;
    }
    case 'ring':
    case 'tower': {
      await p0();
      await page.evaluate((t) => {
        window.__p0.setGold(2000);
        if (t) window.__p0.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
      }, action === 'tower');
      await page.waitForTimeout(350);
      const pl = await page.evaluate(() => window.__p0.plotScreen(2));
      if (size.touch) await page.touchscreen.tap(pl.x, pl.y - (action === 'tower' ? 30 : 0));
      else await page.mouse.click(pl.x, pl.y - (action === 'tower' ? 30 : 0));
      await page.waitForFunction(() => window.__p0.state().ring?.open, null, { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      break;
    }
    case 'specCard':
    case 'specHint': {
      await p0();
      await page.evaluate(() => {
        const p = window.__p0;
        p.setGold(5000);
        p.replay.cmd({ k: 'build', plot: 2, type: 'archer' });
        const id = p.spec().towers[0].id;
        p.replay.cmd({ k: 'upgrade', id });
        p.replay.cmd({ k: 'upgrade', id });
      });
      await page.waitForTimeout(600);
      if (action === 'specHint') {
        await page.waitForFunction(() => window.__p0.spec().hint?.shown, null, { timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(450);
        break;
      }
      const pl = await page.evaluate(() => window.__p0.plotScreen(2));
      const tap = async (x, y) => (size.touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
      await tap(pl.x, pl.y - 12);
      const opened = await page.waitForFunction(() => window.__p0.state().ring?.open, null, { timeout: 3000 }).then(() => true).catch(() => false);
      if (!opened) {
        const top = await page.evaluate(() => window.__p0.towerTop(window.__p0.spec().towers[0].id));
        await tap(top.x, top.y + 20);
        await page.waitForFunction(() => window.__p0.state().ring?.open, null, { timeout: 5000 }).catch(() => undefined);
      }
      await page.waitForTimeout(500);
      const tk = await page.evaluate(() => window.__p0.state().ring.tokens?.[0]);
      if (tk) {
        await tap(tk.x, tk.y);
        await page.waitForTimeout(400);
        const cmp = await page.evaluate(() => window.__p0.state().ring.compare);
        if (cmp) await tap(cmp.x, cmp.y);
      }
      await page.waitForSelector('[data-testid="spec-card"]', { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      break;
    }
    case 'codex':
      await p0();
      await page.waitForTimeout(450);
      await page.click('[data-testid="codex2d-open"]', { timeout: 15000 }).catch(() => undefined);
      await page.waitForSelector('.pu-overlay', { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      break;
    case 'codexSpec':
      await p0();
      await page.waitForTimeout(450);
      await page.click('[data-testid="codex2d-open"]', { timeout: 15000 }).catch(() => undefined);
      await page.click('[data-testid="codex-tab-towers"]', { timeout: 15000 }).catch(() => undefined);
      await page.click('[data-testid="codex-tile-tesla"]', { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      break;
    case 'store':
      await page.waitForSelector('[data-testid="store2d-buy-full_unlock"], [data-testid="store2d"]', { timeout: 15000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      break;
    case 'pause':
      await p0();
      await page.waitForTimeout(450);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(450);
      break;
    case 'confirm':
      await p0();
      await page.waitForTimeout(450);
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="pause2d-restart"]', { timeout: 10000 }).catch(() => undefined);
      await page.click('[data-testid="pause2d-restart"]', { timeout: 10000 }).catch(() => undefined);
      await page.waitForSelector('.pu-confirm', { timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      break;
    case 'newfoe':
      await p0();
      await page.waitForTimeout(600);
      await page.evaluate(() => window.__p0.replay.cmd({ k: 'wave' }));
      await page.waitForFunction(() => window.__p0.newFoe().shown, null, { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      await page.evaluate(() => window.__p0.freeze(true));
      break;
    case 'win':
    case 'lose':
      await p0();
      await page.evaluate((o) => window.__p0.forceEnd(o), action === 'win' ? 'won' : 'lost');
      await page.waitForFunction(() => !!window.__p0.state().end, null, { timeout: 10000 }).catch(() => undefined);
      await page.locator('[data-testid="story2d-skip"]').click({ timeout: 2500 }).catch(() => undefined);
      await page.waitForTimeout(2400);
      break;
    default:
      await page.waitForTimeout(900);
  }
}

async function seedContext(ctx, seed, lang, opt = {}) {
  await ctx.addInitScript(
    ([s, seen, l, o]) => {
      try {
        if (o.nativeIos) {
          window.CapacitorCustomPlatform = { name: 'ios' };
        }
        if (sessionStorage.getItem('qa-seeded')) return;
        sessionStorage.setItem('qa-seeded', '1');
        localStorage.clear();
        localStorage.setItem('skyhold_isles_language_v1', l);
        localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: l }));
        if (s) localStorage.setItem('skyhold_isles_progress2d_v1', s);
        if (o.storySeen !== false) localStorage.setItem('skyhold_isles_story2d_seen_v1', seen);
        if (!o.coach) {
          localStorage.setItem('skyhold_isles_coach2d_v1', '1');
          localStorage.setItem('skyhold2d_coach_v1', 'done');
        }
        if (!o.foesFresh) {
          localStorage.setItem(
            'skyhold2d_foes_seen_v1',
            JSON.stringify([
              'raider', 'runner', 'brute', 'kite', 'mite', 'healer', 'splitter',
              'golem', 'hexer', 'warden', 'tempest', 'blinker', 'carrier', 'burrower',
              'boss', 'draftwing', 'kilnback', 'reedpiper', 'bellrunner',
            ]),
          );
        }
      } catch {
        // ignore
      }
    },
    [seed, STORY_SEEN, lang, opt],
  );
}

const pw = await loadPlaywright();
const executablePath = findChromiumExecutable();
const browser = await pw.chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: LAUNCH_ARGS,
});

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (DESKTOP_SHOTS) mkdirSync(DESKTOP_SHOTS, { recursive: true });

// Desktop regression screenshots mode
if (DESKTOP_SHOTS) {
  const desktopSizes = [
    { key: '2000x991', w: 2000, h: 991, dpr: 1, touch: false },
    { key: '1440x900', w: 1440, h: 900, dpr: 1, touch: false },
  ];
  const desktopScreens = [
    ['brief', '?screen=brief&island=1', SEED, null],
    ['workshop', '?screen=workshop', SEED, null],
    ['end-won', '?level=i02&hero=bran', SEED, 'win'],
  ];
  for (const size of desktopSizes) {
    for (const [name, query, seed, action] of desktopScreens) {
      const ctx = await browser.newContext({
        viewport: { width: size.w, height: size.h },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        locale: 'en-US',
      });
      await seedContext(ctx, seed, 'en', {});
      const page = await ctx.newPage();
      const q = query ? `${query}&lang=en&desktop=1` : '?lang=en&desktop=1';
      await page.goto(`${BASE}/2d.html${q}`);
      await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 60000 });
      await act(page, action, `desktop-${name}`, size);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${DESKTOP_SHOTS}/${size.key}-${name}.png`, type: 'png' });
      await ctx.close();
      console.log('desktop-shot', size.key, name);
    }
  }
}

const results = [];
const jobs = [];
for (const lang of LANGS) {
  for (const size of SIZES) {
    for (const s of SCREENS) {
      const key = `${s[0]}-${size.key}-${lang}`;
      if (only.length && !only.some((o) => key.includes(o))) continue;
      jobs.push([lang, size, s]);
    }
  }
}

async function runOne(lang, size, [name, query, seed, action, opt = {}]) {
  const key = `${name}-${size.key}-${lang}`;
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    locale: lang === 'tr' ? 'tr-TR' : 'en-US',
  });
  await seedContext(ctx, seed, lang, opt);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const q = query ? `${query}&lang=${lang}&desktop=0` : `?lang=${lang}&desktop=0`;
  try {
    await page.goto(`${BASE}/2d.html${q}`);
    await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 60000 });
    await act(page, action, key, size);
    await page.evaluate(() =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((an) => an.effect?.getComputedTiming().iterations !== Infinity)
            .map((an) => an.finished.catch(() => undefined)),
        ),
        new Promise((res) => setTimeout(res, 2500)),
      ]),
    );
    const base = await page.evaluate(auditPage, {});
    const phone = await page.evaluate(phoneAuditInPage, base.problems);
    const canvas = await page.evaluate(() => (window.__p0?.textAudit ? window.__p0.textAudit() : [])).catch(() => []);
    for (const c of canvas) {
      phone.violations.push({ kind: `canvas:${c.kind ?? 'text'}`, at: c.name, text: c.text ?? '', detail: c.detail ?? '' });
    }
    for (const pe of pageErrors) {
      phone.violations.push({ kind: 'pageerror', at: 'page', text: '', detail: pe });
    }
    results.push({ key, name, size: size.key, lang, count: phone.violations.length, violations: phone.violations, panelMetrics: phone.panelMetrics });
    if (SHOTS && SHOT_SIZES.includes(size.key)) {
      await page.screenshot({ path: `${SHOTS}/${lang}-${size.key}-${name}.jpg`, type: 'jpeg', quality: 75, scale: 'css', animations: 'disabled', timeout: 60000 });
    }
  } catch (e) {
    results.push({
      key,
      name,
      size: size.key,
      lang,
      count: 1,
      violations: [{ kind: 'error', at: 'runner', text: '', detail: String(e).slice(0, 200) }],
    });
  }
  await ctx.close();
  process.stdout.write(`done ${key} (${results[results.length - 1].count})\n`);
}

let next = 0;
await Promise.all(
  Array.from({ length: Math.max(1, JOBS) }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      await runOne(...j);
    }
  }),
);
await browser.close();

// Summarize by screen and by kind
const byKind = {};
const byScreen = {};
let total = 0;
for (const r of results) {
  total += r.count;
  byScreen[r.name] = byScreen[r.name] ?? { total: 0, byKind: {} };
  byScreen[r.name].total += r.count;
  for (const v of r.violations) {
    byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
    byScreen[r.name].byKind[v.kind] = (byScreen[r.name].byKind[v.kind] ?? 0) + 1;
  }
}

const lines = [
  `Phone UI Audit: ${results.length} runs (${LANGS.join('+')} x ${SIZES.map((s) => s.key).join(', ')})`,
  `Total violations: ${total} ${JSON.stringify(byKind)}`,
  '',
  'Per-screen totals:',
  ...Object.entries(byScreen)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, info]) => `  ${name.padEnd(20)} ${String(info.total).padStart(4)}  ${JSON.stringify(info.byKind)}`),
  '',
  'Panel fill metrics (932x430 tr):',
  ...results
    .filter((r) => r.size === '932x430' && r.lang === 'tr' && r.panelMetrics?.length)
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((r) =>
      r.panelMetrics.map(
        (m) => `  ${r.name.padEnd(20)} ${String(m.w).padStart(4)}x${String(m.h).padEnd(4)} fill=${(m.fillRatio * 100).toFixed(1).padStart(5)}% ${m.scrolling ? '(scroll)' : '(static)'} ${m.at}`,
      ),
    ),
  '',
  'Details:',
  ...results
    .sort((a, b) => a.key.localeCompare(b.key))
    .flatMap((r) =>
      r.violations.map((v) => `  ${r.key}: [${v.kind}] ${v.at} "${v.text}" — ${v.detail}`),
    ),
];

const reportText = lines.join('\n');
if (REPORT) {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, reportText);
}
if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify({ total, byKind, byScreen, results }, null, 2));
}
console.log(lines.slice(0, 80).join('\n'));
process.exit(total > 0 ? 1 : 0);
