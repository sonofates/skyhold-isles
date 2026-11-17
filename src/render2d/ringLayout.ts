/**
 * Build-ring token placement (pure). Tokens fan out in an arc above the tapped plot, or below it
 * when the plot sits in the upper part of the screen (top-row plots are under the HUD), then the
 * whole ring is shifted so every token stays inside the viewport and clear of the top HUD band.
 */
export interface RingPoint {
  x: number;
  y: number;
}

export function layoutRing(
  cx: number,
  cy: number,
  count: number,
  tokenR: number,
  screenW: number,
  screenH: number,
  topBand: number,
  out: RingPoint[],
): void {
  const radius = tokenR * 2.3;
  const below = cy - radius - tokenR < topBand + 4 || cy < screenH * 0.38;
  const spread = count <= 1 ? 0 : Math.min(2.4, 1.15 * (count - 1));
  const mid = below ? Math.PI / 2 : -Math.PI / 2;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0.5 : i / (count - 1);
    // Token 0 is always the left-most, above or below.
    const a = below ? mid + spread / 2 - spread * t : mid - spread / 2 + spread * t;
    const p = out[i] ?? (out[i] = { x: 0, y: 0 });
    p.x = cx + Math.cos(a) * radius;
    p.y = cy + Math.sin(a) * radius;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  out.length = count;
  const margin = tokenR + 6;
  const labelSpace = tokenR * 0.9; // cost label hangs under each token
  let dx = 0;
  let dy = 0;
  if (minX - margin < 0) dx = margin - minX;
  else if (maxX + margin > screenW) dx = screenW - margin - maxX;
  if (minY - margin < topBand) dy = topBand + margin - minY;
  else if (maxY + margin + labelSpace > screenH) dy = screenH - margin - labelSpace - maxY;
  for (let i = 0; i < count; i++) {
    out[i].x += dx;
    out[i].y += dy;
  }
}
