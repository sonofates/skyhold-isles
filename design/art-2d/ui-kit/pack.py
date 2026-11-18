#!/usr/bin/python3
"""UI kit: raw Codex image_gen output (flat #FF00FF) → keyed, trimmed WebP in public/art2d/ui/.

usage: /usr/bin/python3 design/art-2d/ui-kit/pack.py   (from the repo root)

Keying is the same magenta un-mix as design/art-2d/key.py. Paired pieces are DERIVED from one
master so they register exactly: medallion-hi (glow + brighter rim) from the medallion, the empty
star socket from the full star, the defeat board (crimson ribbon, dimmer parchment) from the
victory board. Prints the packed sizes; the HUD plaque number slots and the end-panel parchment
fractions are measured by eye from the packed WebP and live in src/render2d/uiLayout.ts
(KIT_PLAQUE_SLOTS, END_FRAME) — re-measure them if the art is regenerated.
"""
import colorsys
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / 'design/art-2d/ui-kit/raw'
OUT = ROOT / 'public/art2d/ui'
OUT.mkdir(parents=True, exist_ok=True)


def key_image(im: Image.Image, margin: int = 6) -> Image.Image:
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            m = min(r, b) - g
            if m > 90 and r > 120 and b > 120:
                px[x, y] = (0, 0, 0, 0)
            elif m > 35 and r > 90 and b > 90:
                t = (m - 35) / 55.0
                na = int(a * (1 - t))
                nr = min(r, g + int((r - g) * 0.35))
                nb = min(b, g + int((b - g) * 0.35))
                px[x, y] = (nr, g, nb, na)
            elif m > 15 and r > 80 and b > 80:
                px[x, y] = (min(r, g + 20), g, min(b, g + 20), a)
    bbox = im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    if bbox:
        l, t, r, b = bbox
        im = im.crop((max(0, l - margin), max(0, t - margin), min(w, r + margin), min(h, b + margin)))
    return im


def cap(im: Image.Image, longest: int) -> Image.Image:
    s = longest / max(im.size)
    if s < 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    return im


def pad(im: Image.Image, frac: float) -> Image.Image:
    p = round(max(im.size) * frac)
    out = Image.new('RGBA', (im.width + 2 * p, im.height + 2 * p), (0, 0, 0, 0))
    out.alpha_composite(im, (p, p))
    return out


def square(im: Image.Image) -> Image.Image:
    s = max(im.size)
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    out.alpha_composite(im, ((s - im.width) // 2, (s - im.height) // 2))
    return out


def save(im: Image.Image, name: str) -> None:
    im.save(OUT / f'{name}.webp', 'WEBP', quality=90, method=6)
    print('wrote', name, im.size)


def glow(im: Image.Image, color, radius: float, strength: float) -> Image.Image:
    a = im.getchannel('A').filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(radius))
    a = a.point(lambda v: min(255, int(v * strength)))
    layer = Image.new('RGBA', im.size, color + (0,))
    layer.putalpha(a)
    layer.alpha_composite(im)
    return layer


def recolor_ribbon(im: Image.Image) -> Image.Image:
    """Blue cloth → muted crimson, gold trim → tarnished; parchment slightly dimmer (defeat board)."""
    im = im.copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 0.53 < h < 0.75 and s > 0.25:  # blue cloth
                nr, ng, nb = colorsys.hsv_to_rgb(0.995, min(1, s * 0.85), v * 0.82)
                px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
            elif 0.06 < h < 0.17 and s > 0.62 and v > 0.45:  # gold trim (parchment s < 0.5)
                nr, ng, nb = colorsys.hsv_to_rgb(h, s * 0.45, v * 0.78)
                px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
            else:
                px[x, y] = (int(r * 0.93), int(g * 0.9), int(b * 0.88), a)
    return im


def main() -> None:
    meta = {}
    medal = key_image(Image.open(RAW / 'ui-medallion.png'))
    medal = cap(square(medal), 360)
    medal_p = pad(medal, 0.08)
    save(medal_p, 'medallion')
    hi = ImageEnhance.Brightness(medal).enhance(1.1)
    hi = ImageEnhance.Color(hi).enhance(1.15)
    hi = glow(pad(hi, 0.08), (255, 214, 96), radius=10, strength=2.2)
    save(hi, 'medallion-hi')
    meta['medallionPad'] = round((medal_p.width - medal.width) / 2 / medal_p.width, 4)

    btn = key_image(Image.open(RAW / 'ui-button-round.png'))
    save(cap(square(btn), 300), 'button-round')

    save(cap(key_image(Image.open(RAW / 'ui-pricetag.png')), 360), 'price-tag')
    save(cap(key_image(Image.open(RAW / 'ui-tooltip.png'), margin=2), 640), 'tooltip')

    for name in ['confirm', 'upgrade', 'sell', 'rally', 'target']:
        save(cap(square(key_image(Image.open(RAW / f'icon-{name}.png'))), 224), f'icon-{name}')

    star = cap(square(key_image(Image.open(RAW / 'icon-star.png'))), 256)
    save(star, 'star')
    # Empty socket from the same silhouette: dark bronze, flat, recessed.
    lum = star.convert('L')
    lum = ImageEnhance.Contrast(lum).enhance(0.55)
    empty = Image.merge('RGB', [lum.point(lambda v: int(40 + v * 0.36)), lum.point(lambda v: int(26 + v * 0.24)), lum.point(lambda v: int(14 + v * 0.14))]).convert('RGBA')
    empty.putalpha(star.getchannel('A'))
    save(empty, 'star-empty')

    board = cap(key_image(Image.open(RAW / 'ui-endpanel.png'), margin=4), 1024)
    save(board, 'end-panel')
    save(recolor_ribbon(board), 'end-panel-defeat')

    plaque = cap(key_image(Image.open(RAW / 'ui-hud-plaque.png'), margin=3), 1024)
    save(plaque, 'hud-plaque')
    meta['plaqueSize'] = plaque.size
    meta['boardSize'] = board.size
    print(json.dumps(meta))


if __name__ == '__main__':
    main()
