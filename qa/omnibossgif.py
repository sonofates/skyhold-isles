"""Docs images for the Omni bosses (after qa/omnibosses.mjs):
- docs/omni-boss-shots/ingame-death-frames.jpg: the in-game crop frames of both deaths (headless
  SwiftShader screenshots are slow, so a few frames per clip, labelled with ms after the hit);
- docs/omni-boss-shots/death.gif: both death clips at 12 fps, game scale, over a map crop from the
  zoo shot (what the frames between those screenshots look like).
usage: python3 qa/omnibossgif.py [/tmp/omniboss-qa]
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw

FR = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/omniboss-qa')
OUT = Path('docs/omni-boss-shots')
ANIM = Path('public/art2d/anim')

# 1) in-game crop strip
rows = []
for tag in ('gw', 'es'):
    fs = sorted(FR.glob(f'{tag}-*.png'))
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


# 2) clip GIF at game scale: px scale from the walk "down" sheet, like EnemyLayer.playDeath
def cells(id_, clip):
    j = json.loads((ANIM / f'{id_}-{clip}.json').read_text())
    im = Image.open(ANIM / j['image']).convert('RGBA')
    fw, fh, c = j['frameW'], j['frameH'], j['cols']
    return j, [im.crop(((k % c) * fw, (k // c) * fh, (k % c + 1) * fw, (k // c + 1) * fh)) for k in range(j['count'])]


zoo = Image.open(OUT / 'zoo-1280x800.jpg').convert('RGBA')
bg = zoo.crop((420, 556, 760, 796))  # grass + road, clear of the HUD bars
ppu_h = 150  # on-screen px of the manifest height (3.36 / 3.34): the Warden's figure is ~130 px in the zoo shot
tiles = []
for id_ in ('glacier_warden', 'eclipse_sovereign'):
    wj, _ = cells(id_, 'walk-down')
    dj, dc = cells(id_, 'death')
    s = ppu_h / (wj['frameH'] * 0.94)
    ax, ay = dj['anchor']
    tiles.append((dc, s, ax, ay, dj['fps']))
n = max(len(t[0]) for t in tiles) + 6  # hold the end a little (the game fades it out over 0.2 s)
frames = []
for k in range(n):
    fr = Image.new('RGBA', (bg.width * 2, bg.height), (0, 0, 0, 255))
    for i, (dc, s, ax, ay, fps) in enumerate(tiles):
        tile = bg.copy()
        idx = min(k, len(dc) - 1)
        alpha = 1.0 if k < len(dc) else max(0.0, 1 - (k - len(dc) + 1) / 2.4)
        c = dc[idx].resize((round(dc[idx].width * s), round(dc[idx].height * s)), Image.LANCZOS)
        if alpha < 1:
            a = c.getchannel('A').point(lambda v, f=alpha: int(v * f))
            c.putalpha(a)
        tile.alpha_composite(c, (round(bg.width / 2 - ax * s), round(bg.height - 20 - ay * s)))
        fr.alpha_composite(tile, (i * bg.width, 0))
    frames.append(fr.convert('RGB').convert('P', palette=Image.ADAPTIVE, colors=255))
frames[0].save(OUT / 'death.gif', save_all=True, append_images=frames[1:], duration=83, loop=0)
print('ok', len(frames), 'frames')
