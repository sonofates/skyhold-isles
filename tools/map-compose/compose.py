#!/usr/bin/python3
"""Layered map compositor (mock / bake): ground textures + spline road + plots + props + towers.

usage: /usr/bin/python3 tools/map-compose/compose.py <layout.json> <assets_dir> <out.png> [--w 2560] [--plots 24] [--seed 7]
       [--grass tex-grass.png] [--towers archer:3,cannon:9,...] [--enemies]

layout.json = the editor's JSON (paths in image px of `imageSize`, safeArea). The road is rebuilt from
the polylines (Catmull-Rom smoothed) so it is crisp at any size and always matches the sim path.
Plots are generated along both sides of the road (or taken from layout.plots with --keep-plots) and
written next to the output as <out>.plots.json (in layout px) so the editor/sim can adopt them.
"""
import json, math, random, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

args = sys.argv[1:]
layout_p, assets, out_p = Path(args[0]), Path(args[1]), Path(args[2])
def opt(k, d):
    return type(d)(args[args.index(k) + 1]) if k in args else d
W = opt('--w', 2560)
NPLOTS = opt('--plots', 24)
SEED = opt('--seed', 7)
GRASS = opt('--grass', 'tex-grass.png')
TOWERS = opt('--towers', '')
random.seed(SEED)

L = json.loads(layout_p.read_text())
iw, ih = L['imageSize']
S = W / iw
H = round(ih * S)
P = lambda p: (p[0] * S, p[1] * S)


def load(name):
    p = assets / name
    return Image.open(p).convert('RGBA') if p.exists() else None


# ---------- ground ----------
def tiled(tex, w, h, scale):
    t = tex.resize((round(tex.width * scale), round(tex.height * scale)), Image.LANCZOS)
    out = Image.new('RGBA', (w, h))
    for y in range(0, h, t.height):
        for x in range(0, w, t.width):
            out.paste(t, (x, y))
    return out


def soft_noise(w, h, cell, seed):
    rnd = random.Random(seed)
    gw, gh = w // cell + 2, h // cell + 2
    small = Image.new('L', (gw, gh))
    small.putdata([rnd.randint(0, 255) for _ in range(gw * gh)])
    return small.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(cell * 0.35))


grass = load(GRASS)
grass_dark = load('tex-grass-dark.png') or grass
ground = tiled(grass, W, H, 0.55 * W / 2560)
dark = tiled(grass_dark, W, H, 0.55 * W / 2560)
mask = soft_noise(W, H, 260, SEED).point(lambda v: max(0, min(255, (v - 110) * 3)))
ground = Image.composite(dark, ground, mask)

# ---------- road (smoothed polylines → thick stroke) ----------
def catmull(pts, n=10):
    if len(pts) < 3:
        return pts
    out = []
    ext = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    out.append(pts[-1])
    return out


road_w = 0.068 * H
paths = [catmull([P(p) for p in path]) for path in L['paths']]
road_mask = Image.new('L', (W, H))
dr = ImageDraw.Draw(road_mask)
for path in paths:
    dr.line(path, fill=255, width=round(road_w), joint='curve')
    for x, y in (path[0], path[-1]):
        dr.ellipse((x - road_w / 2, y - road_w / 2, x + road_w / 2, y + road_w / 2), fill=255)
road_mask = road_mask.filter(ImageFilter.GaussianBlur(road_w * 0.04))
dirt = tiled(load('tex-dirt.png'), W, H, 0.45 * W / 2560)
# darker rim under the road (soft), then the dirt
rim = road_mask.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(road_w * 0.12))
shade = Image.new('RGBA', (W, H), (70, 52, 30, 255))
ground = Image.composite(shade, ground, rim.point(lambda v: int(v * 0.45)))
ground = Image.composite(dirt, ground, road_mask)

