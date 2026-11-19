#!/usr/bin/python3
"""Pack the chapter-two motion paintings into anchored six-frame animation strips.

Usage: python3 tools/sprites/chapter_enemies.py ID design/art-2d/chapter2/ID.webp public/art2d
"""
import argparse
import json
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


# Each production plate is arranged in this order.
POSES = ('walk-down', 'walk-up', 'walk-side', 'attack', 'death')
FRAME = (240, 184)
ANCHOR = (120, 176)


def save_webp(image, path):
    # A cancelled encode must leave the previous playable strip intact.
    with NamedTemporaryFile(dir=path.parent, suffix='.webp', delete=False) as output:
        temp = Path(output.name)
    try:
        image.save(temp, quality=91, method=6)
        temp.chmod(0o644)
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def split_plate(image):
    image = image.convert('RGBA')
    alpha = np.asarray(image.getchannel('A'))

    def gutters(projection, count):
        cuts = [0]
        # Find the middle of the cleanest gutter nearest each expected cell
        # boundary. Attack lunges and prone bodies can extend past the grid.
        for n in range(1, count):
            centre = round(n*len(projection)/count)
            radius = round(len(projection)/count*.31)
            region = projection[centre-radius:centre+radius+1]
            candidates = np.flatnonzero(region == region.min()) + centre-radius
            cuts.append(min(candidates, key=lambda v: abs(v-centre)))
        return [*cuts, len(projection)]

    rows = gutters((alpha > 48).sum(axis=1), 5)
    clips = []
    for y0, y1 in zip(rows, rows[1:]):
        band = image.crop((0, y0, image.width, y1))
        silhouettes = band.getchannel('A').point(lambda a: 255 if a >= 24 else 0)
        row = []
        for i in range(6):
            # Wing tips can cross a nominal cell boundary. Follow the connected
            # silhouette from the body and retain its antialiased perimeter.
            left = round((i+.25)*image.width/6)
            right = round((i+.75)*image.width/6)
            yy, xx = np.nonzero(np.asarray(silhouettes)[:,left:right] == 255)
            if not len(xx):
                raise ValueError(f'Missing pose in row {len(clips)+1}, column {i+1}')
            nearest = np.argmin((xx-xx.mean())**2+(yy-yy.mean())**2)
            ImageDraw.floodfill(silhouettes, (left+int(xx[nearest]), int(yy[nearest])), 128)
            subject = silhouettes.point(lambda value: 255 if value == 128 else 0)
            silhouettes.paste(0, mask=subject)
            box = subject.getbbox()
            box = (max(0,box[0]-3), max(0,box[1]-3),
                   min(image.width,box[2]+3), min(y1-y0,box[3]+3))
            cell = band.crop(box)
            soft = subject.crop(box).filter(ImageFilter.MaxFilter(7))
            cell.putalpha(ImageChops.multiply(cell.getchannel('A'), soft))
            row.append((cell, y0+box[3]))
        clips.append(row)
    return clips


def pack(ident, source, target):
    with Image.open(source) as image:
        clips = split_plate(image)
    # One scale for the whole animal; a crouch, lunge or fall changes its
    # silhouette. Pin a shared ground line per row to keep the drawn hop.
    bboxes = [(im.width, max(feet for _,feet in row)-foot+im.height)
              for row in clips for im,foot in row]
    scale = min((FRAME[0]-14)/max(w for w,_ in bboxes),
                (ANCHOR[1]-4)/max(h for _,h in bboxes))
    anim = target/'anim'
    anim.mkdir(parents=True, exist_ok=True)
    for name, row in zip(POSES, clips):
        strip = Image.new('RGBA', (FRAME[0]*6, FRAME[1]))
        ground = max(feet for _,feet in row)
        for i, (figure, feet) in enumerate(row):
            size = tuple(round(v*scale) for v in figure.size)
            figure = figure.resize(size, Image.Resampling.LANCZOS)
            # Align to torso mass instead of the end of a changing ear or snout.
            weights = np.array(figure.getchannel('A'), dtype=float).sum(axis=0)
            cx = np.average(np.arange(figure.width), weights=weights)
            dx = round(ANCHOR[0]-cx)
            dx = max(2, min(FRAME[0]-figure.width-2, dx))
            bottom = ANCHOR[1]-round((ground-feet)*scale)
            strip.alpha_composite(figure, (i*FRAME[0]+dx, bottom-figure.height))
            if i == 0 and name in ('walk-down','walk-up'):
                suffix = '-back' if name == 'walk-up' else ''
                save_webp(figure, target/f'enemy-{ident}{suffix}.webp')
        stem = f'{ident}-{name}'
        save_webp(strip, anim/f'{stem}.webp')
        spec = dict(frameW=FRAME[0], frameH=FRAME[1], count=6, cols=6,
                    fps=10 if name == 'death' else 12, anchor=list(ANCHOR), image=f'{stem}.webp')
        if name == 'attack':
            spec['impact'] = 3
        (anim/f'{stem}.json').write_text(json.dumps(spec, indent=1)+'\n')


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('id')
    cli.add_argument('source', type=Path)
    cli.add_argument('target', type=Path)
    args = cli.parse_args()
    pack(args.id, args.source, args.target)
