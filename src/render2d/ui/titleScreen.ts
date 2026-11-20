/**
 * Title screen of 2d.html (a plain launch, no deep link):
 * - key art: the manifest's `paintedUi.title.keyart` when present (slow drift + pointer parallax);
 *   until then a stand-in composed from the game's own paintings (the sea, the keep isle, two more
 *   isles far off, a ship, clouds), each layer at its own depth;
 * - the logo: `paintedUi.title.logo` / `logoTr` when present, else the name lettered on the banner;
 * - a painted loading bar while the world map's code and art load (they are fetched here, so the
 *   map opens at once afterwards), then "Tap to start" → Continue / New game (with a confirm when
 *   there is progress to lose) / Settings / Credits.
 * Shown once per browser session (back from an island goes straight to the map); deep links
 * (`?level=`, `?screen=`…) and automated browsers skip it; `?title=1` forces it, `?title=0` hides it.
 * Reduced motion: no drift, bob or parallax; the fades stay short.
 */
import type { LevelDef } from '../../data/levels/types.ts';
import { LEVELS_2D } from '../../data/levels2d/index.ts';
import { getLocale, t } from '../../i18n/index.ts';
import { hasAnyProgress, isTouchDevice } from '../../platform/storage.ts';
import { el, img, plank } from './dom.ts';
import { fetchMapsManifest } from './islandArt.ts';
import { loadProgress2D, resetProgress2D } from './progress2d.ts';
import './titleScreen.css';

export const TITLE_SEEN_KEY = 'skyhold2d_title_seen_v1';
/** Map QA params that open a screen directly: no title in front of them. */
export const TITLE_SKIP_PARAMS = ['screen', 'store', 'mockislands'] as const;

export interface TitleArt {
  readonly keyart: string | null;
  readonly logo: string | null;
  readonly logoTr: string | null;
}

const ART = '/art2d/';

function artPath(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  return v.startsWith('/') ? v : `${ART}${v}`;
}

/**
 * Title paintings from the manifest: `paintedUi.title = { keyart, logo, logoTr }` (or flat
 * `title-keyart` / `title-logo` / `title-logoTr` keys). Missing → null (the stand-in is used).
 */
export function titleArt(manifest: unknown): TitleArt {
  const pu = manifest && typeof manifest === 'object' ? (manifest as { paintedUi?: unknown }).paintedUi : undefined;
  const rec = pu && typeof pu === 'object' ? (pu as Record<string, unknown>) : {};
  const nested = rec.title && typeof rec.title === 'object' ? (rec.title as Record<string, unknown>) : {};
  const pick = (...vals: unknown[]): string | null => {
    for (const v of vals) {
      const p = artPath(v);
      if (p) return p;
    }
    return null;
  };
  return {
    keyart: pick(nested.keyart, nested.keyArt, rec['title-keyart']),
    logo: pick(nested.logo, rec['title-logo']),
    logoTr: pick(nested.logoTr, nested['logo-tr'], rec['title-logoTr'], rec['title-logo-tr']),
  };
}

/** The logo for a language: the Turkish one in TR when painted, else the main one. */
export function titleLogo(art: TitleArt, locale: string): string | null {
  return locale === 'tr' ? (art.logoTr ?? art.logo) : art.logo;
}

/** Should 2d.html (with no game params) open on the title screen? */
export function shouldShowTitle(q: URLSearchParams, o: { readonly seen: boolean; readonly automated: boolean }): boolean {
  const forced = q.get('title');
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (TITLE_SKIP_PARAMS.some((k) => q.has(k))) return false;
  return !o.seen && !o.automated;
}

export function titleSeen(): boolean {
  try {
    return sessionStorage.getItem(TITLE_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markTitleSeen(): void {
  try {
    sessionStorage.setItem(TITLE_SEEN_KEY, '1');
  } catch {
    // ignore
  }
}

/** Short summary under Continue: isles cleared and stars. */
export function progressSummary(levels: readonly LevelDef[] = LEVELS_2D): { cleared: number; stars: number; any: boolean } {
  const p = loadProgress2D(levels);
  return {
    cleared: p.clears.filter((c) => c > 0).length,
    stars: p.bestStars.reduce((a, s) => a + Math.max(0, s), 0),
    any: hasAnyProgress(p),
  };
}

/** Loading-bar fraction: finished weight over total weight (0..1). */
export function loadFraction(done: readonly number[], weights: readonly number[]): number {
  const total = weights.reduce((a, w) => a + w, 0);
  if (total <= 0) return 1;
  return Math.min(1, done.reduce((a, w) => a + w, 0) / total);
}

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => {
      if (typeof i.decode === 'function') void i.decode().catch(() => undefined).then(() => resolve());
      else resolve();
    };
    i.onerror = () => resolve();
    i.src = url;
  });
}

