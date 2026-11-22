/**
 * Phone battle camera (pure math, no Pixi / DOM): frames the island's playable area (paths,
 * plots, gates/spawns, castle) instead of squeezing the entire painting with mirrored edge bands,
 * supports pinch-to-zoom and one-finger drag pan, and strictly clamps the viewport inside the
 * painted map at every zoom level so mirrored/repeated edges never appear.
 *
 * Desktop / MacBook views do not use this module — they keep fullBleed.ts untouched.
 */
import type { Level2DLayout } from '../data/levels/types.ts';
import {
  clampPan,
  coverageOf,
  dockCost,
  fitAt,
  hardOverlaps,
  HARD_MARGIN,
  panRange,
  slideX,
  type FullBleedFit,
  type FullBleedResult,
  type HardShapes,
  type PanRange,
} from './fullBleed.ts';
import { dockPieces, type HornSpot, type HudDock } from './hudDock.ts';
import { pointAlong } from './lanePath.ts';
import { PAN_SLOP } from './mapPan.ts';
import { playfieldShapes } from './playfield.ts';
import type { Rect } from './uiLayout.ts';

/** Short-edge threshold (css px) below which a non-desktop touch device uses the phone camera. */
export const PHONE_CAM_MAX_SHORT_SIDE = 600;
/** Extra margin (image px, split evenly across both sides of an axis) around the playable bbox. */
export const PLAYABLE_MARGIN_PX = 40;
/** Minimum initial zoom boost over whole-painting cover-fit when key points allow it. */
export const PHONE_MIN_INITIAL_BOOST = 1.25;
/** Maximum initial zoom boost over whole-painting cover-fit so the battlefield stays readable. */
export const PHONE_MAX_INITIAL_BOOST = 1.5;
/** Target plot ring diameter (css px) on phones for comfortable touch tapping. */
export const PHONE_TARGET_RING_PX = 46;
/** Plot ring width share inside plot-base.webp (manifest ringWidthPx / textureWidth = 500 / 512). */
export const PLOT_RING_WIDTH_SHARE = 500 / 512;
/** Maximum pinch zoom factor relative to whole-painting cover-fit (capped at PHONE_MAX_SCALE_CAP). */
export const PHONE_MAX_ZOOM_FACTOR = 2.5;
/** Upper cap on image-px → css-px scale so painted art stays sharp when pinched in. */
export const PHONE_MAX_SCALE_CAP = 2.4;

export interface PhoneCameraLimits {
  /** Whole-painting cover-fit: never zoom out past this (zero bands / mirrored edges). */
  readonly minScale: number;
  /** Default initial zoom scale framing the playable area. */
  readonly defaultScale: number;
  /** Maximum zoom scale for pinch-in. */
  readonly maxScale: number;
  /** Playable bounding box in map image px (paths, plots, entrances, castle). */
  readonly playable: Rect;
}

export interface PhoneCameraState {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface PhoneCameraFitResult extends FullBleedResult {
  readonly limits: PhoneCameraLimits;
}

/** True on phones (non-desktop pointer with a phone-sized short side); always false on desktop. */
export function isPhoneCamera(isDesktop: boolean, screenW: number, screenH: number): boolean {
  return !isDesktop && Math.min(screenW, screenH) <= PHONE_CAM_MAX_SHORT_SIDE;
}

/**
 * Tight bounding box (map image px, clamped to the painting) of the playable area:
 * plots, road path points, entrances/spawns, and the castle/goal.
 */
export function playableBounds(layout: Level2DLayout): Rect {
  const [iw, ih] = layout.imageSize;
  const k = layout.pxPerUnit;
  const px = (x: number): number => x * k + iw / 2;
  const py = (z: number): number => z * k + ih / 2;
  const shapes = playfieldShapes(layout);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (ax: number, ay: number, bx: number, by: number): void => {
    x0 = Math.min(x0, ax);
    y0 = Math.min(y0, ay);
    x1 = Math.max(x1, bx);
    y1 = Math.max(y1, by);
  };
  for (const p of shapes.plots) add(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r);
  for (const path of layout.paths) {
    for (const pt of path) add(px(pt.x), py(pt.z), px(pt.x), py(pt.z));
  }
  for (const e of layout.entrances) add(px(e.x), py(e.z), px(e.x), py(e.z));
  add(px(layout.goal.x), py(layout.goal.z), px(layout.goal.x), py(layout.goal.z));
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: iw, h: ih };
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(iw, x1);
  y1 = Math.min(ih, y1);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * Visible mouth of the first wave's primary spawn in map image px (falls back to the first
 * entrance / road start when no wave path is passed).
 */