# ---------- plots ----------
def dist_to_paths(x, y):
    best = 1e9
    for path in paths:
        for i in range(0, len(path) - 1, 2):
            ax, ay = path[i]; bx, by = path[i + 1]
            vx, vy = bx - ax, by - ay
            t = max(0, min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy or 1)))
            d = math.hypot(ax + vx * t - x, ay + vy * t - y)
            best = min(best, d)
    return best


sx, sy, sw, sh = [v * S for v in L['safeArea']]
_g = P(L['goal'])
landmarks = [(*P((e['x'], e['y'])), road_w * 2.4) for e in L['entrances']] + [(_g[0] + road_w * 0.4, _g[1] - road_w * 0.4, road_w * 3.2)]
plot_r = road_w * 0.78
plots = []
if '--keep-plots' in args:
    plots = [P(p) for p in L['plots']]
else:
    cands = []
    for path in paths:
        acc = 0.0
        for i in range(1, len(path)):
            (ax, ay), (bx, by) = path[i - 1], path[i]
            seg = math.hypot(bx - ax, by - ay)
            acc += seg
            if acc < road_w * 0.7:
                continue
            acc = 0
            nx, ny = -(by - ay) / (seg or 1), (bx - ax) / (seg or 1)
            for side in (-1, 1):
                off = road_w * 0.5 + plot_r * 1.18
                cands.append((ax + nx * off * side, ay + ny * off * side))
    random.shuffle(cands)
    for c in cands:
        x, y = c
        if not (sx + plot_r < x < sx + sw - plot_r and sy + plot_r * 1.4 < y < sy + sh - plot_r * 2.2):
            continue
        if dist_to_paths(x, y) < road_w * 0.5 + plot_r * 1.05:
            continue
        if any(math.hypot(x - px, y - py) < plot_r * 2.5 for px, py in plots):
            continue
        if any(math.hypot(x - lx, y - ly) < lr for lx, ly, lr in landmarks):
            continue
        plots.append((x, y))
        if len(plots) >= NPLOTS:
            break

# ---------- sprites (depth sorted) ----------
items = []  # (sort_y, img, x_center, y_bottom)
def sprite(name, x, y_bottom, height_px, flip=False):
    im = load(name)
    if im is None:
        return
    s = height_px / im.height
    im = im.resize((max(1, round(im.width * s)), max(1, round(height_px))), Image.LANCZOS)
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    items.append((y_bottom, im, x, y_bottom))


base = load('plot-base.png')
base_w = plot_r * 2.15
tower_at = {}
for spec in filter(None, TOWERS.split(',')):
    t, i = spec.split(':')
    tower_at[int(i)] = t
s_base = base_w / base.width
bh = base.height * s_base
base_img = base.resize((round(base_w), round(bh)), Image.LANCZOS)
for i, (x, y) in enumerate(plots):
    bottom = y + bh / 2
    if i in tower_at:
        im = load(f'tower-{tower_at[i]}-1.png')
        if im is not None:
            # keyed tower sprites are trimmed: the shared stone base is the widest part and sits at the
            # bottom, so width = base width and bottom = plot bottom puts the tower exactly on the plot
            s = base_w / im.width
            items.append((bottom, im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS), x, bottom))
            continue
    items.append((y - 9999, base_img, x, bottom))

# landmarks
for e in L['entrances']:
    x, y = P((e['x'], e['y']))
    sprite('prop-gate-raider.png', x - road_w * 0.2, y + road_w * 0.7, road_w * 2.4)
gx, gy = P(L['goal'])
sprite('prop-castle-gate.png', gx + road_w * 0.4, gy + road_w * 0.9, road_w * 3.0)

