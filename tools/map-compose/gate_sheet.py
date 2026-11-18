#!/usr/bin/python3
"""Contact sheet of every gate (caves + castle) on every island, cut from the shipped master bakes
with the gate front layers composited on top (what the game shows with no walkers).

usage: /usr/bin/python3 tools/map-compose/gate_sheet.py <out.png> [--ids l1c,i01,...] [--path]
         [--maps public/art2d] [--layouts src/data/levels2d] [--role entrance|goal] [--context] [--ref HEAD]
  --context  fixed field of view with nearby build plots for scale comparisons
  --ref      read the layouts and art directly from a git revision
  --path   draw the sim path (enemy walk line) in red over the crops
"""
from io import BytesIO
import json
import subprocess
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
revision = opt('--ref', '')
def read(path):
    if revision:
        return subprocess.check_output(['git', 'show', f'{revision}:{path}'])
    return path.read_bytes()

def rgba(path):
    return Image.open(BytesIO(read(path))).convert('RGBA')

manifest = json.loads(read(maps / 'manifest.json'))
plot = rgba(maps / 'plot-base.webp') if '--context' in args else None
TILE = 300
tiles = []
for lid in ids:
    L = json.loads(read(layouts / f'{lid}.json'))
    master = rgba(maps / manifest['maps'][L['image']])
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
        if plot is not None:
            gx, gy = L['goal'] if lane < 0 else L['paths'][lane][0]
            cw, ch = 448, 320
            left = min(max(0, gx - cw/2), L['imageSize'][0] - cw)
            top = min(max(0, gy - ch*.58), L['imageSize'][1] - ch)
            box = [left, top, left+cw, top+ch]
        c = master.crop(tuple(round(v * S) for v in box))
        ov = rgba(maps / manifest['overlays'][f['art']]).resize((round(w * S), round(h * S)), Image.LANCZOS)
        c.alpha_composite(ov, (round((x - box[0]) * S), round((y - box[1]) * S)))
        if plot is not None:
            width = round(2 * L.get('plotRadiusPx', 48) * S)
            ring = plot.resize((width, round(width * plot.height / plot.width)), Image.LANCZOS)
            for px, py in L['plots']:
                c.alpha_composite(ring, (round((px-box[0])*S-ring.width/2), round((py-box[1])*S-ring.height/2)))
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
        height = c.height if plot is not None else TILE
        tile = Image.new('RGBA', (TILE, height + 18), (30, 30, 30, 255))
        tile.alpha_composite(c, ((TILE - c.width) // 2, 18 + (height - c.height) // 2))
        ImageDraw.Draw(tile).text((4, 3), name, fill=(255, 255, 255, 255))
        tiles.append(tile)
cols = min(4 if plot is not None else 6, len(tiles))
row_height = max(t.height for t in tiles)
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGBA', (cols * TILE, rows * row_height), (20, 20, 20, 255))
for i, t in enumerate(tiles):
    sheet.alpha_composite(t, ((i % cols) * TILE, (i // cols) * row_height))
out.parent.mkdir(parents=True, exist_ok=True)
sheet.convert('RGB').save(out, quality=88)
print(out, len(tiles), 'gates')