export function firstSpawnPointPx(
  layout: Level2DLayout,
  primaryPath?: readonly { readonly x: number; readonly z: number }[] | null,
): { x: number; y: number } {
  const [iw, ih] = layout.imageSize;
  const k = layout.pxPerUnit;
  const path = primaryPath && primaryPath.length > 0 ? primaryPath : layout.paths[0];
  const pt = path && path.length > 0 ? (pointAlong(path, 1.5) ?? path[0]) : layout.entrances[0] ?? layout.goal;
  return {
    x: Math.max(0, Math.min(iw, pt.x * k + iw / 2)),
    y: Math.max(0, Math.min(ih, pt.z * k + ih / 2)),
  };
}

/**
 * Strict inside-painting pan range at `scale`: when `scale >= cover`, every offset in this range
 * keeps `[0, screenW] x [0, screenH]` wholly inside `[0, imageW] x [0, imageH]` (zero bands).
 */
export function strictPanRange(screenW: number, screenH: number, imageW: number, imageH: number, scale: number): PanRange {
  return panRange(screenW, screenH, imageW, imageH, scale);
}

/** Clamps `(x, y)` strictly inside the painted map at `scale`. */
export function clampPhonePan(
  screenW: number,
  screenH: number,
  imageW: number,
  imageH: number,
  scale: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return clampPan(strictPanRange(screenW, screenH, imageW, imageH, scale), x, y);
}

/** Clamps a pinch zoom scale into `[minScale, maxScale]`. */
export function clampZoom(scale: number, limits: Pick<PhoneCameraLimits, 'minScale' | 'maxScale'>): number {
  if (!Number.isFinite(scale)) return limits.minScale;
  return Math.min(limits.maxScale, Math.max(limits.minScale, scale));
}

/** True once pointer movement reaches or exceeds the tap-vs-drag threshold (css px). */
export function exceedsDragThreshold(
  startX: number,
  startY: number,
  curX: number,
  curY: number,
  threshold = PAN_SLOP,
): boolean {
  return Math.hypot(curX - startX, curY - startY) >= threshold;
}

/** Computes phone camera zoom bounds and default scale for a viewport and island layout. */
export function phoneCameraLimits(
  screenW: number,
  screenH: number,
  layout: Level2DLayout,
  firstSpawnPx?: { readonly x: number; readonly y: number },
): PhoneCameraLimits {
  const [iw, ih] = layout.imageSize;
  const k = layout.pxPerUnit;
  const playable = playableBounds(layout);
  const minScale = Math.max(screenW / iw, screenH / ih);
  const spawn = firstSpawnPx ?? firstSpawnPointPx(layout);
  const goalX = Math.max(0, Math.min(iw, layout.goal.x * k + iw / 2));
  const goalY = Math.max(0, Math.min(ih, layout.goal.z * k + ih / 2));

  // Frame the playable bounding box (plus a small margin) so the action fills the screen.
  const bboxCover = Math.max(screenW / (playable.w + PLAYABLE_MARGIN_PX), screenH / (playable.h + PLAYABLE_MARGIN_PX));
  // Aim for tappable plot rings (~>= 46 css px) without zooming excessively past cover.
  const ringImgPx = layout.plotRadius * k * 2 * PLOT_RING_WIDTH_SHARE;
  const minTapScale = PHONE_TARGET_RING_PX / Math.max(1, ringImgPx);
  // Keep both the first spawn and the castle able to sit on screen together with breathing room.
  const padX = Math.min(44, screenW * 0.06);
  const padY = Math.min(36, screenH * 0.08);
  const spanX = Math.abs(goalX - spawn.x);
  const spanY = Math.abs(goalY - spawn.y);
  const keyCapX = spanX > 1 ? Math.max(0, screenW - 2 * padX) / spanX : Infinity;
  const keyCapY = spanY > 1 ? Math.max(0, screenH - 2 * padY) / spanY : Infinity;
  const keyCap = Math.min(keyCapX, keyCapY);

  const want = Math.max(minScale * PHONE_MIN_INITIAL_BOOST, bboxCover, Math.min(minTapScale, minScale * 1.45));
  const defaultScale = Math.max(minScale, Math.min(want, keyCap, minScale * PHONE_MAX_INITIAL_BOOST));
  const maxScale = Math.max(defaultScale * 1.5, Math.min(PHONE_MAX_SCALE_CAP, minScale * PHONE_MAX_ZOOM_FACTOR));

  return { minScale, defaultScale, maxScale, playable };
}

