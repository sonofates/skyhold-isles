/**
 * The HUD dock (pure, no Pixi / DOM): one fixed place for every HUD piece, derived from the screen
 * size alone, so it is the same on every island. The map is then fitted around it (viewFit.ts
 * `fitAroundHud`): no road, plot, cave or castle ever lies under a HUD piece.
 *
 * Two forms, by screen shape:
 *
 * `bands` (16:9, 16:10, 4:3 … — the map fills the width, so the HUD takes thin top / bottom bands)
 *   ┌ info card slot (next wave / tapped foe) ──────────── Settings Codex Pause Speed ┐
 *   │                               (the island)                                     │
 *   └ lives+gold plaque ─── [hero | skills ‖ abilities] tray ─── horn ─ wave banner ─┘
 *
 * `columns` (phones in landscape, ultrawide — wider than the map, so the HUD takes the sides)
 *   ┌ info ┐                                              Settings Codex Pause Speed ┐
 *   │ slot │                                                                        │
 *   │ hero │                     (the island)                                       │
 *   │skills│                                                                  horn  │
 *   └ plaque (lives+gold)                                                  wave banner┘
 *
 * Measured with scripts/hudFit.ts: one band form on the top and bottom costs ~20 % of map scale on
 * 16:9 (the painted islands run edge to edge), the columns cost ~20 % on phones and ~2 % on 21:9;
 * every other arrangement tried (corner clusters, everything on top, a bottom-centre tray on
 * phones) cost more.
 */
import { HUD_MIN_TOUCH, hudButtonsKeepOut, plaqueLayout, uiScale, type Insets, type PlaqueLayout, type PlaqueSlots, type Rect } from './uiLayout.ts';

/** Width (or height, in a column) of the hero group at button size `d` and spacing `gap`. */
export function heroGroupLong(d: number, gap: number): number {
  return Math.round(d * 1.5 + d * 2 + d * 0.12 + gap * 3);
}

/** Length of the tray in a row: hero group (if any), a gap, the two abilities, key-chip overhang. */
export function trayLong(d: number, gap: number, hero: boolean): number {
  return (hero ? heroGroupLong(d, gap) + gap : 0) + d * 2 + gap + Math.round(d * 0.12);
}

/** Height of the tray in a row: the hero portrait (1.5 d with its margin) or a button, + chip overhang. */
export function trayShort(d: number, hero: boolean): number {
  return Math.ceil((hero ? d * 1.5 : d) + d * 0.08);
}

/** The three-row stack up a side (portrait / hero skills / abilities; abilities only without a hero). */
export function trayStack(d: number, gap: number, hero: boolean): { w: number; h: number } {
  return { w: Math.ceil(d * 2 + gap + d * 0.12), h: Math.ceil(hero ? d * 3.5 + gap * 1.2 + d * 0.08 : d * 1.08) };
}

export type DockForm = 'bands' | 'columns';

/** Screens at least this much wider than tall get the side columns. */
export const COLUMNS_ASPECT = 1.9;

export function dockForm(w: number, h: number): DockForm {
  return w / Math.max(1, h) >= COLUMNS_ASPECT ? 'columns' : 'bands';
}

export interface HudDockOptions {
  /** Plaque art width / height and its number slots (hud.ts picks the kit or the legacy plaque). */
  readonly plaqueAspect: number;
  readonly plaqueSlots: PlaqueSlots;
  /** Wave banner art width / height. */
  readonly bannerAspect: number;
  /** The hero group leads the tray. */
  readonly hero: boolean;
}

export interface HudDock {
  readonly form: DockForm;
  readonly pad: number;
  readonly gap: number;
  /** Top-right round buttons (speed, pause, Codex, Settings) with their captions. */
  readonly buttons: Rect;
  /** Slot of the info cards (next-wave card, tapped-foe card): top-left. */
  readonly info: Rect;
  readonly plaque: PlaqueLayout;
  readonly banner: Rect;
  /** Horn centre / radius. Its box holds the countdown ring and, on its left, the label / seconds. */
  readonly horn: { readonly x: number; readonly y: number; readonly r: number };
  readonly hornBox: Rect;
  /** Width of the label / seconds column left of the horn. */
  readonly hornTextW: number;
  /** Hero + ability tray (the bar's box), its arrangement and button size. */
  readonly tray: Rect;
  readonly trayLayout: 'row' | 'stack';
  readonly d: number;
  /** Every piece, grown by DOCK_MARGIN: the map keeps the playfield out of these. */
  readonly reserved: readonly Rect[];
}

/** Horn radius at a UI scale (never under a comfortable touch target). */
export function dockHornR(u: number): number {
  return Math.max(HUD_MIN_TOUCH / 2 + 4, 34 * u);
}

/** Space the map keeps between the playfield and a HUD piece (css px). */
export const DOCK_MARGIN = 4;

/** The painted-UI unit `--s` (paintedUi.css) at a screen size. */
export function uiUnit(w: number, h: number): number {
  return Math.max(8.5, Math.min(0.0095 * w, 0.0185 * h, 17));
}

