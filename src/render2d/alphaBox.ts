/**
 * Feet anchor of a painted sprite: bottom-centre of the alpha bounding box, normalised to the
 * canvas (pure; used to align leg-swap frames whose canvases differ slightly).
 */
export function alphaFeetAnchor(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  threshold = 24,
): [number, number] {
  let minX = width;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        maxY = y;
      }
    }
  }
  if (maxX < 0) return [0.5, 1];
  return [(minX + maxX + 1) / 2 / width, (maxY + 1) / height];
}
