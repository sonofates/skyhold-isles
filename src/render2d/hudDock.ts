/**
 * The HUD dock (pure, no Pixi / DOM): compact corner pieces over a full-bleed map. One form on
 * every screen shape, desktop to phone (sizes follow the screen):
 *
 *   ┌ info card (next wave / tapped foe / new foe) ·········· Settings Codex Pause Speed ┐
 *   │                                                                                   │
 *   │                              (the island, edge to edge)                     horn  │
 *   └ lives+gold plaque ········ [hero | skills ‖ abilities] tray ········ wave banner ──┘
 *
 * The map covers the screen (fullBleed.ts) and the pieces lie over its decorative edges. A piece
 * never covers a plot, a cave, the castle or a road inside the safe area at the map's default
 * view: the view is panned to clear them, the tray may slide along the bottom and the horn may
 * stand left of the banner (`hornAlt`). The info card stays in its corner.
 */
import { HUD_MIN_TOUCH, hudButtonsKeepOut, plaqueLayout, uiScale, userUiScale, type Insets, type PlaqueLayout, type PlaqueSlots, type Rect } from './uiLayout.ts';

/**
 * The hero + ability tray at button size `d` (hero skills and abilities are `d` wide): the hero's
 * portrait is a little larger (TRAY_PORTRAIT × d, its HP ring inside that box), a slim divider
 * stands between the hero's buttons and the abilities, every gap is the dock's `gap`, and the
 * painted backing keeps TRAY_PAD × d on every side (abilityBar2d.css / heroHud2d.css draw it).
 */
export const TRAY_PORTRAIT = 1.18;
export const TRAY_PAD = 0.14;
export const TRAY_DIVIDER = 0.08;

/** Width of the hero group (portrait, two skills, divider) at button size `d` and spacing `gap`. */
export function heroGroupLong(d: number, gap: number): number {
  return Math.round(d * TRAY_PORTRAIT + d * 2 + d * TRAY_DIVIDER + gap * 3);
}

/** Length of the tray in a row: hero group (if any), a gap, the two abilities, the backing's padding. */
export function trayLong(d: number, gap: number, hero: boolean): number {
  return Math.round((hero ? heroGroupLong(d, gap) + gap : 0) + d * 2 + gap + d * TRAY_PAD * 2);
}

/** Height of the tray in a row: the hero portrait (or a button) and the backing's padding. */
export function trayShort(d: number, hero: boolean): number {
  return Math.ceil((hero ? d * TRAY_PORTRAIT : d) + d * TRAY_PAD * 2);
}

export type DockForm = 'corners';

export interface HudDockOptions {
  /** Plaque art width / height and its number slots (hud.ts picks the kit or the legacy plaque). */
  readonly plaqueAspect: number;
  readonly plaqueSlots: PlaqueSlots;
  /** Wave banner art width / height. */
  readonly bannerAspect: number;
  /** The hero group leads the tray. */
  readonly hero: boolean;
}

export interface HornSpot {
  readonly horn: { readonly x: number; readonly y: number; readonly r: number };
  readonly hornBox: Rect;
}

export interface HudDock extends HornSpot {
  readonly form: DockForm;
  readonly pad: number;
  readonly gap: number;
  /** Top-right round buttons (speed, pause, Codex, Settings) with their captions. */
  readonly buttons: Rect;
  /** Slot of the info cards (next-wave card, tapped-foe card, new-foe heads-up): top-left. */
  readonly info: Rect;
  /** Left edges the info slot may take (its corner only, since the pan; kept for callers). */
  readonly infoRange: readonly [number, number];
  readonly plaque: PlaqueLayout;
  readonly banner: Rect;
  /** Width of the label / seconds column left of the horn. */
  readonly hornTextW: number;
  /** The horn's other spot: left of the banner, on the bottom line. */
  readonly hornAlt: HornSpot | null;
  /** Hero + ability tray (the bar's box), always one row; button size `d`. */
  readonly tray: Rect;
  /** Left edges the tray may slide between (along the bottom, plaque to banner). */
  readonly trayRange: readonly [number, number];
  readonly trayLayout: 'row';
  readonly d: number;
}

/** Horn radius at a UI scale (never under a comfortable touch target). */
export function dockHornR(u: number): number {
  return Math.max(HUD_MIN_TOUCH / 2 + 4, 32 * u);
}

/** The painted-UI unit `--s` (paintedUi.css) at a screen size. */
export function uiUnit(w: number, h: number): number {
  const k = userUiScale();
  return Math.max(8.5, Math.min(0.0095 * w * k, 0.0185 * h * k, 17 * k));
}

