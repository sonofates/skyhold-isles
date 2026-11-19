"""Synthetic stand-ins for the painted sea sprites (QA only, loud colours so they are easy to spot).

Usage: python3 qa/seaFakeArt.py [/tmp/seafake]  then  python3 qa/withPreview.py --port=4393 node qa/seashots.mjs
--perf=0 --shots=1 --fakeart=/tmp/seafake  (seashots registers them under paintedUi.sea through Playwright routes).
"""
import json, os, math, sys
from PIL import Image, ImageDraw
D = sys.argv[1] if len(sys.argv) > 1 else '/tmp/seafake'
os.makedirs(D, exist_ok=True)

def strip(name, fw, fh, n, draw, js=True, cols=None):
    cols = cols or n
    rows = math.ceil(n / cols)
    im = Image.new('RGBA', (fw * cols, fh * rows), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for i in range(n):
        draw(d, (i % cols) * fw, (i // cols) * fh, fw, fh, i, n)
    im.save(f'{D}/{name}.png')
    if js:
        json.dump({'frameW': fw, 'frameH': fh, 'count': n, 'cols': cols, 'fps': 10, 'image': f'{name}.png'}, open(f'{D}/{name}.json', 'w'))

def gull(d, x, y, w, h, i, n):
    lift = int(math.sin(i / n * 2 * math.pi) * h * 0.3)
    d.line([(x + 4, y + h // 2 - lift), (x + w // 2, y + h // 2 + 6), (x + w - 4, y + h // 2 - lift)], fill=(200, 30, 200, 255), width=6)

def whale(d, x, y, w, h, i, n):
    hh = int(h * 0.8 * math.sin(i / (n - 1) * math.pi))
    d.polygon([(x + w // 2 - 8, y + h), (x + w // 2 - 50, y + h - hh), (x + w // 2, y + h - hh + 20), (x + w // 2 + 50, y + h - hh), (x + w // 2 + 8, y + h)], fill=(200, 30, 200, 255))

def foam(d, x, y, w, h, i, n):
    r = 8 + i * 4
    d.ellipse([x + w // 2 - r, y + h // 2 - r // 2, x + w // 2 + r, y + h // 2 + r // 2], outline=(255, 0, 255, 255), width=3)

def ripple(d, x, y, w, h, i, n):
    r = 10 + i * 9
    d.ellipse([x + w // 2 - r, y + h // 2 - r // 2, x + w // 2 + r, y + h // 2 + r // 2], outline=(255, 120, 0, 255), width=4)

def sail(d, x, y, w, h, i, n):
    k = int(math.sin(i / n * 2 * math.pi) * 8)
    d.polygon([(x + 55, y + 40), (x + 115 + k, y + 40), (x + 112 + k, y + 100), (x + 58, y + 100)], fill=(30, 160, 255, 255))

strip('gull', 96, 48, 4, gull, js=False)  # json saved next to it under the same name below
json.dump({'frameW': 96, 'frameH': 48, 'count': 4, 'cols': 4, 'fps': 10}, open(f'{D}/gull.json', 'w'))
strip('whale', 128, 128, 8, whale, cols=4)
strip('foam', 64, 64, 6, foam, js=False)  # no json: cut by aspect
strip('ripple', 128, 64, 6, ripple)
strip('shipSail', 160, 160, 4, sail)
for k, col in (('cloud1', (255, 140, 140, 220)), ('cloud2', (140, 255, 140, 220)), ('cloudShadow', (0, 0, 80, 140))):
    im = Image.new('RGBA', (300, 140), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse([10, 10, 290, 130], fill=col)
    im.save(f'{D}/{k}.png')
im = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
ImageDraw.Draw(im).polygon([(16, 0), (20, 12), (32, 16), (20, 20), (16, 32), (12, 20), (0, 16), (12, 12)], fill=(255, 255, 0, 255))
im.save(f'{D}/sparkle.png')
print(sorted(os.listdir(D)))
