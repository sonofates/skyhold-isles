"""Crisp ground for map-compose: fine painted detail on the calm tiled ground, a crisp painted road
edge (ragged contour, thin dark rim, grass fringe, pebbles) and sparse hand-painted decals
(grass tufts, clover, tiny flowers, pebbles: assets/decal-1..8.png, keyed Codex art).

The look stays calm: detail is low contrast and sparse; nothing here adds new colours.
All sizes are given in output px by the caller (they scale with the bake width).
"""
import math
import random

import numpy as np
from PIL import Image, ImageFilter

# decal-1..8: 1-4 grass (tuft, low tuft, clover, tall blades), 5 flowers, 6 pebbles, 7 mossy stone, 8 yellow flowers
TUFTS = (1, 2, 4)
CLOVER = (3,)
FLOWERS = (5, 8)
STONES = (6, 7)


def fine_detail(base: Image.Image, tex: Image.Image, tile_px: int, amount: float, radius: float) -> Image.Image:
    """Adds the high-pass of a finer tiling of `tex` (luminance only) to `base`: brush-stroke detail
    at a smaller scale, without changing the colours or the large-scale calm."""
    W, H = base.size
    t = tex.convert('L').resize((tile_px, tile_px), Image.LANCZOS)
    fine = Image.new('L', (W, H))
    for y in range(0, H, tile_px):
        for x in range(0, W, tile_px):
            fine.paste(t, (x, y))
    f = np.asarray(fine).astype(np.float32)
    lo = np.asarray(fine.filter(ImageFilter.GaussianBlur(radius))).astype(np.float32)
    hp = (f - lo) * amount
    b = np.asarray(base.convert('RGB')).astype(np.float32)
    out = b + hp[..., None]
    return Image.fromarray(out.clip(0, 255).astype(np.uint8)).convert('RGBA')


def value_noise(w, h, cell, seed):
    rnd = random.Random(seed)
    gw, gh = w // cell + 2, h // cell + 2
    small = Image.new('L', (gw, gh))
    small.putdata([rnd.randint(0, 255) for _ in range(gw * gh)])
    return small.resize((w, h), Image.BICUBIC)