# scatter props (Poisson-ish), away from road, plots, landmarks; fewer in the centre
occupied = [(x, y, plot_r * 1.6) for x, y in plots] + [(*P((e['x'], e['y'])), road_w * 2.2) for e in L['entrances']] + [(gx, gy, road_w * 2.6)]
props = [('prop-tree-1.png', 2.1), ('prop-tree-2.png', 2.4), ('prop-tree-3.png', 1.9), ('prop-bush.png', 1.0), ('prop-rock-1.png', 0.9), ('prop-rock-2.png', 0.8), ('prop-flowers.png', 0.55)]
weights = [5, 3, 2, 4, 2, 2, 2]
placed = []
tries = 0
while len(placed) < 70 and tries < 9000:
    tries += 1
    x, y = random.uniform(0, W), random.uniform(road_w * 0.4, H - road_w * 0.6)
    edge = min(x - sx, sx + sw - x) < 0 or min(x, W - x) < W * 0.12 or y < H * 0.12
    if not edge and random.random() < 0.75:  # keep the play area calm: most props on the margins
        continue
    if dist_to_paths(x, y) < road_w * 0.9:
        continue
    if any(math.hypot(x - ox, y - oy) < r for ox, oy, r in occupied):
        continue
    name, rel = random.choices(props, weights)[0]
    r = road_w * rel * 0.55
    if any(math.hypot(x - px, y - py) < (r + pr) * 0.9 for px, py, pr in placed):
        continue
    # a prop's canopy reaches up and sideways: keep its footprint + height clear of plots and the road
    if any(math.hypot(x - px, (y - r * 0.8) - py) < r + plot_r * 1.25 for px, py in plots):
        continue
    if dist_to_paths(x, y - r * 0.6) < road_w * 0.5 + r * 0.7:
        continue
    placed.append((x, y, r))
    sprite(name, x, y, road_w * rel, flip=random.random() < 0.5)
sprite('prop-windmill.png', W * 0.9, H * 0.22, road_w * 3.0)

if '--enemies' in args:
    ens = ['enemy-raider.png', 'enemy-brute.png', 'enemy-runner.png', 'enemy-warden.png', 'enemy-healer.png']
    for k, name in enumerate(ens):
        path = paths[k % len(paths)]
        x, y = path[int(len(path) * (0.25 + 0.12 * k))]
        sprite(name, x, y + road_w * 0.15, road_w * 1.15)

canvas = ground.copy()
# soft contact shadows first
shadow = Image.new('L', (W, H))
sd = ImageDraw.Draw(shadow)
for _, im, x, yb in items:
    rw = im.width * 0.42
    sd.ellipse((x - rw, yb - rw * 0.22, x + rw, yb + rw * 0.18), fill=95)
shadow = shadow.filter(ImageFilter.GaussianBlur(road_w * 0.12))
canvas = Image.composite(Image.new('RGBA', (W, H), (30, 40, 20, 255)), canvas, shadow.point(lambda v: int(v * 0.55)))
for _, im, x, yb in sorted(items, key=lambda t: t[0]):
    canvas.alpha_composite(im, (round(x - im.width / 2), round(yb - im.height)))

# bottom cliff band + sky under the island
cliff = load('tex-cliff.png') if '--cliff' in args else None
vig = Image.new('L', (W, H), 0)
vd = ImageDraw.Draw(vig)
vd.rectangle((0, 0, W, H), outline=255, width=round(H * 0.05))
vig = vig.filter(ImageFilter.GaussianBlur(H * 0.05))
canvas = Image.composite(Image.new('RGBA', (W, H), (40, 52, 30, 255)), canvas, vig.point(lambda v: int(v * 0.35)))
if cliff:
    band_h = round(H * 0.075)
    strip = tiled(cliff, W, band_h, band_h / cliff.height)
    edge_mask = soft_noise(W, band_h, 40, SEED + 3).point(lambda v: 255 if v > 70 else 0).filter(ImageFilter.GaussianBlur(2))
    canvas.paste(strip, (0, H - band_h), edge_mask)

canvas.convert('RGB').save(out_p, quality=92)
inv = [[round(x / S), round(y / S)] for x, y in plots]
Path(str(out_p) + '.plots.json').write_text(json.dumps(inv))
print(f'{out_p} {W}x{H} plots={len(plots)} props={len(placed)}')
