"""Old painted 6-frame strips vs the Omni sheets of the five chapter-4/5 regular foes, drawn at 1.5×
game scale and saved at ~1× (contact) / ~0.9× (GIF): docs/omni-unit-shots/compare-contact.jpg (every frame; yellow bar = attack contact frame) and
compare.gif (old | new side by side, 12 fps). Same layout as qa/omnibosscompare.py.
usage: python3 qa/omniunitcompare.py [old_rev]   (old_rev: a revision with the painted strips, default 505272d1)
"""
import json, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw

REV = sys.argv[1] if len(sys.argv) > 1 else '505272d1'
UNITS = [('rimebeetle', 1.45), ('sledguard', 1.42), ('duskhound', 1.57), ('veilcaster', 1.45), ('eclipse_shade', 2.13)]
CLIPS = ['walk-down', 'walk-up', 'attack', 'death']
OLD = Path(tempfile.mkdtemp(prefix='omniunit-old-'))
for uid, _ in UNITS:
    for clip in CLIPS:
        for ext in ('json', 'webp'):
            data = subprocess.run(['git', 'show', f'{REV}:public/art2d/anim/{uid}-{clip}.{ext}'], capture_output=True, check=True).stdout
            (OLD / f'{uid}-{clip}.{ext}').write_bytes(data)
NEW = Path('public/art2d/anim')
OUT = Path('docs/omni-unit-shots'); OUT.mkdir(parents=True, exist_ok=True)
GROUND = (128, 140, 104, 255)
PX_PER_UNIT = 45  # 1.5 × the on-screen px per world unit at 1280x800 (the 3.36-unit Warden is ~100 px)


def frames(jpath, img):
    j = json.loads(jpath.read_text())
    im = Image.open(img).convert('RGBA')
    fw, fh, cols = j['frameW'], j['frameH'], j['cols']
    return j, [im.crop(((k % cols) * fw, (k // cols) * fh, (k % cols + 1) * fw, (k // cols + 1) * fh)) for k in range(j['count'])]


def fig_h(cells):
    hs = []
    for c in cells:
        b = c.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox() or (0, 0, 0, 1)
        hs.append(b[3] - b[1])
    hs.sort()
    return hs[len(hs) // 2]


def scaled(cells, s):
    return [c.resize((max(1, round(c.width * s)), max(1, round(c.height * s))), Image.LANCZOS) for c in cells]


rows = []  # (label, old cells, old fps, new cells, new fps, impact old/new)
for uid, height in UNITS:
    # one px scale per foe and source, as in the renderer: walk frameH × 0.94 = manifest height
    target = height * PX_PER_UNIT
    oj, od = frames(OLD / f'{uid}-walk-down.json', OLD / f'{uid}-walk-down.webp')
    nj, nd = frames(NEW / f'{uid}-walk-down.json', NEW / f'{uid}-walk-down.webp')
    so, sn = target / (oj['frameH'] * 0.94), target / (nj['frameH'] * 0.94)
    for clip in CLIPS:
        oj2, oc = frames(OLD / f'{uid}-{clip}.json', OLD / f'{uid}-{clip}.webp')
        nj2, nc = frames(NEW / f'{uid}-{clip}.json', NEW / f'{uid}-{clip}.webp')
        fo, fn = so, sn
        if clip == 'attack':  # renderer: attack frame 0 matched to the walk figure height (figScale)
            fo *= fig_h(od[:1]) / fig_h(oc[:1])
            fn *= fig_h(nd[:1]) / fig_h(nc[:1])
        if clip == 'walk-up':  # walk sheets each map their own frameH to the height
            fo = target / (oj2['frameH'] * 0.94)
            fn = target / (nj2['frameH'] * 0.94)
        rows.append((f'{uid} {clip}', scaled(oc, fo), oj2['fps'], scaled(nc, fn), nj2['fps'], oj2.get('impact'), nj2.get('impact')))

pad = 6
cw = max(max(c.width for c in r[1] + r[3]) for r in rows)
ch = max(max(c.height for c in r[1] + r[3]) for r in rows)
per = 12
lines = []
for r in rows:
    lines.append(('OLD ' + r[0], r[1], r[5]))
    for i in range(0, len(r[3]), per):
        lines.append(('NEW ' + r[0] + (f' ({i}-)' if i else ''), r[3][i:i + per], (r[6] - i) if r[6] is not None and i <= r[6] < i + per else None))
W = 170 + per * (cw + pad)
H = len(lines) * (ch + pad + 4)
sheet = Image.new('RGBA', (W, H), (34, 38, 34, 255))
d = ImageDraw.Draw(sheet)
y = 0
for label, cells, imp in lines:
    d.text((6, y + ch // 2), label, fill=(235, 235, 220, 255))
    for k, c in enumerate(cells):
        x = 170 + k * (cw + pad)
        cell = Image.new('RGBA', (cw, ch), GROUND)
        cell.alpha_composite(c, ((cw - c.width) // 2, ch - c.height))
        sheet.alpha_composite(cell, (x, y))
        if imp is not None and k == imp:
            d.rectangle((x, y + ch, x + cw - 1, y + ch + 3), fill=(255, 210, 60, 255))
    y += ch + pad + 4
sheet = sheet.resize((sheet.width * 7 // 10, sheet.height * 7 // 10), Image.LANCZOS)
sheet.convert('RGB').save(OUT / 'compare-contact.jpg', quality=76)
print('contact', sheet.size)

# GIF: one row per foe × clip, old | new side by side, animated at 12 fps (death holds its last frame)
GWID = 2 * cw + 3 * pad + 160
gH = len(rows) * (ch + pad)
gif = []
for t in range(36):
    fr = Image.new('RGBA', (GWID, gH), (34, 38, 34, 255))
    dd = ImageDraw.Draw(fr)
    for i, (label, oc, ofps, nc, nfps, _, _) in enumerate(rows):
        yy = i * (ch + pad)
        dd.text((4, yy + ch // 2), label, fill=(235, 235, 220, 255))
        for j, (cells, fps) in enumerate(((oc, ofps), (nc, nfps))):
            k = int(t / 12 * fps)
            k = min(k, len(cells) - 1) if 'death' in label else k % len(cells)
            cell = Image.new('RGBA', (cw, ch), GROUND)
            c = cells[k]
            cell.alpha_composite(c, ((cw - c.width) // 2, ch - c.height))
            fr.alpha_composite(cell, (160 + j * (cw + pad), yy))
    fr = fr.resize((fr.width * 6 // 10, fr.height * 6 // 10), Image.LANCZOS)
    gif.append(fr.convert('RGB').convert('P', palette=Image.ADAPTIVE, colors=96))
gif[0].save(OUT / 'compare.gif', save_all=True, append_images=gif[1:], duration=83, loop=0)
print('gif', GWID, gH)
