import type { Insets, Rect } from './uiLayout.ts';

/**
 * Device safe-area insets and the boxes of DOM HUD pieces drawn over the canvas. Pixi-free (the
 * world map reads the insets before any renderer exists; docs/handoff-perf.md). uiKit.ts
 * re-exports these for the canvas UI.
 */

let probe: HTMLDivElement | null = null;
let cachedInsets: Insets | null = null;
let insetsListenerBound = false;

/** Invalidates the cached safe-area insets (called on viewport / orientation change and in tests). */
export function invalidateSafeInsets(): void {
  cachedInsets = null;
}

/** Device safe-area insets (css px) from `env(safe-area-inset-*)`; zeros outside notched devices / tests. */
export function readSafeInsets(): Insets {
  if (typeof document === 'undefined' || !document.body) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (cachedInsets && probe?.isConnected) return cachedInsets;
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
  }
  if (!insetsListenerBound && typeof window !== 'undefined') {
    insetsListenerBound = true;
    window.addEventListener('resize', invalidateSafeInsets);
    window.addEventListener('orientationchange', invalidateSafeInsets);
    window.visualViewport?.addEventListener('resize', invalidateSafeInsets);
  }
  const cs = getComputedStyle(probe);
  const n = (v: string): number => Math.max(0, parseFloat(v) || 0);
  cachedInsets = { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
  return cachedInsets;
}

type KeepOutSource = () => Rect | null;
const keepOutSources = new Set<KeepOutSource>();
let keepOutEpoch = 0;

/** Monotonic version counter bumped whenever a HUD keep-out source is added or removed. */
export function hudKeepOutsVersion(): number {
  return keepOutEpoch;
}

/**
 * DOM pieces drawn over the Pixi canvas (the in-game Guide button and its caption) report their
 * screen box here, so canvas UI that pops up under them (the build ring, its tooltip) can stay
 * clear. Returns an unregister function.
 */
export function addHudKeepOut(source: KeepOutSource): () => void {
  keepOutSources.add(source);
  keepOutEpoch++;
  return () => {
    if (keepOutSources.delete(source)) keepOutEpoch++;
  };
}

/** Current boxes of the DOM HUD pieces (hidden ones report null and are skipped). */
export function hudKeepOuts(): Rect[] {
  const out: Rect[] = [];
  for (const src of keepOutSources) {
    const r = src();
    if (r && r.w > 0 && r.h > 0) out.push(r);
  }
  return out;
}
