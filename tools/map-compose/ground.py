"""Crisp ground for map-compose: fine painted detail on the calm tiled ground, a crisp painted road
edge (ragged contour, thin dark rim, grass fringe, pebbles) and sparse hand-painted decals
(grass tufts, clover, tiny flowers, pebbles: assets/decal-1..8.png, keyed Codex art).

The look stays calm: detail is low contrast and sparse; nothing here adds new colours.
All sizes are given in output px by the caller (they scale with the bake width).
"""
import math
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# decal-1..8: 1-4 grass (tuft, low tuft, clover, tall blades), 5 flowers, 6 pebbles, 7 mossy stone, 8 yellow flowers
TUFTS = (1, 2, 4)
CLOVER = (3,)
FLOWERS = (5, 8)
STONES = (6, 7)


def brushed_surface(tex, size, scale, seed):
    """Quilt unsymmetrical crops of a soil or grass wash at its original brush scale.

    Use narrow feathered overlaps between swatches. Each source crop and its
    orientation are selected in source pixels, independent of output resolution.
    """
    rnd = random.Random(seed)
    side = round(min(tex.size) * .48)
    overlap = max(2, round(side * .16))
    stride = side - overlap
    t = np.arange(side)
    ramp = np.clip((t + .5) / overlap, 0, 1)
    weight = Image.fromarray(np.uint8(255 * np.minimum.outer(ramp, ramp)))
    # Fractional resampling can leave part of a pixel at the first overlap.
    # Underpaint it with the same material so the map edges stay opaque.
    canvas = Image.new('RGBA', size, tex.getpixel((tex.width // 2, tex.height // 2)))
    for row in range(-1, math.ceil(size[1] / (stride * scale))):
        # Stagger joins so a row of edges never forms a continuous grid.
        stagger = (row % 2) * stride / 2
        for col in range(-1, math.ceil(size[0] / (stride * scale))):
            x = rnd.randint(0, tex.width - side)
            y = rnd.randint(0, tex.height - side)
            tile = tex.crop((x, y, x+side, y+side))
            if rnd.getrandbits(1):
                tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if rnd.getrandbits(1):
                tile = tile.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            left, top = col * stride + stagger, row * stride
            origin = round(left * scale), round(top * scale)
            dims = (round((left + side) * scale)-origin[0],
                    round((top + side) * scale)-origin[1])
            resized = tile.resize(dims, Image.Resampling.LANCZOS)
            # Only feather incoming (top and left) edges. The previous tile
            # supplies solid paint under the entire overlap.
            canvas.paste(resized, origin, weight.resize(dims, Image.Resampling.BILINEAR))
    return canvas


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
    channels = []
    for channel in base.convert('RGB').split():
        v = np.asarray(channel) + hp
        channels.append(Image.fromarray(v.clip(0, 255).astype(np.uint8)))
    return Image.merge('RGB', channels).convert('RGBA')


def value_noise(w, h, cell, seed, scale):
    rnd = random.Random(seed)
    gw, gh = round(w / scale) // cell + 2, round(h / scale) // cell + 2
    small = Image.new('L', (gw, gh))
    small.putdata([rnd.randint(0, 255) for _ in range(gw * gh)])
    return small.resize((w, h), Image.BICUBIC)


def ragged_mask(hard: Image.Image, soft_r: float, cell: int, amp: float, seed: int, aa: float = 0.9, noise_scale=1) -> Image.Image:
    """A crisp, slightly irregular (painted) version of a hard mask: blur, perturb the 50% level
    with value noise, re-threshold with a ~1-2 px anti-aliased step."""
    W, H = hard.size
    soft = np.asarray(hard.filter(ImageFilter.GaussianBlur(soft_r))).astype(np.float32) / 255
    n = np.asarray(value_noise(W, H, cell, seed, noise_scale)).astype(np.float32) / 255 - 0.5
    n2 = np.asarray(value_noise(W, H, max(2, cell // 3), seed + 1, noise_scale)).astype(np.float32) / 255 - 0.5
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
    def __init__(self, load, themed=False):
        self.themed = themed
        # The painted kits supply five pieces: tuft, foliage, two flowers and gravel.
        roles = (1, 1, 3, 1, 5, 6, 6, 8) if themed else range(1, 9)
        self.src = {k: load(f'decal-{role}.png') for k, role in enumerate(roles, 1)}
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
            if not self.themed and (k in TUFTS or k in CLOVER):
                # the painted tufts are a touch yellow against the meadow: pull them toward its greens
                r, g, b, a = im.split()
                im = Image.merge('RGBA', (r.point(lambda v: int(v * 0.80)), g.point(lambda v: int(v * 0.90)),
                                          b.point(lambda v: int(v * 0.78)), a))
            self.cache[key] = im
        return self.cache[key]


class DressingArea:
    """Layout-pixel clearance for the whole painted bounds of props and ground decals."""
    def __init__(self, size, paths, road_width, plots, rx, ry, structures):
        self.mask = Image.new('1', size)
        draw = ImageDraw.Draw(self.mask)
        # Include the ragged verge and rounding error at the smallest output size.
        width = math.ceil(road_width + 8)
        for path in paths:
            draw.line(path, fill=1, width=width, joint='curve')
            for x, y in (path[0], path[-1]):
                draw.ellipse((x-width/2, y-width/2, x+width/2, y+width/2), fill=1)
        for x, y in plots:
            draw.ellipse((x-rx-3, y-ry-3, x+rx+3, y+ry+3), fill=1)
        for left, top, right, bottom in structures:
            draw.rectangle((left-3, top-3, right+3, bottom+3), fill=1)

    def clear(self, rect):
        left, top, right, bottom = rect
        if left < 2 or top < 2 or right > self.mask.width-2 or bottom > self.mask.height-2:
            return False
        box = (math.floor(left), math.floor(top), math.ceil(right), math.ceil(bottom))
        return self.mask.crop(box).getbbox() is None


def paint_decal(canvas, decals, k, x, y, h, flip, scale, ok):
    # Keep the clearance decision in layout coordinates across all four texture sizes.
    src = decals.src[k]
    half = h * src.width / (2 * src.height)
    rect = (x-half, y-h/2, x+half, y+h/2)
    if not ok(rect):
        return False
    im = decals.get(k, h * scale, flip)
    tint_paste(canvas, im, x * scale, rect[3] * scale, alpha=0.92)
    return True


def road_fringe(canvas, decals, edge_polys, half_w, scale, seed, ok):
    """Short, one-sided pockets of growth separated by open stretches of verge."""
    rnd = random.Random(seed)
    count = 0
    for poly in edge_polys:  # sampled every four layout pixels
        i = rnd.randint(3, 15)
        while i < len(poly) - 1:
            side = rnd.choice((-1, 1))
            for _ in range(rnd.randint(2, 5)):
                if i >= len(poly)-1:
                    break
                ax, ay = poly[i-1]
                bx, by = poly[i+1]
                length = math.hypot(bx-ax, by-ay) or 1
                off = (half_w + rnd.uniform(10, 26)) * side
                x = poly[i][0] - (by-ay) / length * off
                y = poly[i][1] + (bx-ax) / length * off
                k = rnd.choice(TUFTS + CLOVER + STONES)
                h = rnd.uniform(5, 8) if k in STONES else rnd.uniform(7, 12)
                count += paint_decal(canvas, decals, k, x, y, h, rnd.random() < .5, scale, ok)
                i += rnd.randint(2, 5)
            i += rnd.randint(12, 34)
    return count


def scatter(canvas, decals: Decals, iw, ih, ok_at, S, seed, n=260):
    """Sparse decals in small clusters on the grass. ok_at(rect) checks the full layout-pixel footprint."""
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
        if not ok_at((cx-8, cy-6, cx+8, cy+6)):
            continue
        centres.append((cx, cy))
        for _ in range(group):
            x, y = cx + rnd.gauss(0, 9), cy + rnd.gauss(0, 6)
            if kind == 'tuft':
                k = rnd.choice(TUFTS + TUFTS + CLOVER)
                h = rnd.uniform(8, 13)
            elif kind == 'flower':
                k = rnd.choice(FLOWERS)
                h = rnd.uniform(7, 10)
            else:
                k = rnd.choice(STONES)
                h = rnd.uniform(5, 8)
            count[kind] += paint_decal(canvas, decals, k, x, y, h, rnd.random() < .5, S, ok_at)
    return count
