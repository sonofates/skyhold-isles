"""Old painted 6-frame strips vs the Omni sheets at game scale: docs/omni-boss-shots/compare-contact.jpg
(every frame; yellow bar = attack contact frame) and compare.gif (old | new side by side, 12 fps).
usage: python3 qa/omnibosscompare.py [old_rev]   (old_rev: a revision with the painted strips, default 479f3295)
"""
import json, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw

REV = sys.argv[1] if len(sys.argv) > 1 else '479f3295'
OLD = Path(tempfile.mkdtemp(prefix='omniboss-old-'))
for bid in ('glacier_warden', 'eclipse_sovereign'):
    for clip in ('walk-down', 'walk-up', 'attack', 'death'):
        for ext in ('json', 'webp'):
            data = subprocess.run(['git', 'show', f'{REV}:public/art2d/anim/{bid}-{clip}.{ext}'], capture_output=True, check=True).stdout
            (OLD / f'{bid}-{clip}.{ext}').write_bytes(data)
NEW = Path('public/art2d/anim')
OUT = Path('docs/omni-boss-shots'); OUT.mkdir(parents=True, exist_ok=True)
GROUND = (128, 140, 104, 255)
FIG = 100  # on-screen figure height of the boss at 1280x800 (docs/handoff-ch4-art.md: 106 px)
CLIPS = [('walk-down', 'walk-down'), ('walk-up', 'walk-up'), ('attack', 'attack'), ('death', 'death')]
BOSSES = [('glacier_warden', 'gw'), ('eclipse_sovereign', 'es')]


def frames(jpath, img):
    j = json.loads(jpath.read_text())
    im = Image.open(img).convert('RGBA')
    fw, fh, cols = j['frameW'], j['frameH'], j['cols']
    out = [im.crop(((k % cols) * fw, (k // cols) * fh, (k % cols + 1) * fw, (k // cols + 1) * fh)) for k in range(j['count'])]
    return j, out


def fig_h(cells):
    hs = sorted((c.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox() or (0, 0, 0, 1))[3] - (c.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox() or (0, 0, 0, 0))[1] for c in cells)
    return hs[len(hs) // 2]


def scaled(cells, ref_h):
    s = FIG / ref_h
    return [c.resize((max(1, round(c.width * s)), max(1, round(c.height * s))), Image.LANCZOS) for c in cells], s


rows = []  # (label, old cells, old fps, new cells, new fps, impact old/new)
for bid, short in BOSSES:
    # one px scale per boss and source: the walk "down" figure height (as in the renderer)
    _, od = frames(OLD / f'{bid}-walk-down.json', OLD / f'{bid}-walk-down.webp')
    _, nd = frames(NEW / f'{bid}-walk-down.json', NEW / f'{bid}-walk-down.webp')
    oref, nref = fig_h(od), fig_h(nd)
    for clip, nclip in CLIPS:
        oj, oc = frames(OLD / f'{bid}-{clip}.json', OLD / f'{bid}-{clip}.webp')
        nj, nc = frames(NEW / f'{bid}-{nclip}.json', NEW / f'{bid}-{nclip}.webp')
        if clip == 'attack':  # renderer: attack frame 0 matched to the walk figure height
            oc, _ = scaled(oc, fig_h(oc[:1]) * oref / fig_h(od[:1]))
            nc, _ = scaled(nc, fig_h(nc[:1]) * nref / fig_h(nd[:1]))
        else:
            oc, _ = scaled(oc, oref)
            nc, _ = scaled(nc, nref)
        rows.append((f'{bid} {clip}', oc, oj['fps'], nc, nj['fps'], oj.get('impact'), nj.get('impact')))

# contact sheet: per row the old strip (all frames) then the new sheet (every frame, wrapped at 14)
pad = 6
cw = max(max(c.width for c in r[1] + r[3]) for r in rows)
ch = max(max(c.height for c in r[1] + r[3]) for r in rows)
per = 14
lines = []
for r in rows:
    lines.append(('OLD ' + r[0], r[1], r[5]))
    for i in range(0, len(r[3]), per):
        lines.append(('NEW ' + r[0] + (f' ({i}-)' if i else ''), r[3][i:i + per], (r[6] - i) if r[6] is not None and i <= r[6] < i + per else None))
W = 180 + per * (cw + pad)
H = len(lines) * (ch + pad + 4)
sheet = Image.new('RGBA', (W, H), (34, 38, 34, 255))
d = ImageDraw.Draw(sheet)
y = 0
for label, cells, imp in lines:
    d.text((6, y + ch // 2), label, fill=(235, 235, 220, 255))
    for k, c in enumerate(cells):
        x = 180 + k * (cw + pad)
        cell = Image.new('RGBA', (cw, ch), GROUND)
        cell.alpha_composite(c, ((cw - c.width) // 2, ch - c.height))
        sheet.alpha_composite(cell, (x, y))
        if imp is not None and k == imp:
            d.rectangle((x, y + ch, x + cw - 1, y + ch + 3), fill=(255, 210, 60, 255))
    y += ch + pad + 4
sheet = sheet.resize((sheet.width * 6 // 10, sheet.height * 6 // 10), Image.LANCZOS)
sheet.convert('RGB').save(OUT / 'compare-contact.jpg', quality=78)
print('contact', sheet.size)

# GIF: 8 rows (boss × clip), old | new side by side, animated at 12 fps (death holds its last frame)
GW = 2 * cw + 3 * pad + 170
gH = len(rows) * (ch + pad)
n_t = 36
gif = []
for t in range(n_t):
    fr = Image.new('RGBA', (GW, gH), (34, 38, 34, 255))
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
            fr.alpha_composite(cell, (170 + j * (cw + pad), yy))
    fr = fr.resize((fr.width * 7 // 10, fr.height * 7 // 10), Image.LANCZOS)
    gif.append(fr.convert('RGB').convert('P', palette=Image.ADAPTIVE, colors=96))
gif[0].save(OUT / 'compare.gif', save_all=True, append_images=gif[1:], duration=83, loop=0)
print('gif', GW, gH)
