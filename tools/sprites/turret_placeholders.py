#!/usr/bin/python3
"""Procedural PLACEHOLDER raw art for the aimable turrets, in exactly the layout the real art uses
(see turret_pack.py): <type>-<tier>-body.png (1024x1024) and <type>-<tier>-turret.png (2560x512,
panels S SE E NE N), magenta background. Lets the whole pipeline run before the painted art lands.

usage: /usr/bin/python3 tools/sprites/turret_placeholders.py [OUT_DIR]
  then: /usr/bin/python3 tools/sprites/turret_pack.py --raw OUT_DIR --placeholder
Default OUT_DIR: design/art-2d/v2/raw-placeholder (the real art goes to design/art-2d/v2/raw).

The pieces are deliberately plain but unmistakably directional: the barrel mouth / bolt head /
arrow head is bright, so a screenshot shows which way a turret faces.
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'design/art-2d/v2/raw-placeholder'
MAGENTA = (255, 0, 255, 255)
SS = 2  # supersampling
DIRS = {'S': (0.0, 1.0), 'SE': (0.7071, 0.7071), 'E': (1.0, 0.0), 'NE': (0.7071, -0.7071), 'N': (0.0, -1.0)}
FORE = 0.8  # screen-y foreshortening of ground-plane vectors (the game reads directions in screen space)

STONE = ((214, 196, 160), (168, 148, 116), (110, 92, 70))
WOOD = ((212, 150, 72), (170, 110, 48), (104, 64, 28))
GOLD = (236, 196, 84)
TEAL = (70, 140, 128)


def canvas(w, h):
    im = Image.new('RGBA', (w * SS, h * SS), MAGENTA)
    return im, ImageDraw.Draw(im)


def S(*v):
    return [c * SS for c in v]


def ell(d, cx, cy, rx, ry, fill, outline=None, width=0):
    d.ellipse(S(cx - rx, cy - ry, cx + rx, cy + ry), fill=fill, outline=outline, width=width * SS)


def body(kind, tier):
    im, d = canvas(1024, 1024)
    pal = WOOD if kind in ('archer', 'ballista') else STONE
    # Plot ring (same proportions as plot-base: height ~ 0.666 * width incl. the stone).
    rw, bottom = 760, 1000
    rh = rw * 0.666
    cy = bottom - rh / 2
    ell(d, 512, cy, rw / 2, rh / 2, STONE[1], STONE[2], 6)
    ell(d, 512, cy - 6, rw / 2 - 58, rh / 2 - 52, (150, 112, 70))
    top = {1: 400, 2: 350, 3: 300}[tier]
    wb, wt = 470, 400
    base_y = cy + 40
    d.polygon([tuple(S(512 - wb / 2, base_y)), tuple(S(512 - wt / 2, top)), tuple(S(512 + wt / 2, top)), tuple(S(512 + wb / 2, base_y))], fill=pal[1], outline=pal[2])
    ell(d, 512, base_y, wb / 2, wb * 0.2, pal[1], pal[2], 4)
    # Courses (stone) / planks (wood).
    for i, y in enumerate(range(int(top) + 40, int(base_y), 52)):
        k = (y - top) / (base_y - top)
        half = (wt + (wb - wt) * k) / 2
        d.arc(S(512 - half, y - half * 0.4, 512 + half, y + half * 0.4), 20, 160, fill=pal[2], width=4 * SS)
    if tier >= 2:
        y = top + 70
        d.arc(S(512 - wt / 2 - 6, y - 90, 512 + wt / 2 + 6, y + 90), 15, 165, fill=GOLD, width=14 * SS)
    if tier >= 3:
        d.polygon([tuple(S(470, top + 120)), tuple(S(554, top + 120)), tuple(S(554, top + 250)), tuple(S(512, top + 225)), tuple(S(470, top + 250))], fill=TEAL, outline=(40, 80, 70))
        d.polygon([tuple(S(512, top + 150)), tuple(S(528, top + 175)), tuple(S(512, top + 200)), tuple(S(496, top + 175))], fill=GOLD)
    # Empty platform on top: rim + floor (+ merlons at the back for stone).
    ell(d, 512, top, wt / 2 + 18, (wt / 2 + 18) * 0.42, pal[0], pal[2], 5)
    ell(d, 512, top + 4, wt / 2 - 22, (wt / 2 - 22) * 0.38, pal[2])
    if kind == 'cannon':
        for a in range(200, 345, 24):
            x = 512 + math.cos(math.radians(a)) * (wt / 2 + 6)
            y = top + math.sin(math.radians(a)) * (wt / 2 + 6) * 0.42
            d.rectangle(S(x - 18, y - 34, x + 18, y + 2), fill=pal[0], outline=pal[2], width=3 * SS)
    return im.resize((1024, 1024), Image.LANCZOS)


def vec(dname, length, elev=0.0):
    dx, dy = DIRS[dname]
    return dx * length, dy * length * FORE - elev


def thick(d, a, b, w, fill, outline=None):
    (x1, y1), (x2, y2) = a, b
    L = math.hypot(x2 - x1, y2 - y1) or 1
    nx, ny = -(y2 - y1) / L * w / 2, (x2 - x1) / L * w / 2
    pts = [(x1 + nx, y1 + ny), (x2 + nx, y2 + ny), (x2 - nx, y2 - ny), (x1 - nx, y1 - ny)]
    d.polygon([tuple(S(*p)) for p in pts], fill=fill, outline=outline)
    ell(d, x1, y1, w / 2, w / 2, fill)


def cannon_panel(d, dname, tier):
    fx, fy = 256, 440
    big = 1 + (tier - 1) * 0.12
    iron = (70, 72, 82) if tier < 3 else (150, 98, 46)
    behind = DIRS[dname][1] < 0
    p0 = (fx, fy - 70 * big)
    tx, ty = vec(dname, 150 * big, 70 * big)
    tip = (p0[0] + tx, p0[1] + ty)

    def barrel():
        thick(d, p0, tip, 52 * big, iron, (30, 30, 36))
        ell(d, tip[0], tip[1], 30 * big, 30 * big * (0.55 + 0.45 * abs(DIRS[dname][1])), (255, 150, 40), (40, 30, 20), 4)
        ell(d, tip[0], tip[1], 15 * big, 15 * big * (0.55 + 0.45 * abs(DIRS[dname][1])), (40, 20, 10))

    if behind:
        barrel()
    d.rounded_rectangle(S(fx - 85 * big, fy - 70 * big, fx + 85 * big, fy), radius=14 * SS, fill=WOOD[1], outline=WOOD[2], width=4 * SS)
    ell(d, fx - 60 * big, fy - 18, 22 * big, 22 * big, WOOD[2])
    ell(d, fx + 60 * big, fy - 18, 22 * big, 22 * big, WOOD[2])
    if not behind:
        barrel()


def ballista_panel(d, dname, tier):
    fx, fy = 256, 440
    big = 1 + (tier - 1) * 0.12
    dx, dy = DIRS[dname]
    d.rounded_rectangle(S(fx - 50 * big, fy - 60 * big, fx + 50 * big, fy), radius=10 * SS, fill=WOOD[2], outline=(60, 36, 14), width=3 * SS)
    c = (fx, fy - 80 * big)
    bx, by = vec(dname, 70 * big, 10)
    back = (c[0] - bx, c[1] - by)
    tx, ty = vec(dname, 150 * big, 30)
    front = (c[0] + tx, c[1] + ty)
    px, py = -dy, dx * FORE
    pl = math.hypot(px, py) or 1
    px, py = px / pl, py / pl
    span = 120 * big
    arm = (c[0] + tx * 0.55, c[1] + ty * 0.55)
    e1 = (arm[0] + px * span - tx * 0.25, arm[1] + py * span - ty * 0.25)
    e2 = (arm[0] - px * span - tx * 0.25, arm[1] - py * span - ty * 0.25)
    behind = dy < 0
    def bow():
        d.line([tuple(S(*e1)), tuple(S(*arm)), tuple(S(*e2))], fill=(90, 60, 30), width=int(16 * big) * SS, joint='curve')
        d.line([tuple(S(*e1)), tuple(S(*back)), tuple(S(*e2))], fill=(240, 236, 220), width=3 * SS)
    if behind:
        bow()
    thick(d, back, front, 26 * big, WOOD[1], WOOD[2])
    hx, hy = vec(dname, 40 * big, 8)
    head = (front[0] + hx, front[1] + hy)
    thick(d, front, head, 14 * big, (230, 230, 240))
    ell(d, head[0], head[1], 16 * big, 16 * big, (255, 70, 50), (90, 20, 10), 3)
    if not behind:
        bow()


def archer_panel(d, dname, tier):
    fx, fy = 256, 440
    big = 1 + (tier - 1) * 0.1
    dx, dy = DIRS[dname]
    tunic = (60, 130, 70) if tier < 3 else (40, 110, 120)
    behind = dy < 0
    hand = (fx + dx * 50 * big, fy - 150 * big + dy * 30 * big * FORE)
    ax, ay = vec(dname, 120 * big, 10)
    tipp = (hand[0] + ax, hand[1] + ay)
    px, py = -dy, dx * FORE
    pl = math.hypot(px, py) or 1
    px, py = px / pl, py / pl
    def bow():
        e1 = (hand[0] + px * 70 * big, hand[1] + py * 70 * big)
        e2 = (hand[0] - px * 70 * big, hand[1] - py * 70 * big)
        mid = (hand[0] + ax * 0.25, hand[1] + ay * 0.25)
        d.line([tuple(S(*e1)), tuple(S(*mid)), tuple(S(*e2))], fill=(120, 74, 30), width=int(10 * big) * SS, joint='curve')
        d.line([tuple(S(*e1)), tuple(S(*e2))], fill=(240, 236, 220), width=2 * SS)
        d.line([tuple(S(hand[0] - ax * 0.3, hand[1] - ay * 0.3)), tuple(S(*tipp))], fill=(200, 170, 120), width=5 * SS)
        ell(d, tipp[0], tipp[1], 11 * big, 11 * big, (255, 70, 50), (90, 20, 10), 2)
    if behind:
        bow()
    d.rounded_rectangle(S(fx - 42 * big, fy - 150 * big, fx + 42 * big, fy), radius=20 * SS, fill=tunic, outline=(30, 60, 30), width=3 * SS)
    ell(d, fx, fy - 182 * big, 32 * big, 32 * big, (236, 196, 160), (110, 70, 50), 3)
    hood = (60, 120, 60) if tier < 3 else (30, 90, 100)
    d.pieslice(S(fx - 36 * big, fy - 222 * big, fx + 36 * big, fy - 150 * big), 180, 360, fill=hood)
    if not behind:
        bow()


PANELS = {'cannon': cannon_panel, 'ballista': ballista_panel, 'archer': archer_panel}


def turret(kind, tier):
    im, d = canvas(2560, 512)
    for i, dname in enumerate(DIRS):
        sub, sd = canvas(512, 512)
        PANELS[kind](sd, dname, tier)
        im.paste(sub, (i * 512 * SS, 0))
    return im.resize((2560, 512), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for kind in PANELS:
        for tier in (1, 2, 3):
            body(kind, tier).convert('RGB').save(OUT / f'{kind}-{tier}-body.png')
            turret(kind, tier).convert('RGB').save(OUT / f'{kind}-{tier}-turret.png')
            print('wrote', kind, tier)


if __name__ == '__main__':
    main()
