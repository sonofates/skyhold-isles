/**
 * Small DOM builders for the painted UI (see paintedUi.css). Every visible surface comes from the
 * painted kit; these only assemble the pieces.
 */
import './paintedUi.css';
import { t } from '../../i18n/index.ts';
import { ICONS, type IconName } from './paintedIcons.ts';

export const ART = '/art2d/';
export const KIT = {
  star: `${ART}ui/star.webp`,
  starEmpty: `${ART}ui/star-empty.webp`,
  medallion: `${ART}ui/medallion.webp`,
  medallionHi: `${ART}ui/medallion-hi.webp`,
  confirm: `${ART}ui/icon-confirm.webp`,
  rally: `${ART}ui/icon-rally.webp`,
  upgrade: `${ART}ui/icon-upgrade.webp`,
  heart: `${ART}icon-heart.webp`,
  gold: `${ART}icon-crown-coins.webp`,
  pipEmpty: `${ART}ui/pip-empty.webp`,
  pipFilled: `${ART}ui/pip-filled.webp`,
  toggleOn: `${ART}ui/toggle-on.webp`,
  toggleOff: `${ART}ui/toggle-off.webp`,
  portraitPell: `${ART}ui/portrait-pell.webp`,
  priceTag: `${ART}ui/price-tag.webp`,
} as const;

/** Painted difficulty jewel (`gem-<difficulty>.webp`). */
export function gemUrl(difficulty: string): string {
  return `${ART}ui/gem-${difficulty.toLowerCase()}.webp`;
}

/** Painted wax seal (`seal-<name>.webp`, feat icons and challenge IDs). */
export function sealUrl(name: string): string {
  return `${ART}ui/seal-${name}.webp`;
}

/**
 * A painted wax seal badge. Keeps the `pu-round` class so the screens' seal sizing rules apply,
 * plus `pu-seal`, which drops the wooden button backing (each seal painting has its own).
 */
export function sealBadge(name: string): HTMLSpanElement {
  const s = el('span', 'pu-round pu-seal', { 'aria-hidden': 'true' });
  s.append(img(sealUrl(name)));
  return s;
}

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

export function glyph(name: IconName): HTMLSpanElement {
  const s = el('span', 'pu-glyph');
  s.innerHTML = ICONS[name];
  return s;
}

export function img(src: string, alt = '', cls = ''): HTMLImageElement {
  const i = el('img', cls, { src, alt, draggable: 'false' });
  if (!alt) i.setAttribute('aria-hidden', 'true');
  return i;
}

/** Round wooden kit button with a glyph (and an optional lettered caption under it). */
export function roundButton(icon: IconName, aria: string, testid: string, caption?: string): HTMLButtonElement {
  const b = el('button', 'pu-round', { type: 'button', 'aria-label': aria, 'data-testid': testid, title: aria });
  b.append(glyph(icon));
  if (caption) b.append(el('span', 'pu-round-label pu-letter', {}, caption));
  return b;
}

/** Wood plank button with lettering (and an optional glyph in front). */
export function plank(label: string, opts: { icon?: IconName; kind?: 'primary' | 'small'; testid?: string; sub?: string } = {}): HTMLButtonElement {
  const b = el('button', `pu-plank pu-letter${opts.kind ? ` ${opts.kind}` : ''}`, { type: 'button', 'data-testid': opts.testid });
  if (opts.icon) b.append(glyph(opts.icon));
  const text = el('span', '', {}, label);
  if (opts.sub) text.append(el('span', 'pu-plank-sub', {}, opts.sub));
  b.append(text);
  return b;
}

/** Three kit stars (earned ones gold). Font-size of the container sets the star size. */
export function starsRow(earned: number, cls = 'pu-stars'): HTMLSpanElement {
  const s = el('span', cls, { 'aria-label': t('common.starsOf3', { n: earned }), role: 'img' });
  for (let i = 0; i < 3; i++) s.append(img(i < earned ? KIT.star : KIT.starEmpty));
  return s;
}