/** Places the HUD tray / horn neatly at a fixed phone camera fit (never alters scale or offset). */
function arrangeDockAtFit(dock: HudDock, fit: FullBleedFit, shapes: HardShapes): HudDock {
  const cost = (r: Rect): number => {
    let n = 0;
    for (const o of hardOverlaps(shapes, fit, r)) n += o.kind === 'road' ? 0.5 : 1;
    return n;
  };
  const grow = (r: Rect): Rect => ({ x: r.x - HARD_MARGIN, y: r.y - HARD_MARGIN, w: r.w + HARD_MARGIN * 2, h: r.h + HARD_MARGIN * 2 });
  const horns: HornSpot[] = [{ horn: dock.horn, hornBox: dock.hornBox }, ...(dock.hornAlt ? [dock.hornAlt] : [])];
  let pick: { horn: HornSpot; trayX: number; c: number } | null = null;
  for (const horn of horns) {
    const hb = horn.hornBox;
    const sameRow = hb.y < dock.tray.y + dock.tray.h && hb.y + hb.h > dock.tray.y && hb.x > dock.tray.x;
    const trayHi = sameRow ? Math.min(dock.trayRange[1], hb.x - dock.gap - dock.tray.w) : dock.trayRange[1];
    if (trayHi < dock.trayRange[0]) continue;
    const tx = slideX(shapes, fit, dock.tray, dock.trayRange[0], trayHi);
    const trayX = tx ?? Math.min(trayHi, Math.max(dock.trayRange[0], dock.tray.x));
    const hc = cost(grow(hb)) + (tx === null ? cost(grow({ ...dock.tray, x: trayX })) : 0);
    if (!pick || hc < pick.c) pick = { horn, trayX, c: hc };
    if (hc === 0) break;
  }
  if (!pick) return dock;
  return { ...dock, horn: pick.horn.horn, hornBox: pick.horn.hornBox, tray: { ...dock.tray, x: pick.trayX } };
}

/**
 * Default phone camera fit: zooms in to frame the playable area, centres on it (nudged minimally
 * within the strict painting bounds so both the first spawn and castle are visible), never zooms
 * out to clear HUD plots, and never opens mirrored/repeated bands.
 */
