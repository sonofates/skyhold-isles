/**
 * Pure helpers for the x-ray fade: which occluders (towers, trees) hide the targeted tile on
 * screen. Screen rects are in pixels; depth is distance along the camera's view direction.
 */
export interface ScreenRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function emptyRect(): ScreenRect {
  return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
}

export function growRect(r: ScreenRect, x: number, y: number): void {
  if (x < r.minX) r.minX = x;
  if (x > r.maxX) r.maxX = x;
  if (y < r.minY) r.minY = y;
  if (y > r.maxY) r.maxY = y;
}

export function rectsOverlap(a: ScreenRect, b: ScreenRect, pad = 0): boolean {
  return (
    a.minX < b.maxX + pad && a.maxX > b.minX - pad && a.minY < b.maxY + pad && a.maxY > b.minY - pad
  );
}

/** Rect shrunk toward its centre by `f` of its size on each axis (f=0.2 keeps the middle 60%). */
export function shrinkRect(r: ScreenRect, f: number): ScreenRect {
  const dx = (r.maxX - r.minX) * f;
  const dy = (r.maxY - r.minY) * f;
  return { minX: r.minX + dx, maxX: r.maxX - dx, minY: r.minY + dy, maxY: r.maxY - dy };
}

/**
 * An occluder fades when its drawn silhouette overlaps the target rect AND it is nearer to the
 * camera than the target (something behind the tile never hides it).
 */
export function occludes(
  occluderRect: ScreenRect,
  occluderDepth: number,
  targetRect: ScreenRect,
  targetDepth: number,
  depthMargin = 0.25,
): boolean {
  return occluderDepth < targetDepth - depthMargin && rectsOverlap(occluderRect, targetRect);
}