/** Keys that do not count as "press any key". */
const MODIFIER_KEYS: readonly string[] = ['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock']; // i18n-ignore (key names)

export type TitlePhase = 'loading' | 'tap' | 'menu' | 'leaving';

export interface TitleHandlers {
  /** Opens the world map (mounted under the title, which then fades out). */
  openMap(): Promise<void>;
  openSettings(onClose: () => void): void;
  openCredits(onClose: () => void): void;
  /** Asks before New game erases progress (true = go). */
  confirmNewGame(): Promise<boolean>;
}

export interface TitleScreen {
  readonly el: HTMLElement;
  state(): { phase: TitlePhase; progress: number; keyart: boolean; logo: boolean; buttons: string[] };
}

/** Isles of the stand-in key art: [painting, left %, top %, width (vmin), depth, bob delay s]. */
const STAND_IN_ISLES: ReadonlyArray<readonly [string, number, number, number, number, number]> = [
  ['island-i14', 70, 22, 17, 0.35, 1.2],
  ['island-i02', 13, 26, 15, 0.4, 2.4],
  ['island-i05', 74, 50, 36, 0.75, 0.6],
  ['island-l1c', 3, 46, 46, 1, 0],
];

/**
 * Mounts the title over the page and runs it: loading → tap → menu → the map. Resolves once the
 * player has picked Continue / New game and the map is on screen (the title is gone).
 */