export function phoneCameraFit(
  screenW: number,
  screenH: number,
  layout: Level2DLayout,
  dockFor: (mode: 'row' | 'pouch') => HudDock,
  shapes: HardShapes,
  firstSpawnPx?: { readonly x: number; readonly y: number },
): PhoneCameraFitResult {
  const [iw, ih] = layout.imageSize;
  const k = layout.pxPerUnit;
  const spawn = firstSpawnPx ?? firstSpawnPointPx(layout);
  const goalX = Math.max(0, Math.min(iw, layout.goal.x * k + iw / 2));
  const goalY = Math.max(0, Math.min(ih, layout.goal.z * k + ih / 2));
  const limits = phoneCameraLimits(screenW, screenH, layout, spawn);
  const scale = limits.defaultScale;
  const pan = strictPanRange(screenW, screenH, iw, ih, scale);

  const cx = limits.playable.x + limits.playable.w / 2;
  const cy = limits.playable.y + limits.playable.h / 2;
  const centred = clampPan(pan, screenW / 2 - cx * scale, screenH / 2 - cy * scale);
  let ox = centred.x;
  let oy = centred.y;

  // Minimally nudge within the strict pan range so both the first spawn and castle are visible.
  const padX = Math.min(44, screenW * 0.06);
  const padY = Math.min(36, screenH * 0.08);
  const loX = Math.max(pan.minX, padX - Math.min(spawn.x, goalX) * scale);
  const hiX = Math.min(pan.maxX, screenW - padX - Math.max(spawn.x, goalX) * scale);
  if (loX <= hiX) ox = Math.min(hiX, Math.max(loX, ox));

  const loY = Math.max(pan.minY, padY - Math.min(spawn.y, goalY) * scale);
  const hiY = Math.min(pan.maxY, screenH - padY - Math.max(spawn.y, goalY) * scale);
  if (loY <= hiY) oy = Math.min(hiY, Math.max(loY, oy));

  const baseFit = fitAt(screenW, screenH, iw, ih, scale, ox, oy);
  const baseFullFit: FullBleedFit = {
    ...baseFit,
    shrink: scale / limits.minScale,
    coverage: coverageOf(screenW, screenH, baseFit),
    clear: false,
    clearButInfo: false,
  };

  const rowDock = arrangeDockAtFit(dockFor('row'), baseFullFit, shapes);
  let dock = rowDock;
  if (rowDock.items.n > 0 && rowDock.items.mode !== 'pouch') {
    const pouchDock = arrangeDockAtFit(dockFor('pouch'), baseFullFit, shapes);
    const rowRes: FullBleedResult = { fit: baseFullFit, dock: rowDock, pan };
    const pouchRes: FullBleedResult = { fit: baseFullFit, dock: pouchDock, pan };
    if (dockCost(shapes, rowRes) > dockCost(shapes, pouchRes)) dock = pouchDock;
  }

  const pieces = dockPieces(dock);
  const anyHard = Object.values(pieces).some((r) => hardOverlaps(shapes, baseFit, r, true).length > 0);
  const anyNonInfo = Object.entries(pieces).some(([key, r]) => key !== 'info' && hardOverlaps(shapes, baseFit, r, true).length > 0);
  const fit: FullBleedFit = {
    ...baseFullFit,
    clear: !anyHard,
    clearButInfo: !anyNonInfo,
  };

  return { fit, dock, pan, limits };
}

/**
 * Pure pinch-zoom + two-finger pan step: zooms by `scaleRatio` (clamped to `[minScale, maxScale]`)
 * keeping the map point under `(fromMidX, fromMidY)` locked to `(toMidX, toMidY)`, then clamps
 * strictly inside the painted map so no edge outside the painting is ever exposed.
 */
export function pinchStep(
  state: PhoneCameraState,
  fromMidX: number,
  fromMidY: number,
  toMidX: number,
  toMidY: number,
  scaleRatio: number,
  screenW: number,
  screenH: number,
  imageW: number,
  imageH: number,
  limits: Pick<PhoneCameraLimits, 'minScale' | 'maxScale'>,
): PhoneCameraState {
  const safeRatio = Number.isFinite(scaleRatio) && scaleRatio > 0 ? scaleRatio : 1;
  const nextScale = clampZoom(state.scale * safeRatio, limits);
  const imgX = (fromMidX - state.offsetX) / state.scale;
  const imgY = (fromMidY - state.offsetY) / state.scale;
  const rawX = toMidX - imgX * nextScale;
  const rawY = toMidY - imgY * nextScale;
  const clamped = clampPhonePan(screenW, screenH, imageW, imageH, nextScale, rawX, rawY);
  return { scale: nextScale, offsetX: clamped.x, offsetY: clamped.y };
}
