#!/usr/bin/python3
"""Pack painted tower mechanisms on a fixed foundation into full-body animation sheets."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageOps

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


def gate_frames(atlas, marks):
    """Move the portcullis behind its lintel or swing the timber leaves into the doorway."""
    split = marks['splitX']
    body = key_image(atlas.crop((0, 0, split, atlas.height)), trim=False)
    panel = key_image(atlas.crop((split, 0, atlas.width, atlas.height)), trim=False)
    x, y, right, bottom = marks['doorway']
    width, height = right - x, bottom - y
    # Fit the upper floors to the family's map silhouette while keeping the sill and plinth intact.
    roof_height = round(y * marks['upperScale'])
    fitted = Image.new('RGBA', (body.width, body.height - y + roof_height))
    fitted.paste(body.crop((0, 0, body.width, y)).resize((body.width, roof_height), Image.Resampling.LANCZOS))
    fitted.paste(body.crop((0, y, body.width, body.height)), (0, roof_height))
    body = fitted
    y, bottom = roof_height, roof_height + height
    panel = panel.crop(panel.getbbox()).resize((width, height), Image.Resampling.LANCZOS)
    frames = []
    for opening in (0, 0.25, 0.7, 1, 1, 0.76, 0.35, 0):
        frame = body.copy()
        if marks['motion'] == 'lift':
            lift = round(height * 0.96 * opening)
            frame.alpha_composite(panel.crop((0, lift, width, height)), (x, y))
        else:
            # The outer hinges stay put. The free edge recedes up into the shaded hall.
            for left, end in ((0, width // 2), (width // 2, width)):
                leaf = panel.crop((left, 0, end, height))
                shown = max(1, round(leaf.width * (1 - 0.90 * opening)))
                leaf = leaf.resize((shown, height), Image.Resampling.LANCZOS)
                leaf = ImageEnhance.Brightness(leaf).enhance(1 - 0.46 * opening)
                rise = height * 0.10 * opening
                slope = rise / shown
                transform = (1, 0, 0, slope if left == 0 else -slope, 1, 0 if left == 0 else rise)
                leaf = leaf.transform(leaf.size, Image.Transform.AFFINE, transform, Image.Resampling.BICUBIC)
                frame.alpha_composite(leaf, (x if left == 0 else right - shown, y))
        frames.append(frame)
    return frames, ((x + right) / 2, bottom)


def crown_frames(atlas, marks):
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
    return frames, muzzle


def pack(name, marks):
    atlas = Image.open(ART / f'{name}-atlas.webp')
    frames, muzzle = gate_frames(atlas, marks) if 'doorway' in marks else crown_frames(atlas, marks)
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
    for family in sys.argv[1:] or ('frost', 'tesla', 'mortar', 'beacon', 'barracks'):
        for branch, registration in json.loads((ART / f'{family}.json').read_text()).items():
            pack(branch, registration)
