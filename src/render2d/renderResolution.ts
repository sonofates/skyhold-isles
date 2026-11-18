/**
 * Canvas resolution for the 2D game. Desktops are capped at 2× (a 2560-wide window at 3× would be
 * ~30 M device px for no visible gain). Phones and small tablets render at their full density (up to
 * 3×) as long as the canvas stays within a device-pixel budget, so a DPR 2.6–3 phone is drawn sharp
 * instead of being upscaled 1.3–1.5× by the browser.
 */
export const PHONE_PIXEL_BUDGET = 4_200_000;

function highResolution(cssW: number, cssH: number, dpr: number, override?: number): number {
  if (override && override > 0) return Math.min(4, override);
  const d = dpr > 0 ? dpr : 1;
  const area = Math.max(1, cssW) * Math.max(1, cssH);
  const full = Math.min(d, 3);
  if (full > 2 && area * full * full <= PHONE_PIXEL_BUDGET) return full;
  // over budget: the largest density that fits the budget, never below 2× (or the device's own)
  const fit = Math.sqrt(PHONE_PIXEL_BUDGET / area);
  return Math.min(d, Math.max(2, Math.min(full, fit)));
}

export type QualityTier = 'low' | 'med' | 'high';

export function qualityOverride(value: string | null): QualityTier | null {
  return value === 'low' || value === 'med' || value === 'high' ? value : null;
}

// Used at Pixi initialization too, so an explicit tier picks the correct map bake on first load.
const initialTier = typeof location === 'undefined' ? null : qualityOverride(new URLSearchParams(location.search).get('quality'));

export function renderResolution(w: number, h: number, dpr: number, override?: number, tier: QualityTier = initialTier ?? 'high'): number {
  const high = highResolution(w, h, dpr, override);
  if (tier === 'high') return high;
  const medium = tier === 'med';
  const pixelBudget = medium ? 1_050_000 : 250_000;
  return Math.min(high, medium ? 1.5 : 0.8, Math.sqrt(pixelBudget / Math.max(1, w * h)));
}

/** Step down after two consecutive slow windows. Stay at the selected tier for this visit
 * so quiet build phases don't repeatedly raise resolution just before the next wave. */
export class AdaptiveQuality {
  tier: QualityTier;
  // One final framebuffer reduction if a sustained low-tier workload still misses 30 fps.
  resolutionScale = 1;
  private readonly locked: boolean;
  private elapsed = 0;
  private frames = 0;
  private slowWindows = 0;

  constructor(override: QualityTier | null) {
    this.tier = override ?? 'high';
    this.locked = override !== null;
  }

  observe(ms: number, visible: boolean): boolean {
    if (this.locked || this.resolutionScale < 1) return false;
    if (!visible || !Number.isFinite(ms) || ms <= 0) {
      this.elapsed = this.frames = this.slowWindows = 0;
      return false;
    }
    // A single resume/GC stall cannot fill a whole observation window.
    this.elapsed += Math.min(ms, 250);
    this.frames++;
    if (this.elapsed < 1000) return false;
    const budget = this.tier === 'low' ? 1000 / 30 : 19;
    this.slowWindows = this.elapsed / this.frames > budget ? this.slowWindows + 1 : 0;
    this.frames = this.elapsed = 0;
    if (this.slowWindows < 2) return false;
    if (this.tier === 'low') this.resolutionScale = 0.65 / 0.8;
    else this.tier = this.tier === 'high' ? 'med' : 'low';
    this.slowWindows = 0;
    return true;
  }
}