/** A medallion framing a round vignette of an island's painted map (`thumb` null = grass mound). */
export function medal(thumb: string | null, d: number | string, glow = false): HTMLDivElement {
  const m = el('div', 'pu-medal');
  m.style.setProperty('--d', typeof d === 'number' ? `${d}px` : d);
  m.append(img(glow ? KIT.medallionHi : KIT.medallion, '', 'pu-medal-ring'));
  const t = el('span', `pu-medal-thumb${thumb ? '' : ' blank'}`);
  if (thumb) {
    t.style.backgroundImage = `url("${thumb}")`;
    t.style.backgroundSize = thumb.includes('/ui/island-') ? 'contain' : 'auto 135%';
    t.style.backgroundPosition = '55% 50%';
  }
  m.append(t);
  return m;
}

export interface Sheet {
  readonly overlay: HTMLDivElement;
  readonly sheet: HTMLDivElement;
  readonly body: HTMLDivElement;
  close(): void;
}

let openSheets = 0;

/**
 * A ribbon board over a dimmed backdrop, with the title lettered on the ribbon and a round close
 * button on its corner. Escape / tapping the backdrop closes it (unless `modal`).
 */
export function openSheet(
  title: string,
  opts: { cls?: string; red?: boolean; testid?: string; onClose?: () => void; modal?: boolean; closeButton?: boolean } = {},
): Sheet {
  const overlay = el('div', 'pu pu-overlay', { 'data-testid': opts.testid });
  const sheet = el('div', `pu-sheet${opts.red ? ' red' : ''}${opts.cls ? ` ${opts.cls}` : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const titleEl = el('div', 'pu-sheet-title pu-letter', {}, title);
  const body = el('div', 'pu-sheet-body');
  sheet.append(titleEl, body);
  overlay.append(sheet);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    openSheets--;
    window.removeEventListener('keydown', onKey);
    overlay.remove();
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !opts.modal) {
      e.preventDefault();
      close();
    }
  };
  if (opts.closeButton !== false) {
    const x = roundButton('close', t('common.close'), `${opts.testid ?? 'sheet'}-close`);
    x.classList.add('pu-sheet-close');
    x.addEventListener('click', close);
    sheet.append(x);
  }
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay && !opts.modal) close();
  });
  window.addEventListener('keydown', onKey);
  document.body.append(overlay);
  openSheets++;
  return { overlay, sheet, body, close };
}

export function anySheetOpen(): boolean {
  return openSheets > 0;
}

/** Painted toggle seal (role=switch): the full `toggle-on` / `toggle-off` paintings, swapped by state. */
export function toggle(on: boolean, aria: string, testid: string, onChange: (v: boolean) => void): HTMLButtonElement {
  const b = el('button', 'pu-toggle', { type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': aria, 'data-testid': testid });
  // Both states are in the DOM from the start, so a switch never flashes while an image loads.
  b.append(img(KIT.toggleOff, '', 'pu-toggle-off'), img(KIT.toggleOn, '', 'pu-toggle-on'));
  b.addEventListener('click', () => {
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return b;
}

/** Wood-plank slider 0..1 with a round knob (pointer drag + arrow keys). */
export function slider(value: number, aria: string, testid: string, onChange: (v: number) => void): HTMLDivElement {
  const root = el('div', 'pu-slider', { role: 'slider', tabindex: 0, 'aria-label': aria, 'aria-valuemin': 0, 'aria-valuemax': 100, 'data-testid': testid });
  const track = el('div', 'pu-slider-track');
  const fill = el('i', 'pu-slider-fill');
  track.append(fill);
  const knob = el('span', 'pu-slider-knob');
  root.append(track, knob);
  let v = Math.max(0, Math.min(1, value));
  const paint = (): void => {
    fill.style.width = `${v * 100}%`;
    knob.style.left = `${(v * 100).toFixed(1)}%`;
    root.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  };
  const set = (nv: number): void => {
    nv = Math.max(0, Math.min(1, nv));
    if (Math.abs(nv - v) < 1e-4) return;
    v = nv;
    paint();
    onChange(v);
  };
  const fromX = (x: number): void => {
    const r = root.getBoundingClientRect();
    set((x - r.left) / Math.max(1, r.width));
  };
  root.addEventListener('pointerdown', (e) => {
    root.setPointerCapture(e.pointerId);
    fromX(e.clientX);
  });
  root.addEventListener('pointermove', (e) => {
    if (root.hasPointerCapture(e.pointerId)) fromX(e.clientX);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(v - 0.05);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(v + 0.05);
    else return;
    e.preventDefault();
  });
  paint();
  return root;
}
