#!/usr/bin/python3
"""Contact sheet of every gate (caves + castle) on every island, cut from the shipped master bakes
with the gate front layers composited on top (what the game shows with no walkers).

usage: /usr/bin/python3 tools/map-compose/gate_sheet.py <out.png> [--ids l1c,i01,...] [--path]
         [--maps public/art2d] [--layouts src/data/levels2d] [--role entrance|goal]
  --path   draw the sim path (enemy walk line) in red over the crops
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

args = sys.argv[1:]
out = Path(args[0])


def opt(k, d):
    return args[args.index(k) + 1] if k in args else d


maps = Path(opt('--maps', 'public/art2d'))
layouts = Path(opt('--layouts', 'src/data/levels2d'))
ids = opt('--ids', 'l1c,' + ','.join(f'i{n:02d}' for n in range(1, 17))).split(',')
role = opt('--role', '')
draw_path = '--path' in args
manifest = json.loads((maps / 'manifest.json').read_text())
TILE = 300
tiles = []
for lid in ids:
    L = json.loads((layouts / f'{lid}.json').read_text())
    master = Image.open(maps / manifest['maps'][L['image']]).convert('RGBA')
    S = master.width / L['imageSize'][0]
    gates = [(f"{lid} {e['id']} {e['gate']['prop']}", e['gate'], i) for i, e in enumerate(L['entrances'])]
    gates.append((f"{lid} goal {L['goalGate']['prop']}", L['goalGate'], -1))
    for name, g, lane in gates:
        if role == 'entrance' and lane < 0 or role == 'goal' and lane >= 0:
            continue
        f = g['front']
        x, y, w, h = f['rect']
        pad = max(w, h) * 0.35
        box = [x - pad, y - pad, x + w + pad, y + h + pad]
        c = master.crop(tuple(round(v * S) for v in box))
        ov = Image.open(maps / manifest['overlays'][f['art']]).convert('RGBA').resize((round(w * S), round(h * S)), Image.LANCZOS)
        c.alpha_composite(ov, (round((x - box[0]) * S), round((y - box[1]) * S)))
        if draw_path:
            d = ImageDraw.Draw(c)
            paths = L['paths'] if lane < 0 else [L['paths'][lane]]
            for p in paths:
                pts = [((px - box[0]) * S, (py - box[1]) * S) for px, py in p]
                d.line(pts, fill=(255, 0, 0, 255), width=3)
                end = pts[-1] if lane < 0 else pts[0]
                d.ellipse((end[0] - 6, end[1] - 6, end[0] + 6, end[1] + 6), outline=(255, 255, 0, 255), width=3)
        s = TILE / max(c.width, c.height)
        c = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
        tile = Image.new('RGBA', (TILE, TILE + 18), (30, 30, 30, 255))
        tile.alpha_composite(c, ((TILE - c.width) // 2, 18 + (TILE - c.height) // 2))
        ImageDraw.Draw(tile).text((4, 3), name, fill=(255, 255, 255, 255))
        tiles.append(tile)
cols = min(6, len(tiles))
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGBA', (cols * TILE, rows * (TILE + 18)), (20, 20, 20, 255))
for i, t in enumerate(tiles):
    sheet.alpha_composite(t, ((i % cols) * TILE, (i // cols) * (TILE + 18)))
out.parent.mkdir(parents=True, exist_ok=True)
sheet.convert('RGB').save(out, quality=88)
print(out, len(tiles), 'gates')