export function runTitle(q: URLSearchParams, h: TitleHandlers): { screen: TitleScreen; done: Promise<void> } {
  const touch = isTouchDevice();
  let phase: TitlePhase = 'loading';
  let progress = 0;
  let art: TitleArt = { keyart: null, logo: null, logoTr: null };

  const root = el('div', 'pu pu-title loading', { 'data-testid': 'title2d', role: 'main' });
  const scene = el('div', 'pu-title-scene', { 'aria-hidden': 'true' });
  const sky = el('div', 'pu-title-layer pu-title-sea');
  sky.style.setProperty('--depth', '0.15');
  sky.append(el('div', 'pu-title-sea-art'));
  scene.append(sky);
  const isles = STAND_IN_ISLES.map(([key, x, y, w, depth, delay]) => {
    const layer = el('div', 'pu-title-layer pu-title-isle');
    layer.style.left = `${x}%`;
    layer.style.top = `${y}%`;
    layer.style.width = `${w}vmin`;
    layer.style.setProperty('--depth', String(depth));
    const bob = el('div', 'pu-title-bob');
    bob.style.animationDelay = `${-delay}s`;
    bob.style.setProperty('--far', String(1 - depth));
    bob.append(img(`${ART}ui/${key}.webp`));
    layer.append(bob);
    return layer;
  });
  const ship = el('div', 'pu-title-layer pu-title-ship');
  ship.style.setProperty('--depth', '0.6');
  ship.append(el('div', 'pu-title-sail', {}, img(`${ART}ui/ship.webp`)));
  const clouds = [1, 2, 3].map((n) => {
    const c = el('div', `pu-title-layer pu-title-cloud c${n}`);
    c.style.setProperty('--depth', String(1.2 + n * 0.15));
    c.append(el('div', 'pu-title-drift', {}, img(`${ART}ui/sea/cloud-${n}.webp`)));
    return c;
  });
  scene.append(...isles, ship, ...clouds, el('div', 'pu-title-vignette'));

  // Logo (painted when available, else lettering on the banner).
  const logoBox = el('div', 'pu-title-logo');
  const lettering = el('h1', 'pu-title-name', {}, el('span', 'pu-title-word pu-letter', {}, t('page.title')));
  const tagWords = el('span', '', {}, t('title.subtitle'));
  const tagline = el('div', 'pu-title-tagline pu-letter', {}, tagWords);
  logoBox.append(lettering, tagline);

  // Loading bar → tap prompt → menu.
  const barFill = el('i', 'pu-title-bar-fill');
  const bar = el('div', 'pu-title-bar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-label': t('title.loading'), 'data-testid': 'title2d-bar' }, barFill);
  const barText = el('div', 'pu-title-bar-text pu-letter', {}, t('title.loading'));
  const loadBox = el('div', 'pu-title-load', {}, bar, barText);
  const tap = el('button', 'pu-title-tap pu-letter', { type: 'button', 'data-testid': 'title2d-tap' }, touch ? t('title.tapStart') : t('title.clickStart'));
  const menu = el('nav', 'pu-title-menu', { 'data-testid': 'title2d-menu', 'aria-label': t('page.title') });
  root.append(scene, el('div', 'pu-title-front', {}, logoBox, el('div', 'pu-title-stage', {}, loadBox, tap, menu)));
  document.body.append(root);
  // The ribbon's cloth spans its middle 69 % (art x 80..432 of 512): side padding grows with the words.
  const fitTagline = (): void => {
    const f = parseFloat(getComputedStyle(tagline).fontSize) || 16;
    tagline.style.paddingLeft = tagline.style.paddingRight = `${Math.ceil(0.23 * tagWords.offsetWidth + 0.5 * f)}px`;
  };
  fitTagline();
  window.addEventListener('resize', fitTagline);

  // Pointer parallax (desktop) — layers shift by their depth.
  const parallax = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    root.style.setProperty('--px', ((e.clientX / Math.max(1, window.innerWidth)) * 2 - 1).toFixed(3));
    root.style.setProperty('--py', ((e.clientY / Math.max(1, window.innerHeight)) * 2 - 1).toFixed(3));
  };
  root.addEventListener('pointermove', parallax);

  const setProgress = (f: number): void => {
    progress = f;
    barFill.style.width = `${(f * 100).toFixed(1)}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  };

  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });

  const buttons: HTMLButtonElement[] = [];
  let menuAt = 0;
  const leave = async (fresh: boolean): Promise<void> => {
    // The tap that opened the menu must not also press the plank that appeared under the finger.
    if (phase !== 'menu' || performance.now() - menuAt < 350) return;
    if (fresh && progressSummary().any) {
      const ok = await h.confirmNewGame();
      if (!ok) {
        buttons[1]?.focus({ preventScroll: true });
        return;
      }
      resetProgress2D();
    }
    phase = 'leaving';
    markTitleSeen();
    root.classList.add('busy');
    await h.openMap();
    root.classList.add('leaving');
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', fitTagline);
    const gone = (): void => {
      root.remove();
      resolveDone();
    };
    root.addEventListener('transitionend', gone, { once: true });
    window.setTimeout(gone, 900);
  };

  const buildMenu = (): void => {
    const sum = progressSummary();
    buttons.length = 0;
    menu.replaceChildren();
    if (sum.any) {
      const cont = plank(t('title.continue'), { kind: 'primary', icon: 'play', testid: 'title2d-continue' });
      cont.addEventListener('click', () => void leave(false));
      const note = el('div', 'pu-title-note pu-letter', {}, t('title.progress', { n: sum.cleared, stars: sum.stars }));
      const fresh = plank(t('title.newGame'), { testid: 'title2d-new' });
      fresh.addEventListener('click', () => void leave(true));
      buttons.push(cont, fresh);
      menu.append(cont, note, fresh);
    } else {
      const play = plank(t('title.play'), { kind: 'primary', icon: 'play', testid: 'title2d-new' });
      play.addEventListener('click', () => void leave(true));
      buttons.push(play);
      menu.append(play);
    }
    const settings = plank(t('title.settings'), { kind: 'small', icon: 'settings', testid: 'title2d-settings' });
    const credits = plank(t('title.credits'), { kind: 'small', testid: 'title2d-credits' });
    // Back from a board: Settings may have erased the progress (rebuild), focus returns to the plank.
    const back = (b: HTMLButtonElement) => () => {
      const id = b.dataset.testid;
      if (phase !== 'menu') return;
      buildMenu();
      buttons.find((x) => x.dataset.testid === id)?.focus({ preventScroll: true });
    };
    settings.addEventListener('click', () => {
      if (performance.now() - menuAt >= 350) h.openSettings(back(settings));
    });
    credits.addEventListener('click', () => {
      if (performance.now() - menuAt >= 350) h.openCredits(back(credits));
    });
    buttons.push(settings, credits);
    menu.append(el('div', 'pu-title-row', {}, settings, credits));
  };

  const showMenu = (): void => {
    if (phase !== 'tap') return;
    phase = 'menu';
    menuAt = performance.now();
    root.classList.remove('tap');
    root.classList.add('menu');
    buildMenu();
    requestAnimationFrame(() => buttons[0]?.focus({ preventScroll: true }));
  };

  const onKey = (e: KeyboardEvent): void => {
    if (phase === 'tap' && !e.repeat && !MODIFIER_KEYS.includes(e.key)) {
      e.preventDefault();
      showMenu();
      return;
    }
    if (phase !== 'menu' || document.querySelector('.pu-overlay:not(.closing)')) return;
    // Arrow keys / WASD walk the menu (wrapping); Enter / Space press the focused plank natively.
    const k = e.key.toLowerCase();
    const step = k === 'arrowdown' || k === 's' || k === 'arrowright' || k === 'd' ? 1 : k === 'arrowup' || k === 'w' || k === 'arrowleft' || k === 'a' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(i < 0 ? 0 : i + step + buttons.length) % buttons.length];
    next?.focus({ preventScroll: true });
  };
  window.addEventListener('keydown', onKey);
  tap.addEventListener('click', showMenu);
  root.addEventListener('click', (e) => {
    if (phase === 'tap' && e.target !== tap) showMenu();
  });

  // Load: the map's code + manifest + the paintings the title and the map show first.
  const started = performance.now();
  const weights: number[] = [];
  const finished: number[] = [];
  const track = <T>(p: Promise<T>, w = 1): Promise<T> => {
    weights.push(w);
    return p.finally(() => {
      finished.push(w);
      setProgress(loadFraction(finished, weights));
    });
  };
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const firstPaint = [
    `${ART}ui/${small ? 'sea@0.5x' : 'sea'}.webp`,
    ...STAND_IN_ISLES.map(([k]) => `${ART}ui/${k}.webp`),
    `${ART}ui/ship.webp`,
    ...[1, 2, 3].map((n) => `${ART}ui/sea/cloud-${n}.webp`),
    `${ART}ui-banner.webp`,
    `${ART}ui-plaque.webp`,
    `${ART}ui/button-go.webp`,
  ];
  const mapThumbs = LEVELS_2D.slice(0, 8).map((l) => `${ART}ui/island-${l.id}.webp`);
  const loading = (async () => {
    const manifest = await track(fetchMapsManifest(), 2);
    art = titleArt(manifest);
    if (art.keyart) {
      root.classList.add('has-keyart');
      sky.querySelector('div')?.remove();
      const ka = img(art.keyart, '', 'pu-title-keyart');
      sky.append(ka);
    }
    const logo = titleLogo(art, getLocale());
    if (logo) {
      root.classList.add('has-logo');
      lettering.replaceChildren(img(logo, t('page.title'), 'pu-title-logo-art'));
    }
    await Promise.all([
      track(import('./worldMap.ts'), 3),
      ...[...firstPaint, ...(art.keyart ? [art.keyart] : []), ...(logo ? [logo] : []), ...mapThumbs].map((u) => track(preloadImage(u))),
    ]);
  })();
  void loading
    .catch(() => undefined)
    .then(async () => {
      setProgress(1);
      // Let the bar be seen filling (a fast load must not flash it).
      const wait = Math.max(0, 650 - (performance.now() - started));
      await new Promise((r) => window.setTimeout(r, wait + 250));
      barText.textContent = t('title.loaded');
      phase = 'tap';
      root.classList.remove('loading');
      root.classList.add('tap');
      if (q.get('titlemenu') === '1' || q.has('titleopen')) showMenu();
      // Back from a language switch made in the title's Settings: open it again.
      if (q.get('titleopen') === 'settings') {
        const b = buttons.find((x) => x.dataset.testid === 'title2d-settings');
        if (b) h.openSettings(() => b.focus({ preventScroll: true }));
      }
    });

  const screen: TitleScreen = {
    el: root,
    state: () => ({ phase, progress, keyart: !!art.keyart, logo: root.classList.contains('has-logo'), buttons: buttons.map((b) => b.dataset.testid ?? '') }),
  };
  return { screen, done };
}
