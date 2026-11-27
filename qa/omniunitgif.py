"""Docs images for the five Omni regular foes (after qa/omniunits.mjs), like qa/omnibossgif.py:
- docs/omni-unit-shots/ingame-death-frames.jpg: in-game crop frames of each death (headless
  SwiftShader screenshots are slow, so a few frames per clip, labelled with ms after the hit);
- docs/omni-unit-shots/death.gif: the five death clips at 12 fps and game scale over a map crop
  from the zoo shot (what the frames between those screenshots look like).
usage: python3 qa/omniunitgif.py [/tmp/omniunit-qa]
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw

FR = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/omniunit-qa')
OUT = Path('docs/omni-unit-shots')
ANIM = Path('public/art2d/anim')
UNITS = [('rimebeetle', 'rb', 1.45), ('sledguard', 'sg', 1.42), ('duskhound', 'dh', 1.57), ('veilcaster', 'vc', 1.45), ('eclipse_shade', 'es5', 2.13)]
PX_PER_UNIT = 30 * 1.6  # on-screen px per world unit at 1280x800 (~30), drawn 1.6× so the GIF reads

# 1) in-game crop strip (every other frame, up to 8 per foe)
rows = []
for _, tag, _ in UNITS:
    fs = sorted(FR.glob(f'{tag}-*.png'), key=lambda f: int(f.stem.split('-')[1]))[::2][:8]
    ims = [Image.open(f).convert('RGB') for f in fs]
    if not ims:
        continue
    row = Image.new('RGB', (sum(i.width for i in ims), ims[0].height + 18), (30, 30, 30))
    d = ImageDraw.Draw(row)
    x = 0
    for f, im in zip(fs, ims):
        row.paste(im, (x, 18))
        d.text((x + 4, 3), f'{tag} +{f.stem.split("-")[-1]} ms', fill=(240, 240, 220))
        x += im.width
    rows.append(row)
if rows:
    strip = Image.new('RGB', (max(r.width for r in rows), sum(r.height for r in rows)), (30, 30, 30))
    y = 0
    for r in rows:
        strip.paste(r, (0, y)); y += r.height
    strip.save(OUT / 'ingame-death-frames.jpg', quality=80)
    print('strip', strip.size)


# 2) clip GIF at game scale: px scale from the walk "down" sheet, like EnemyLayer.playDeath
def cells(id_, clip):
    j = json.loads((ANIM / f'{id_}-{clip}.json').read_text())
    im = Image.open(ANIM / j['image']).convert('RGBA')
    fw, fh, c = j['frameW'], j['frameH'], j['cols']
    return j, [im.crop(((k % c) * fw, (k // c) * fh, (k % c + 1) * fw, (k // c + 1) * fh)) for k in range(j['count'])]


zoo = Image.open(OUT / 'zoo-1280x800.jpg').convert('RGBA')
bg = zoo.crop((470, 600, 670, 760))  # grass + road, clear of the HUD bars
tiles = []
for id_, _, height in UNITS:
    wj, _ = cells(id_, 'walk-down')
    dj, dc = cells(id_, 'death')
    s = height * PX_PER_UNIT / (wj['frameH'] * 0.94)
    ax, ay = dj['anchor']
    tiles.append((dc, s, ax, ay))
n = max(len(t[0]) for t in tiles) + 6  # hold the end a little (the game fades it out over 0.2 s)
frames = []
for k in range(n):
    fr = Image.new('RGBA', (bg.width * len(tiles), bg.height), (0, 0, 0, 255))
    for i, (dc, s, ax, ay) in enumerate(tiles):
        tile = bg.copy()
        idx = min(k, len(dc) - 1)
        alpha = 1.0 if k < len(dc) else max(0.0, 1 - (k - len(dc) + 1) / 2.4)
        c = dc[idx].resize((round(dc[idx].width * s), round(dc[idx].height * s)), Image.LANCZOS)
        if alpha < 1:
            c.putalpha(c.getchannel('A').point(lambda v, f=alpha: int(v * f)))
        tile.alpha_composite(c, (round(bg.width / 2 - ax * s), round(bg.height - 16 - ay * s)))
        fr.alpha_composite(tile, (i * bg.width, 0))
    frames.append(fr.convert('RGB').convert('P', palette=Image.ADAPTIVE, colors=255))
frames[0].save(OUT / 'death.gif', save_all=True, append_images=frames[1:], duration=83, loop=0)
print('gif', len(frames), 'frames', frames[0].size)