def ragged_mask(hard: Image.Image, soft_r: float, cell: int, amp: float, seed: int, aa: float = 0.9) -> Image.Image:
    """A crisp, slightly irregular (painted) version of a hard mask: blur, perturb the 50% level
    with value noise, re-threshold with a ~1-2 px anti-aliased step."""
    W, H = hard.size
    soft = np.asarray(hard.filter(ImageFilter.GaussianBlur(soft_r))).astype(np.float32) / 255
    n = np.asarray(value_noise(W, H, cell, seed)).astype(np.float32) / 255 - 0.5
    n2 = np.asarray(value_noise(W, H, max(2, cell // 3), seed + 1)).astype(np.float32) / 255 - 0.5
    v = soft + (n * 0.7 + n2 * 0.3) * amp
    # soft is a ramp of width ~ 2.5 * soft_r px across the edge: map +-step to a ~aa px wide AA band
    step = aa / (2.5 * soft_r)
    m = np.clip((v - 0.5) / (2 * step) + 0.5, 0, 1)
    return Image.fromarray((m * 255).astype(np.uint8), 'L')


def ring(mask: Image.Image, grow: int, blur: float) -> Image.Image:
    """Band just outside `mask`, `grow` px wide, lightly blurred."""
    g = mask.filter(ImageFilter.MaxFilter(2 * grow + 1))
    a = np.asarray(g).astype(np.int16) - np.asarray(mask).astype(np.int16)
    return Image.fromarray(a.clip(0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(blur))


def inner_band(mask: Image.Image, shrink: int, blur: float) -> Image.Image:
    e = mask.filter(ImageFilter.MinFilter(2 * shrink + 1)).filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(mask).astype(np.int16) - np.asarray(e).astype(np.int16)
    return Image.fromarray(a.clip(0, 255).astype(np.uint8), 'L')


def tint_paste(canvas: Image.Image, im: Image.Image, x: float, y_bottom: float, alpha=1.0):
    if alpha < 1:
        a = im.getchannel('A').point(lambda v: int(v * alpha))
        im = im.copy()
        im.putalpha(a)
    canvas.alpha_composite(im, (round(x - im.width / 2), round(y_bottom - im.height)))


class Decals:
    def __init__(self, load):
        self.src = {k: load(f'decal-{k}.png') for k in range(1, 9)}
        self.ok = all(v is not None for v in self.src.values())
        self.cache = {}

    def get(self, k, height_px, flip):
        key = (k, round(height_px * 2) / 2, flip)
        if key not in self.cache:
            im = self.src[k]
            s = height_px / im.height
            im = im.resize((max(1, round(im.width * s)), max(1, round(height_px))), Image.LANCZOS)
            if flip:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            self.cache[key] = im
        return self.cache[key]


def nearest_dist(points: np.ndarray, qx: float, qy: float) -> float:
    d = (points[:, 0] - qx) ** 2 + (points[:, 1] - qy) ** 2
    return float(np.sqrt(d.min()))


def road_fringe(canvas, decals: Decals, edge_polys, road_pts, half_w, S, seed):
    """Grass tufts overlapping the road edge (both sides) and sparse pebbles on the road near it.
    edge_polys: road centrelines (layout px, densely resampled); road_pts: numpy (N, 2) layout px."""
    rnd = random.Random(seed)
    placed = []
    pebbles = []
    for poly in edge_polys:
        for i in range(1, len(poly) - 1, 1):
            (ax, ay), (bx, by) = poly[i - 1], poly[i + 1]
            seg = math.hypot(bx - ax, by - ay) or 1
            nx, ny = -(by - ay) / seg, (bx - ax) / seg
            for side in (-1, 1):
                if rnd.random() > 0.20:
                    continue
                off = half_w + rnd.uniform(-1.5, 2.5)
                x, y = poly[i][0] + nx * off * side, poly[i][1] + ny * off * side
                # only real edges (not inside another stretch of road at merges / tight bends)
                if nearest_dist(road_pts, x, y) < half_w - 3:
                    continue
                if any((x - px) ** 2 + (y - py) ** 2 < 14 ** 2 for px, py in placed[-12:]):
                    continue
                placed.append((x, y))
                k = rnd.choice(TUFTS + TUFTS + CLOVER)
                h = rnd.uniform(7.0, 11.5) * (0.8 if k == 3 else 1.0)
                tint_paste(canvas, decals.get(k, h * S, rnd.random() < 0.5), x * S, (y + h * 0.35) * S, alpha=0.95)
                if rnd.random() < 0.10:
                    # a pebble on the road next to it
                    po = half_w - rnd.uniform(5, 11)
                    pebbles.append((poly[i][0] + nx * po * side, poly[i][1] + ny * po * side))
    for x, y in pebbles:
        if nearest_dist(road_pts, x, y) > half_w - 3:
            continue
        k = rnd.choice(STONES)
        h = rnd.uniform(4.0, 6.0) if k == 6 else rnd.uniform(4.5, 6.5)
        tint_paste(canvas, decals.get(k, h * S, rnd.random() < 0.5), x * S, (y + h * 0.5) * S, alpha=0.9)
    return len(placed), len(pebbles)


def scatter(canvas, decals: Decals, iw, ih, ok_at, S, seed, n=260):
    """Sparse decals in small clusters on the grass. ok_at(x, y, r) -> bool (layout px)."""
    rnd = random.Random(seed)
    count = {'tuft': 0, 'flower': 0, 'stone': 0}
    tries = 0
    centres = []
    while sum(count.values()) < n and tries < 6000:
        tries += 1
        cx, cy = rnd.uniform(20, iw - 20), rnd.uniform(20, ih - 20)
        if any((cx - x) ** 2 + (cy - y) ** 2 < 70 ** 2 for x, y in centres):
            continue
        kind = rnd.choices(['tuft', 'flower', 'stone'], [0.72, 0.14, 0.14])[0]
        group = rnd.randint(1, 3) if kind != 'tuft' else rnd.randint(2, 4)
        if not ok_at(cx, cy, 16):
            continue
        centres.append((cx, cy))
        for _ in range(group):
            x, y = cx + rnd.gauss(0, 9), cy + rnd.gauss(0, 6)
            if not ok_at(x, y, 10):
                continue
            if kind == 'tuft':
                k = rnd.choice(TUFTS + TUFTS + CLOVER)
                h = rnd.uniform(8, 13)
            elif kind == 'flower':
                k = rnd.choice(FLOWERS)
                h = rnd.uniform(7, 10)
            else:
                k = rnd.choice(STONES)
                h = rnd.uniform(5, 8)
            tint_paste(canvas, decals.get(k, h * S, rnd.random() < 0.5), x * S, (y + h * 0.4) * S, alpha=0.92)
            count[kind] += 1
    return count
