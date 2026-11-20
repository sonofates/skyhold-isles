#!/usr/bin/python3
"""Register the four painted crowns on a fixed foundation and pack the full-body attack sheets."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'design/art-2d/specializations'
OUT = ROOT / 'public/art2d/specializations'
sys.dont_write_bytecode = True
sys.path[:0] = [str(ROOT / 'design/art-2d'), str(ROOT / 'tools/map-compose')]
from key import key_image
from ringfit import measure_ring


def windmill_turn(crown, rotor):
    """Rotate the painted sails around their hub while the axle stand stays on the roof."""
    stand_mask = Image.new('L', crown.size)
    ImageDraw.Draw(stand_mask).polygon([tuple(p) for p in rotor['stand']], fill=255)
    clear = Image.new('RGBA', crown.size)
    stand = Image.composite(crown, clear, stand_mask)
    sails = Image.composite(clear, crown, stand_mask)
    frames = [crown]
    for frame in range(1, 7):
        wheel = sails.rotate(-90 * frame / 7, Image.Resampling.BICUBIC, center=tuple(rotor['hub']))
        frames.append(Image.alpha_composite(stand, wheel))
    return frames + [crown]


def pack(name, marks):
    atlas = Image.open(ART / f'{name}-atlas.webp')
    cell = atlas.width // 3
    assert atlas.size == (3 * cell, 2 * cell)
    parts = []
    for i in range(5):
        x, y = i % 3 * cell, i // 3 * cell
        parts.append(key_image(atlas.crop((x, y, x + cell, y + cell)), trim=False))

    # The socket never moves. Stretch only the crown about its painted brass foot.
    canvas_size = (cell, 2 * cell)
    socket_x, socket_y = marks['socket']
    socket_y += cell
    poses = [(0, 1), (0, 0.975), (1, 0.96), (2, 1), (2, 0.985), (3, 0.96), (3, 0.985), (0, 1)]
    feet = marks['feet']
    crowns = parts[1:]
    if 'rotor' in marks:
        crowns = windmill_turn(crowns[0], marks['rotor'])
        feet = [feet[0]] * len(crowns)
        poses = [(i, 1) for i in range(len(crowns))]
    elif marks.get('rigid'):
        poses = [(pose, 1) for pose, _ in poses]
    frames = []
    for i, (pose, stretch) in enumerate(poses):
        frame = Image.new('RGBA', canvas_size)
        frame.alpha_composite(parts[0], (0, cell))
        scale = marks['scale']
        w, h = round(cell * scale), round(cell * scale * stretch)
        foot_x, foot_y = feet[pose]
        x = socket_x - round(foot_x * w / cell)
        y = socket_y - round(foot_y * h / cell)
        crown = crowns[pose].resize((w, h), Image.Resampling.LANCZOS)
        frame.alpha_composite(crown, (x, y))
        if i == 3:
            mx, my = marks['releaseTip']
            muzzle = (x + mx * w / cell, y + my * h / cell)
        frames.append(frame)

    boxes = [f.getbbox() for f in frames]
    crop = (min(b[0] for b in boxes) - 6, min(b[1] for b in boxes) - 6,
            max(b[2] for b in boxes) + 6, max(b[3] for b in boxes) + 6)
    frames = [f.crop(crop) for f in frames]
    portrait = frames[0].copy()
    portrait.thumbnail((512, 512), Image.Resampling.LANCZOS)
    portrait.save(OUT / f'{name}.webp', quality=92, method=6)
    w, h = frames[0].size
    # Leave clear texels between neighboring atlas cells even after Lanczos filtering.
    pad = 4
    inner_h = 256 - 2 * pad
    size = (round(w * inner_h / h), inner_h)
    muzzle = [round(pad + (pos - origin) * side / old, 2)
              for pos, origin, side, old in zip(muzzle, crop[:2], size, (w, h))]
    frames = [ImageOps.expand(f.resize(size, Image.Resampling.LANCZOS), pad) for f in frames]
    w, h = frames[0].size
    ring = measure_ring(frames[0])
    sheet = Image.new('RGBA', (4 * w, 2 * h))
    for i, frame in enumerate(frames):
        assert measure_ring(frame) == ring
        sheet.paste(frame, ((i % 4) * w, (i // 4) * h))
    sheet.save(OUT / f'{name}-attack.webp', lossless=True, method=6)
    meta = dict(image=f'{name}-attack.webp', frameW=w, frameH=h, count=len(frames),
                cols=4, fps=12, release=3, anchor=[ring['ringCenterXPx'], ring['ringBottomPx']],
                ringW=ring['ringWidthPx'], muzzlePx=muzzle)
    (OUT / f'{name}-attack.json').write_text(json.dumps(meta, indent=1) + '\n')


if __name__ == '__main__':
    for family in ('frost', 'tesla', 'mortar', 'beacon'):
        for branch, registration in json.loads((ART / f'{family}.json').read_text()).items():
            pack(branch, registration)
