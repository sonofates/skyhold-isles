#!/usr/bin/python3
"""Magenta chroma key → trimmed transparent PNGs.

usage: /usr/bin/python3 key.py raw out
Removes #FF00FF-ish background with a soft edge, de-spills magenta fringes, trims to content
(+8 px margin) and writes out/<name>.png. map-*.png files are copied (resized to 1920 wide).
"""
import sys
from pathlib import Path
from PIL import Image

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)


def key_image(im: Image.Image) -> Image.Image:
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            # "magenta-ness": strong red+blue, weak green
            m = min(r, b) - g
            if m > 90 and r > 120 and b > 120:
                px[x, y] = (0, 0, 0, 0)
            elif m > 35 and r > 90 and b > 90:
                # soft edge: fade alpha and pull the colour away from magenta
                t = (m - 35) / 55.0
                na = int(a * (1 - t))
                nr = min(r, g + int((r - g) * 0.35))
                nb = min(b, g + int((b - g) * 0.35))
                px[x, y] = (nr, g, nb, na)
            elif m > 15 and r > 80 and b > 80:
                # faint spill on the outline
                px[x, y] = (min(r, g + 20), g, min(b, g + 20), a)
    bbox = im.getbbox()
    if bbox:
        l, t, r, b = bbox
        im = im.crop((max(0, l - 8), max(0, t - 8), min(w, r + 8), min(h, b + 8)))
    return im


for p in sorted(src.glob('*.png')):
    im = Image.open(p)
    if p.name.startswith('map-'):
        im = im.convert('RGB')
        if im.width > 1920:
            im = im.resize((1920, round(im.height * 1920 / im.width)), Image.LANCZOS)
        im.save(dst / p.name, optimize=True)
        print('map ', p.name, im.size)
        continue
    out = key_image(im)
    # sprites: cap the longest side at 512 px (plenty for 1080p play)
    s = 512 / max(out.size)
    if s < 1:
        out = out.resize((round(out.width * s), round(out.height * s)), Image.LANCZOS)
    out.save(dst / p.name, optimize=True)
    print('keyed', p.name, out.size)