export function hudDock(w: number, h: number, insets: Insets, o: HudDockOptions): HudDock {
  const form = dockForm(w, h);
  const u = uiScale(w, h);
  const s = uiUnit(w, h);
  const pad = Math.max(8, 14 * u);
  const gap = Math.round(Math.max(10, 16 * u));
  const buttons = hudButtonsKeepOut(w, h, insets);
  const plaque = plaqueLayout(w, h, insets, o.plaqueAspect, o.plaqueSlots);
  const bottom = h - insets.bottom - pad;
  const top = insets.top + Math.max(6, pad * 0.5);
  const leftX = insets.left + pad;
  // Wave banner bottom-right, mirroring the plaque.
  const bw = Math.max(150, Math.min(230 * u, (w - insets.left - insets.right) * 0.3));
  const bh = bw / o.bannerAspect;
  const banner: Rect = { x: w - insets.right - pad - bw, y: bottom - bh, w: bw, h: bh };
  const r = dockHornR(u);
  const hornTextW = Math.round(Math.max(15, 20 * u) * 2.8);
  const want = Math.round(Math.max(46, 52 * u));
  let horn: { x: number; y: number; r: number };
  let tray: Rect;
  let info: Rect;
  let d: number;
  let trayLayout: 'row' | 'stack';
  if (form === 'bands') {
    // Horn just left of the banner, on the bottom line.
    horn = { x: banner.x - gap * 0.5 - r * 1.2, y: bottom - r * 1.2, r };
    const hornLeft = horn.x - r * 1.2 - hornTextW;
    // Tray between the plaque and the horn, centred on the screen when it fits there.
    const left = plaque.x + plaque.w + gap;
    const right = hornLeft - gap;
    const coef = o.hero ? 1.5 + 2 + 0.12 + 2 + 0.12 : 2.12;
    const fitD = Math.floor((right - left - (o.hero ? 5 : 1) * gap - 2) / coef);
    d = Math.max(40, Math.min(want, fitD));
    const tw = trayLong(d, gap, o.hero);
    const th = trayShort(d, o.hero);
    let tx = Math.max(left, Math.min(right - tw, w / 2 - tw / 2));
    let ty = bottom - th;
    // A screen too narrow for one row (portrait): the tray rides above the plaque.
    if (right - left < tw) {
      tx = plaque.x;
      ty = plaque.y - gap - th;
    }
    tray = { x: tx, y: ty, w: tw, h: th };
    trayLayout = 'row';
    // Info slot top-left, as tall as the button band, up to half the screen.
    const ih = Math.max(buttons.y + buttons.h - top, s * 7);
    info = { x: leftX, y: top, w: Math.max(0, Math.min(w * 0.5, buttons.x - gap - leftX)), h: ih };
  } else {
    // Right column: the horn stands on the banner's right end.
    horn = { x: banner.x + banner.w - r * 1.2, y: banner.y - gap * 0.4 - r * 1.2, r };
    // Left column: the tray stack on the plaque, the info slot above it. The stack's buttons shrink
    // (never under 40 px) so the info slot keeps ~7 lines of card.
    const minInfo = Math.max(84, s * 9);
    let dd = want;
    while (dd > 40 && plaque.y - gap * 0.6 - trayStack(dd, gap, o.hero).h - gap * 0.6 - top < minInfo) dd -= 2;
    d = dd;
    const st = trayStack(d, gap, o.hero);
    tray = { x: leftX, y: plaque.y - gap * 0.6 - st.h, w: st.w, h: st.h };
    trayLayout = 'stack';
    // Narrow (the column's width on phones, ~1/8 of an ultrawide): every px of it costs map scale.
    const iw = Math.max(st.w, Math.min(w * 0.13, s * 22));
    info = { x: leftX, y: top, w: iw, h: Math.min(s * 18, Math.max(40, tray.y - gap * 0.6 - top)) };
  }
  const hornBox: Rect = { x: horn.x - r * 1.2 - hornTextW, y: horn.y - r * 1.2, w: r * 2.4 + hornTextW, h: r * 2.4 };
  const m = DOCK_MARGIN;
  const grow = (q: Rect): Rect => ({ x: q.x - m, y: q.y - m, w: q.w + m * 2, h: q.h + m * 2 });
  const reserved = [buttons, info, { x: plaque.x, y: plaque.y, w: plaque.w, h: plaque.h }, banner, hornBox, tray].map(grow);
  return { form, pad, gap, buttons, info, plaque, banner, horn, hornBox, hornTextW, tray, trayLayout, d, reserved };
}

/** The dock's pieces by name (QA / tests: each must cover nothing). */
export function dockPieces(k: HudDock): Record<'buttons' | 'info' | 'plaque' | 'banner' | 'horn' | 'tray', Rect> {
  return { buttons: k.buttons, info: k.info, plaque: { x: k.plaque.x, y: k.plaque.y, w: k.plaque.w, h: k.plaque.h }, banner: k.banner, horn: k.hornBox, tray: k.tray };
}
