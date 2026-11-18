#!/usr/bin/python3
"""Keys the Codex gate / decal renders (flat #FF00FF) into map-compose inputs.

usage: /usr/bin/python3 tools/map-compose/prep_gates.py <raw_dir> <assets_dir>

  raw/cave-*.png, raw/castle-*.png  → assets/gate-<name>.png (keyed, trimmed, longest side <= 1024)
  raw/decals-sheet.png              → assets/decal-1..8.png (a 4 x 2 grid of separate items)

Keying = design/art-2d/key.py (magenta-ness = min(r, b) - g; soft edge + de-spill), vectorised.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

MAX_SIDE = 1024


def key_image(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert('RGBA')).astype(np.int32)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    m = np.minimum(r, b) - g
    full = (m > 90) & (r > 120) & (b > 120)
    soft = ~full & (m > 35) & (r > 90) & (b > 90)
    spill = ~full & ~soft & (m > 15) & (r > 80) & (b > 80)
    out = a.copy()
    t = np.clip((m - 35) / 55.0, 0, 1)
    out[..., 3] = np.where(full, 0, np.where(soft, (al * (1 - t)).astype(np.int32), al))
    out[..., 0] = np.where(soft, np.minimum(r, g + ((r - g) * 0.35).astype(np.int32)), np.where(spill, np.minimum(r, g + 20), r))
    out[..., 2] = np.where(soft, np.minimum(b, g + ((b - g) * 0.35).astype(np.int32)), np.where(spill, np.minimum(b, g + 20), b))
    out[full] = 0
    res = Image.fromarray(out.clip(0, 255).astype(np.uint8), 'RGBA')
    bbox = res.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        l, tp, rr, bb = bbox
        res = res.crop((max(0, l - 6), max(0, tp - 6), min(res.width, rr + 6), min(res.height, bb + 6)))
    return res


def cap(im: Image.Image, side: int) -> Image.Image:
    s = side / max(im.size)
    if s < 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im


def main() -> None:
    raw, assets = Path(sys.argv[1]), Path(sys.argv[2])
    for p in sorted(raw.glob('*.png')):
        if p.name.startswith(('cave-', 'castle-')):
            out = cap(key_image(Image.open(p)), MAX_SIDE)
            out.save(assets / f'gate-{p.name}', optimize=True)
            print('gate ', p.name, out.size)
    sheet = raw / 'decals-sheet.png'
    if sheet.exists():
        im = Image.open(sheet)
        cw, ch = im.width // 4, im.height // 2
        k = 0
        for row in range(2):
            for col in range(4):
                k += 1
                cell = key_image(im.crop((col * cw, row * ch, (col + 1) * cw, (row + 1) * ch)))
                cell.save(assets / f'decal-{k}.png', optimize=True)
                print('decal', k, cell.size)


if __name__ == '__main__':
    main()
