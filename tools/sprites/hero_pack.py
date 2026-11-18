#!/usr/bin/python3
"""Pack the hero model, icon and motion plates. Run from any directory with system Python.

The raw ImageGen PNGs live in the ignored design/art-2d/raw/hero-art directory.
The grid gutters and ground points below belong to those specific paintings.
"""
import json
import sys
from pathlib import Path
from statistics import median

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'design/art-2d'))
from key import key_image

RAW = ROOT / 'design/art-2d/raw/hero-art'
ART = ROOT / 'public/art2d'
# Branch IDs are stable art slots: passive, active one, active two.
HEROES = {
    'bran': (1.52, ('bulwark', 'shieldBash', 'rallyBanner')),
    'wren': (1.43, ('keenEye', 'volley', 'huntersMark')),
    'mira': (1.27, ('kindling', 'fireRing', 'wispBurst')),
    'tobb': (1.35, ('tinker', 'deployGizmo', 'overhaul')),
    'sela': (1.59, ('calmWaters', 'undertow', 'thunderCall')),
}
BRANCHES = ('passive', 'active1', 'active2')


def gutters(counts, n):
    """Find clear cuts close to equal slots. An extended attack can cross the nominal grid."""
    boundaries = [0]
    for i in range(1, n):
        target = round(i * len(counts) / n)
        radius = round(0.45 * len(counts) / n)
        candidates = range(target - radius, target + radius + 1)
        cut = min(candidates, key=lambda j: (counts[j], abs(j - target)))
        if counts[cut] > 2:
            raise ValueError(f'No clear gutter near {target}')
        boundaries.append(cut)
    return boundaries + [len(counts)]


def slice_plate(name, cols, rows):
    image = Image.open(RAW / f'{name}.png').convert('RGB')
    r, g, b = np.moveaxis(np.asarray(image, dtype=np.int16), 2, 0)
    fg = ~((np.minimum(r, b) - g > 85) & (r > 110) & (b > 110))
    ys = gutters(fg.sum(axis=1), rows)
    cells = []
    for top, bottom in zip(ys, ys[1:]):
        xs = gutters(fg[top:bottom].sum(axis=0), cols)
        for left, right in zip(xs, xs[1:]):
            keyed = key_image(image.crop((left, top, right, bottom)))
            cells.append(keyed.crop(keyed.getbbox()))
    return cells


def scaled(im, factor):
    size = tuple(max(1, round(dim * factor)) for dim in im.size)
    return im.resize(size, Image.Resampling.LANCZOS)


def save(im, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, quality=90, method=6, alpha_quality=100)
    return path.relative_to(ART).as_posix()


