#!/usr/bin/python3
"""Remove baked-in projectiles from a tower attack sheet, keep the tower and its local FX.

usage: /usr/bin/python3 tools/sprites/strip_projectiles.py <sheet.json> [--halo 0.22] [--up 0.10]

The game draws projectiles toward the real target, so anything the video threw away from the tower
(arrows, shells, bolts flying off) must go. Per frame we keep:
  * the tower itself: frame 0's opaque silhouette (towers are static), dilated a little,
  * a soft halo around it (radius = halo × sprite height) for glows, sparks, mist, muzzle smoke,
    stretched upward by `up` (FX tend to rise),
and fade everything else to transparent. Writes the sheet image in place (same format) and adds
"stripped": true to the JSON.
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

args = sys.argv[1:]
jp = Path(args[0])
halo = float(args[args.index('--halo') + 1]) if '--halo' in args else 0.22
up = float(args[args.index('--up') + 1]) if '--up' in args else 0.10
j = json.loads(jp.read_text())
img_p = jp.with_name(j['image'])
sheet = Image.open(img_p).convert('RGBA')
fw, fh, n, cols = j['frameW'], j['frameH'], j['count'], j['cols']
cells = [sheet.crop(((i % cols) * fw, (i // cols) * fh, (i % cols) * fw + fw, (i // cols) * fh + fh)) for i in range(n)]

# static silhouette: pixels opaque in most frames (robust to frame 0 containing a flash)
acc = Image.new('L', (fw, fh), 0)
for c in cells:
    acc = ImageChops.add(acc, c.getchannel('A').point(lambda v: 255 // max(1, n) if v > 200 else 0))
core = acc.point(lambda v: 255 if v > 255 * 0.6 else 0)
r = max(2, int(fh * 0.02))
core = core.filter(ImageFilter.MaxFilter(r * 2 + 1))

# halo: dilate + blur, shifted upward a bit
rad = int(fh * halo)
big = core.filter(ImageFilter.MaxFilter(min(51, (rad // 2) * 2 + 1)))
for _ in range(max(0, rad // 25 - 1)):
    big = big.filter(ImageFilter.MaxFilter(min(51, (rad // 2) * 2 + 1)))
shift = int(fh * up)
lifted = Image.new('L', (fw, fh), 0)
lifted.paste(big, (0, -shift))
keep = ImageChops.lighter(big, lifted).filter(ImageFilter.GaussianBlur(rad * 0.35))
keep = ImageChops.lighter(keep, core)

out = Image.new('RGBA', sheet.size, (0, 0, 0, 0))
for i, c in enumerate(cells):
    a = ImageChops.multiply(c.getchannel('A'), keep)
    c2 = c.copy()
    # despill: magenta-tinted pixels (both R and B well above G, as in smoke over the old backdrop)
    # are pulled back toward neutral; blue/violet glows (only B high) are untouched
    px = c2.load()
    for yy in range(fh):
        for xx in range(fw):
            rr, gg, bb, aa = px[xx, yy]
            if aa and rr - gg > 30 and bb - gg > 30:
                cap = gg + 30
                px[xx, yy] = (min(rr, cap), gg, min(bb, cap), aa)
    c2.putalpha(a)
    out.paste(c2, ((i % cols) * fw, (i // cols) * fh))
fmt = 'WEBP' if img_p.suffix == '.webp' else 'PNG'
out.save(img_p, fmt, **({'quality': 86, 'method': 5} if fmt == 'WEBP' else {}))
j['stripped'] = True
jp.write_text(json.dumps(j, indent=1))
print(jp.name, 'stripped', f'halo={halo}')
