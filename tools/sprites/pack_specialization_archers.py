#!/usr/bin/python3
"""Pack the painted archer lodge atlases and their measured feet and arrow tips."""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'design/art-2d/specializations'
OUT = ROOT / 'public/art2d/specializations'
sys.dont_write_bytecode = True
sys.path[:0] = [str(ROOT / 'design/art-2d'), str(ROOT / 'tools/map-compose')]
from key import key_image
from ringfit import measure_ring


def pack(name, marks):
    atlas = Image.open(ART / f'{name}-atlas.webp')
    cell = atlas.width // 3
    assert atlas.size == (3 * cell, 2 * cell)
    images = []
    for i in range(6):
        x, y = (i % 3) * cell, (i // 3) * cell
        images.append(key_image(atlas.crop((x, y, x + cell, y + cell)), trim=False))

    body = images[0]
    mount = marks['mount']
    body.save(OUT / f'{name}-body.webp', quality=92, method=6)

    # Work on an oversized registration canvas. All feet, in all facings, stay fixed
    # relative to its pivot. Only the foreground ranger supplies the release point.
    origin = (cell, cell)
    frames, tips = [], []
    for image, foot, tip in zip(images[1:], marks['feet'], marks['tips'], strict=True):
        frame = Image.new('RGBA', (cell * 2, cell * 2))
        for dx, dy, scale in marks['operators']:
            piece = image.resize((round(cell * scale), round(cell * scale)), Image.Resampling.LANCZOS)
            x = round(origin[0] + dx - foot[0] * scale)
            y = round(origin[1] + dy - foot[1] * scale)
            frame.alpha_composite(piece, (x, y))
        frames.append(frame)
        tips.append([round(x + tip[0] * scale - origin[0], 2),
                     round(y + tip[1] * scale - origin[1], 2)])

    boxes = [f.getbbox() for f in frames]
    half = max(max(origin[0] - b[0], b[2] - origin[0]) for b in boxes) + 4
    top, bottom = min(b[1] for b in boxes) - 4, max(b[3] for b in boxes) + 4
    crop = (origin[0] - half, top, origin[0] + half, bottom)
    frames = [f.crop(crop) for f in frames]
    w, h = frames[0].size
    pivot = [half, origin[1] - top]
    strip = Image.new('RGBA', (5 * w, h))
    for i, frame in enumerate(frames):
        strip.alpha_composite(frame, (i * w, 0))
    strip.save(OUT / f'{name}-turret.webp', quality=92, method=6)

    meta = dict(image=f'{name}-turret.webp', frameW=w, frameH=h, count=5,
                dirs=['S', 'SE', 'E', 'NE', 'N'], pivot=pivot, muzzle=tips,
                body=f'{name}-body.webp', bodyMount=mount, bodyRing=measure_ring(body), scale=1)
    (OUT / f'{name}-turret.json').write_text(json.dumps(meta, indent=1) + '\n')

    preview = Image.new('RGBA', (cell, cell + h))
    preview.alpha_composite(body, (0, h))
    preview.alpha_composite(frames[1], (mount[0] - pivot[0], h + mount[1] - pivot[1]))
    preview = preview.crop(preview.getbbox())
    preview.thumbnail((512, 512), Image.Resampling.LANCZOS)
    preview.save(OUT / f'{name}.webp', quality=92, method=6)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for branch, registration in json.loads((ART / 'archers.json').read_text()).items():
        pack(branch, registration)