/** Corner pieces are this much smaller than the old bands (compact HUD over a full-bleed map). */
export const DOCK_COMPACT = 0.86;

export function hudDock(w: number, h: number, insets: Insets, o: HudDockOptions): HudDock {
  const u = uiScale(w, h);
  const cu = u * DOCK_COMPACT;
  const s = uiUnit(w, h);
  const pad = Math.max(8, 14 * u);
  const gap = Math.round(Math.max(10, 14 * u));
  const buttons = hudButtonsKeepOut(w, h, insets);
  const plaque = plaqueLayout(w, h, insets, o.plaqueAspect, o.plaqueSlots, DOCK_COMPACT);
  const bottom = h - insets.bottom - pad;
  const top = insets.top + Math.max(6, pad * 0.5);
  const leftX = insets.left + pad;
  // Wave banner bottom-right, mirroring the plaque.
  const bw = Math.max(150, Math.min(230 * cu, (w - insets.left - insets.right) * 0.28));
  const bh = bw / o.bannerAspect;
  const banner: Rect = { x: w - insets.right - pad - bw, y: bottom - bh, w: bw, h: bh };
  const r = dockHornR(u);
  const hornTextW = Math.round(Math.max(15, 20 * u) * 2.8);
  const box = (x: number, y: number): Rect => ({ x: x - r * 1.2 - hornTextW, y: y - r * 1.2, w: r * 2.4 + hornTextW, h: r * 2.4 });
  // Home: the horn stands on the banner's right end (one compact corner). Alt: left of the banner.
  const hx = banner.x + banner.w - r * 1.2;
  const hy = banner.y - gap * 0.4 - r * 1.2;
  const ax = banner.x - gap * 0.5 - r * 1.2;
  const ay = bottom - r * 1.2;
  const hornAlt: HornSpot = { horn: { x: ax, y: ay, r }, hornBox: box(ax, ay) };
  // Tray: one row between the plaque and the banner, centred on the screen when it can be.
  // Buttons about as weighty as the portrait (owner feedback 2026-11-19: the skills read small).
  const want = Math.round(Math.max(44, 50 * cu));
  const left = plaque.x + plaque.w + gap;
  const right = banner.x - gap;
  const coef = (o.hero ? TRAY_PORTRAIT + 2 + TRAY_DIVIDER + 2 : 2) + TRAY_PAD * 2;
  const fitD = Math.floor((right - left - (o.hero ? 5 : 1) * gap - 2) / coef);
  const d = Math.max(40, Math.min(want, fitD));
  const tw = trayLong(d, gap, o.hero);
  const th = trayShort(d, o.hero);
  let tray: Rect;
  let trayRange: [number, number];
  if (right - left >= tw) {
    const tx = Math.max(left, Math.min(right - tw, w / 2 - tw / 2));
    tray = { x: tx, y: bottom - th, w: tw, h: th };
    trayRange = [left, right - tw];
  } else {
    // A screen too narrow for one row (portrait): the tray rides above the plaque.
    tray = { x: plaque.x, y: plaque.y - gap - th, w: tw, h: th };
    trayRange = [plaque.x, plaque.x];
  }
  // Info slot anchored in the top-left corner, compact (owner feedback 2026-11-21: a card floating
  // mid-top read as misplaced). Never into the top-centre column (the first-island coach card,
  // 30 --s wide) or the buttons. The map's default view keeps it clear (fullBleed.ts).
  const stop = Math.min(w / 2 - s * 15 - gap, buttons.x - gap);
  const iw = Math.max(Math.min(110, stop - leftX), Math.min(s * 17, w * 0.21, stop - leftX));
  const ih = Math.max(s * 7.5, 64);
  const info: Rect = { x: leftX, y: top, w: iw, h: ih };
  const infoRange: [number, number] = [leftX, leftX];
  return {
    form: 'corners', pad, gap, buttons, info, infoRange, plaque, banner, horn: { x: hx, y: hy, r }, hornBox: box(hx, hy), hornTextW, hornAlt,
    tray, trayRange, trayLayout: 'row', d,
  };
}

/** The dock's pieces by name (QA / tests: each must cover nothing). */
export function dockPieces(k: HudDock): Record<'buttons' | 'info' | 'plaque' | 'banner' | 'horn' | 'tray', Rect> {
  return { buttons: k.buttons, info: k.info, plaque: { x: k.plaque.x, y: k.plaque.y, w: k.plaque.w, h: k.plaque.h }, banner: k.banner, horn: k.hornBox, tray: k.tray };
}
