/**
 * Canvas resolution for the 2D game. Desktops are capped at 2× (a 2560-wide window at 3× would be
 * ~30 M device px for no visible gain). Phones and small tablets render at their full density (up to
 * 3×) as long as the canvas stays within a device-pixel budget, so a DPR 2.6–3 phone is drawn sharp
 * instead of being upscaled 1.3–1.5× by the browser.
 */
export const PHONE_PIXEL_BUDGET = 4_200_000;

export function renderResolution(cssW: number, cssH: number, dpr: number, override?: number): number {
  if (override && override > 0) return Math.min(4, override);
  const d = dpr > 0 ? dpr : 1;
  const area = Math.max(1, cssW) * Math.max(1, cssH);
  const full = Math.min(d, 3);
  if (full > 2 && area * full * full <= PHONE_PIXEL_BUDGET) return full;
  // over budget: the largest density that fits the budget, never below 2× (or the device's own)
  const fit = Math.sqrt(PHONE_PIXEL_BUDGET / area);
  return Math.min(d, Math.max(2, Math.min(full, fit)));
}