def square(im, size):
    # Fit the silhouette inside the HUD's round mask, including long diagonal items.
    ys, xs = np.nonzero(np.asarray(im.getchannel('A')) > 32)
    radius = np.hypot(xs - im.width / 2, ys - im.height / 2).max()
    fitted = scaled(im, (size / 2 - 4) / radius)
    canvas = Image.new('RGBA', (size, size))
    canvas.alpha_composite(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    return canvas


def write_sheet(frames, directory, name, fps, anchor, **markers):
    fw, fh = frames[0].size
    sheet = Image.new('RGBA', (fw * len(frames), fh))
    for i, frame in enumerate(frames):
        assert frame.size == (fw, fh)
        sheet.paste(frame, (i * fw, 0))
    save(sheet, directory / f'{name}.webp')
    spec = dict(frameW=fw, frameH=fh, count=len(frames), cols=len(frames), fps=fps,
                anchor=anchor, **markers, image=f'{name}.webp')
    path = directory / f'{name}.json'
    path.write_text(json.dumps(spec, indent=1) + '\n')
    return path.relative_to(ART).as_posix()


def torso_x(im):
    # Track the bulk of the trunk. The tip of a sword, staff or bow must not move the pivot.
    mask = np.asarray(im.getchannel('A')) > 160
    band = mask[round(0.4 * im.height):round(0.66 * im.height)]
    return float(np.median(np.nonzero(band)[1]))


def motion(hero, directory):
    walk = slice_plate(hero + '-walk', 4, 3)
    action = slice_plate(hero + '-action', 4, 3)
    groups = {'idle': action[:4], 'walk-down': walk[:4], 'walk-up': walk[4:8],
              'walk-side': walk[8:], 'attack': action[4:8], 'death': action[8:]}
    if hero in ('mira', 'sela'):
        # These rear-view plates put the staff on the same screen side as the front.
        groups['walk-up'] = [im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                             for im in groups['walk-up']]
    # Calibrate the two drawings against the same standing height. Keep this scale for the
    # entire action plate, so a kneeling or fallen figure retains its actual proportions.
    action_scale = 229 / median(im.height for im in groups['idle'])
    walk_scale = 229 / median(im.height for im in groups['walk-down'])
    positions = {}
    for name, cells in groups.items():
        scale = walk_scale if name.startswith('walk-') else action_scale
        positions[name] = []
        for i, cell in enumerate(cells):
            im = scaled(cell, scale)
            x = torso_x(im)
            if name == 'attack' and i == 2:
                # Trunk moves forward at contact. Register around the planted feet.
                feet = np.asarray(im.getchannel('A'))[round(im.height * .90):] > 160
                x = float(np.median(np.nonzero(feet)[1]))
            positions[name].append((im, round(x), im.height))

    # One common coordinate system across all six animations, even with extended weapons.
    left = max(x for frames in positions.values() for _, x, _ in frames)
    right = max(im.width - x for frames in positions.values() for im, x, _ in frames)
    extent = max(left, right) + 5
    pivot = (extent, 250)
    paths = {}
    for name, poses in positions.items():
        frames = []
        for im, x, y in poses:
            frame = Image.new('RGBA', (extent * 2, 256))
            if y > pivot[1] - 1:
                raise ValueError(f'{hero} {name} clips above the frame ({y} px)')
            frame.alpha_composite(im, (pivot[0] - x, pivot[1] - y))
            frames.append(frame)
        fps = 4 if name == 'idle' else 8 if name.startswith('walk-') else 7
        paths[name] = write_sheet(frames, directory, name, fps, pivot,
                                  **({'impact': 2} if name == 'attack' else {}))
        if name == 'idle':
            paths['file'] = save(frames[0], directory / 'standing.webp')
    return paths, [0.5, pivot[1] / 256]


def pack_hero(hero, height, skills):
    directory = ART / 'heroes' / hero
    portrait, select = slice_plate(hero, 2, 1)
    out = {'portrait': save(square(portrait, 512), directory / 'portrait.webp'),
           'select': save(scaled(select, 900 / select.height), directory / 'select.webp')}
    icons = slice_plate(hero + '-icons', 3, 2)
    for group, ids, images in [('skills', skills, icons[:3]), ('branches', BRANCHES, icons[3:])]:
        out[group] = {k: save(square(im, 256), directory / group / f'{k}.webp')
                      for k, im in zip(ids, images)}
    paths, anchor = motion(hero, directory)
    out.update(mode='sheet', file=paths['file'], height=height, anchor=anchor, facing='right',
               sheet={**{d: paths['walk-' + d] for d in ('down', 'up', 'side')},
                      'facing': 'right', 'facingUp': 'left', 'facingSide': 'right'},
               idle=paths['idle'], attack=paths['attack'], death=paths['death'])
    return out


def pack_abilities():
    directory = ART / 'abilities'
    meteor, overcharge = slice_plate('global-icons', 2, 1)
    fall, = slice_plate('meteor-falling', 1, 1)
    out = {'meteor': {'icon': save(square(meteor, 256), directory / 'meteor/icon.webp'),
                      'falling': save(scaled(fall, 384 / fall.width), directory / 'meteor/falling.webp'),
                      'fallingAnchor': [0.81, 0.77]},
           'overcharge': {'icon': save(square(overcharge, 256), directory / 'overcharge/icon.webp')}}
    # Register on the hot rock / center of the ground ellipse. Preserve the relative
    # dimensions of flash, burst and crater. Points measured in the trimmed source cuts.
    for ability, name, src, cols, rows, size, scale, pivot, origins, fps in (
        ('meteor', 'impact', 'meteor-impact', 3, 2, (288, 256), .52, (144, 158),
         [(0.51, .69), (.50, .66), (.50, .62), (.52, .72), (.51, .65), (.50, .63)], 9),
        ('overcharge', 'aura', 'overcharge-aura', 2, 2, (384, 256), .55, (192, 186),
         [(.50, .70)] * 4, 6),
    ):
        frames = []
        for cell, (ox, oy) in zip(slice_plate(src, cols, rows), origins):
            im = scaled(cell, scale)
            dest = (pivot[0] - round(ox * im.width), pivot[1] - round(oy * im.height))
            if min(dest) < 0 or any(a+b > c for a, b, c in zip(dest, im.size, size)):
                raise ValueError(f'Effect clips: {name} {dest} {im.size}')
            frame = Image.new('RGBA', size)
            frame.alpha_composite(im, dest)
            frames.append(frame)
        out[ability][name] = write_sheet(frames, directory / ability, name, fps, pivot)
    return out


def main():
    manifest_path = ART / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['heroes'] = {hero: pack_hero(hero, height, skills)
                          for hero, (height, skills) in HEROES.items()}
    manifest['abilities'] = pack_abilities()
    manifest_path.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
