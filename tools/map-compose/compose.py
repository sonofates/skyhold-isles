#!/usr/bin/python3
"""Layered map compositor: tiled calm ground + spline road from the sim path + props + landmarks,
with generated build plots.

usage: /usr/bin/python3 tools/map-compose/compose.py <layout.json> <assets_dir> <out.png|.webp>
         [--w 3072] [--plots 24] [--seed 7] [--bake] [--keep-plots]
         [--towers archer:3,cannon:9,...] [--enemies] [--cliff]
         [--variants 1,1.5] [--write-layout] [--cave-h 2.5] [--castle-h 2.7] [--gate-inset 0.5]
         [--windmill x,ybottom,h] [--decals 240] [--no-decals]

  shipped L1c bake (2x layout px master + 1x / 1.5x variants, gate fronts, gates written to the JSON):
    /usr/bin/python3 tools/map-compose/compose.py src/data/levels2d/l1c.json design/art-2d/v2/assets \\
      public/art2d/map-L1c-layered.webp --bake --keep-plots --w 3692 --variants 1,1.5 --write-layout
  (gate / decal art: tools/map-compose/prep_gates.py keys the Codex renders into assets/)

  --bake        BACKGROUND ONLY (ground, road, props, landmarks). Plots are NOT painted: the game
                draws them (plot-base sprite) and the towers on them. Use this for the shipped map.
  --keep-plots  take the plots from layout.json instead of generating them (re-bakes keep the
                sim's plot indices stable). The rules below are still checked.
  --variants    also write <out stem>@<s>x.<ext> at s x the layout size (src/render2d/mapVariant.ts
                loads the smallest that covers the screen; the master is the --w bake).
  --write-layout  write each gate (prop, facing, front layer rect / depth) into layout.json
                (entrances[i].gate, goalGate) — see src/data/levels2d/gates.ts.
  (mock mode)   without --bake the plots (and --towers / --enemies) are painted in, for design mocks.

Gates (gates.py): a raider cave at every entrance with its mouth facing along the road's first
segment, the castle gate at the goal facing back along the last one; the path end sits inside the
dark mouth. Each gate's FRONT layer (rock lip / arch + mouth shading) is cut from the final
composite into <out stem>-gate-<id>.webp; the renderer draws it above the walkers.
Crisp ground (ground.py): fine brush detail, a ragged crisp road edge with a thin dark rim, grass
fringe and pebbles, sparse decals (assets/decal-*.png).

Everything geometric is computed in LAYOUT px (layout.json `imageSize`), so the plots and the
prop layout do not depend on --w; the bake is rendered at --w px wide (keep the aspect).
Writes <out>.plots.json: the plots in layout px, in route order (entrance A branch, entrance B
branch, shared road to the gate).

Plot footprint (shared with the renderer): the plot sprite (plot-base.png) is drawn
2 * plotRadiusPx wide (layout px), centred on the plot point (anchor 0.5, 0.5); its height follows
the sprite's aspect. A tower stands on it with the same width and the same bottom edge.

Plot rules (checked, the script exits non-zero when any fails):
  * exactly --plots plots, inside the safe area with margins, clear of the HUD corners and horn
  * the plot ring clears the road (road half-width + rim margin, elliptical footprint)
  * the plot centre is within REACH px of the road centreline (inside every tower's range,
    including the barracks rally radius)
  * no plot ring (or the tower that will stand on it) overlaps a landmark (gates, castle, windmill)
  * plots do not overlap each other, and a plot is not hidden behind the tower in front of it
  * every route section has plots: >= 2 on the first stretch from each entrance (first 40% of its
    branch or 350 px, whichever is longer), >= 2 at the merge, >= 2 on the last quarter to the gate
Selection: candidates hug the road on both sides (closest offset that clears it); a farthest-point
pass (anisotropic, light bonus for covering more road) spreads them evenly along the whole route.
The road itself is a Catmull-Rom spline THROUGH the sim polyline vertices; the max deviation from
the polyline (what enemies walk) is printed and checked.
"""
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
from gates import (  # noqa: E402
    cut_front, entrance_dir, entrance_facing, gate_alpha_hit, goal_dir, goal_facing, output_box, output_sprite, place_gate, resolve_prop,
)
from ground import Decals, fine_detail, inner_band, nearest_dist, ragged_mask, ring, road_fringe, scatter  # noqa: E402
from ringfit import measure_ring  # noqa: E402

args = sys.argv[1:]
layout_p, assets, out_p = Path(args[0]), Path(args[1]), Path(args[2])


def opt(k, d):
    return type(d)(args[args.index(k) + 1]) if k in args else d


W = opt('--w', 3072)
NPLOTS = opt('--plots', 24)
SEED = opt('--seed', 7)
GRASS = opt('--grass', 'tex-grass.png')
TOWERS = opt('--towers', '')
BAKE = '--bake' in args
random.seed(SEED)

L = json.loads(layout_p.read_text())
iw, ih = L['imageSize']
S = W / iw  # layout px -> output px
H = round(ih * S)


def load(name):
    p = assets / name
    return Image.open(p).convert('RGBA') if p.exists() else None


# ---------------------------------------------------------------- geometry (layout px)
ROAD_W = 0.068 * ih  # road width
PLOT_R = float(L.get('plotRadiusPx', 48))  # plot sprite half-width
base_img_src = load('plot-base.png')
PLOT_RY = PLOT_R * base_img_src.height / base_img_src.width  # plot sprite half-height
RIM = 9.0  # extra clearance for the road's dark rim
REACH = 135.0  # max plot-centre distance to the road centreline (barracks rally radius = 160)
# How far the tallest tower (beacon T3: 2.25 x its ring width tall) reaches above the plot centre:
# keeps every tier fully on the map at the top edge and clear of landmarks / props.
TOWER_UP = 180.0
# A tower in front must not bury the plot behind it: plots stacked within this |dx| need BURY_DY of
# vertical room (a T1 tower then just reaches the back plot's centre; T2/T3 overlap like any 3/4 TD).
BURY_DX, BURY_DY = 0.8 * 2 * PLOT_R, 100.0


def catmull(pts, n=12):
    if len(pts) < 3:
        return list(pts)
    out = []
    ext = [pts[0]] + list(pts) + [pts[-1]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    out.append(tuple(pts[-1]))
    return out


def resample(poly, step):
    """Evenly spaced points along a polyline (keeps the end points)."""
    out = [poly[0]]
    carry = 0.0
    for i in range(1, len(poly)):
        ax, ay = poly[i - 1]
        bx, by = poly[i]
        seg = math.hypot(bx - ax, by - ay)
        d = step - carry
        while d <= seg:
            t = d / seg
            out.append((ax + (bx - ax) * t, ay + (by - ay) * t))
            d += step
        carry = seg - (d - step)
    out.append(poly[-1])
    return out


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy or 1)))
    return math.hypot(ax + vx * t - px, ay + vy * t - py)


raw_paths = [[tuple(map(float, p)) for p in path] for path in L['paths']]
spl_paths = [catmull(p) for p in raw_paths]
road_pts = [q for p in spl_paths for q in resample(p, 4.0)] + [q for p in raw_paths for q in resample(p, 4.0)]


def dist_to_road(x, y):
    """Distance to the road centreline (spline AND sim polyline, whichever is closer)."""
    best = 1e9
    for poly in spl_paths + raw_paths:
        for i in range(len(poly) - 1):
            d = seg_dist(x, y, *poly[i], *poly[i + 1])
            if d < best:
                best = d
    return best


def ellipse_clears_road(x, y, rx, ry):
    """True when the ellipse (rx, ry) grown by the road half-width + rim touches no road point."""
    ax, ay = rx + ROAD_W / 2 + RIM, ry + ROAD_W / 2 + RIM
    for qx, qy in road_pts:
        dx, dy = (qx - x) / ax, (qy - y) / ay
        if dx * dx + dy * dy < 1:
            return False
    return True


# spline vs sim polyline deviation (enemies walk the polyline)
dev = 0.0
for sp, rp in zip(spl_paths, raw_paths):
    for q in resample(sp, 6.0):
        dev = max(dev, min(seg_dist(*q, *rp[i], *rp[i + 1]) for i in range(len(rp) - 1)))

# ---------------------------------------------------------------- landmarks + exclusions (layout px)
sx, sy, sw, sh = L['safeArea']
gx, gy = L['goal']


def sprite_rect(im, x_center, y_bottom, height):
    w = height * im.width / im.height
    return (x_center - w / 2, y_bottom - height, x_center + w / 2, y_bottom)


# Gates (gates.py): a raider cave at every entrance whose mouth faces along the road's first
# segment, the castle gate at the goal facing back along the last segment. The path end sits
# GATE_INSET road widths inside the dark mouth, so walkers appear out of the darkness (front layer).
CAVE_H, CASTLE_H, GATE_INSET = opt('--cave-h', 2.5), opt('--castle-h', 2.7), opt('--gate-inset', 0.5)
GATES = []  # dict(role, lane, id, prop, facing, g = placement)
for _i, _e in enumerate(L['entrances']):
    _f = entrance_facing(raw_paths[_i])
    _prop, _file, _flip = resolve_prop('cave', _f, assets)
    _g = place_gate(load(_file), _flip, (_e['x'], _e['y']), _f, ROAD_W * CAVE_H, ROAD_W * GATE_INSET, entrance_dir(raw_paths[_i]))
    GATES.append({'role': 'entrance', 'lane': _i, 'id': str(_e['id']), 'prop': _prop, 'facing': _f, 'g': _g})
_f = goal_facing(raw_paths[0])
_prop, _file, _flip = resolve_prop('castle', _f, assets)
_g = place_gate(load(_file), _flip, (gx, gy), _f, ROAD_W * CASTLE_H, ROAD_W * GATE_INSET, goal_dir(raw_paths[0]))
GATES.append({'role': 'goal', 'lane': -1, 'id': 'goal', 'prop': _prop, 'facing': _f, 'g': _g})

LANDMARKS = []  # (name, layout x centre, layout y bottom, layout height)
MILL = [float(v) for v in opt('--windmill', '1609,298,2.7').split(',')]  # x centre, y bottom, height / ROAD_W
LANDMARKS.append(('prop-windmill.png', MILL[0], MILL[1], ROAD_W * MILL[2]))
landmark_rects = [sprite_rect(load(n), x, yb, h) for n, x, yb, h in LANDMARKS] + [G['g']['rect'] for G in GATES]


def landmark_hit(rect, pad):
    """Rect (layout px) touches a landmark: the windmill by its rect, gates by their painted pixels
    (their bounding boxes are mostly empty corners)."""
    if any(rects_hit(rect, r, pad) for r in landmark_rects[:len(LANDMARKS)]):
        return True
    return any(gate_alpha_hit(G['g'], rect, 0) for G in GATES)  # exact painted pixels: no pad

# Screen-space HUD lands on these map corners (lives plaque bottom-left, wave banner bottom-right,
# pause/speed top-right, horn between the entrances). Measured at both extreme fits and unioned,
# layout px (+10 px margin): desktop 16:9 (1600x900: map cropped to the safe area, plaque reaches
# x 460 / y 757) and phone landscape (915x412: height-fit, bigger relative HUD).
HUD_RECTS = [
    (0, 740, 480, ih), (0, 702, 420, ih),  # lives plaque: desktop, phone
    (1400, 745, iw, ih), (1510, 690, iw, ih),  # wave banner: desktop, phone
    (1470, 0, iw, 115), (1590, 0, iw, 135),  # pause / speed: desktop, phone
]
ex_m = sum(e['x'] for e in L['entrances']) / len(L['entrances'])
ey_m = sum(e['y'] for e in L['entrances']) / len(L['entrances'])
HORN = (ex_m + 18, ey_m + 4, 64)  # horn button (radius) ...
HUD_RECTS.append((HORN[0] - 56, HORN[1] + 52, HORN[0] + 56, HORN[1] + 100))  # ... and its label


def rects_hit(a, b, pad=0.0):
    return a[0] - pad < b[2] and b[0] - pad < a[2] and a[1] - pad < b[3] and b[1] - pad < a[3]


def plot_zone(x, y):
    """Plot ring + the tower that may stand on it (layout px rect)."""
    return (x - PLOT_R, y - TOWER_UP, x + PLOT_R, y + PLOT_RY)


def plot_ok(x, y):
    """Single-plot rules (safe area, HUD, road clearance and reach, landmarks). Returns a reason or ''."""
    if not (sx + PLOT_R + 6 <= x <= sx + sw - PLOT_R - 6 and sy + TOWER_UP + 6 <= y <= sy + sh - PLOT_RY - 14):
        return 'safe area'
    ring = (x - PLOT_R, y - PLOT_RY, x + PLOT_R, y + PLOT_RY)
    if any(rects_hit(ring, r) for r in HUD_RECTS):
        return 'hud'
    if math.hypot(x - HORN[0], y - HORN[1]) < HORN[2] + PLOT_R:
        return 'horn'
    if landmark_hit(plot_zone(x, y), 8):
        return 'landmark'
    if dist_to_road(x, y) > REACH:
        return 'reach'
    if not ellipse_clears_road(x, y, PLOT_R, PLOT_RY):
        return 'road'
    return ''


def pair_ok(a, b):
    dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
    # rings apart (elliptical) ...
    if (dx / (2 * PLOT_R + 14)) ** 2 + (dy / (2 * PLOT_RY + 12)) ** 2 < 1:
        return False
    # ... and the tower in front does not bury the plot behind it
    if dx < BURY_DX and dy < BURY_DY:
        return False
    return True


# route sections: A branch (path 0 until it joins path 1), B branch, shared trunk
def merge_index(p0, p1):
    s1 = set(p1)
    for i, q in enumerate(p0):
        if q in s1 and p0[i:] == p1[p1.index(q):]:
            return i, p1.index(q)
    return len(p0) - 1, len(p1) - 1


mi0, mi1 = merge_index(raw_paths[0], raw_paths[1]) if len(raw_paths) > 1 else (len(raw_paths[0]) - 1, 0)
SECTIONS = {'A': raw_paths[0][:mi0 + 1], 'trunk': raw_paths[0][mi0:]}
if len(raw_paths) > 1:
    SECTIONS['B'] = raw_paths[1][:mi1 + 1]
MERGE = raw_paths[0][mi0]


def poly_len(p):
    return sum(math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) for i in range(len(p) - 1))


def section_of(x, y):
    """Nearest section (and arc position along it) of a point."""
    best = (1e9, 'A', 0.0)
    for name, poly in SECTIONS.items():
        acc = 0.0
        for i in range(len(poly) - 1):
            (ax, ay), (bx, by) = poly[i], poly[i + 1]
            seg = math.hypot(bx - ax, by - ay)
            vx, vy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy or 1)))
            d = math.hypot(ax + vx * t - x, ay + vy * t - y)
            if d < best[0]:
                best = (d, name, acc + seg * t)
            acc += seg
    return best[1], best[2]


ORDER = {'A': 0, 'B': 1, 'trunk': 2}


def route_key(p):
    name, arc = section_of(*p)
    return (ORDER[name], arc)


def coverage(x, y, rng=240.0):
    """Road length (layout px) within `rng` of the point (a cannon-ish range)."""
    return sum(4.0 for q in road_pts[:len(road_pts) // 2] if math.hypot(q[0] - x, q[1] - y) <= rng)


# ---------------------------------------------------------------- plots
def generate_plots():
    cands = []
    for poly in raw_paths:
        pts = resample(catmull(poly), 10.0)
        for i in range(1, len(pts) - 1):
            (ax, ay), (bx, by) = pts[i - 1], pts[i + 1]
            seg = math.hypot(bx - ax, by - ay) or 1
            nx, ny = -(by - ay) / seg, (bx - ax) / seg
            for side in (-1, 1):
                off = 52.0
                while off <= REACH:
                    # integer layout px: what l1c.json stores, so a --keep-plots re-bake checks the same points
                    x, y = float(round(pts[i][0] + nx * off * side)), float(round(pts[i][1] + ny * off * side))
                    if plot_ok(x, y) == '':
                        cands.append((x, y))
                        break
                    off += 4.0
    # dedupe (shared trunk is sampled twice)
    uniq = []
    for c in cands:
        if all(math.hypot(c[0] - u[0], c[1] - u[1]) > 6 for u in uniq):
            uniq.append(c)
    cov = [coverage(*c) for c in uniq]
    cmax = max(cov) or 1
    jit = random.Random(SEED)
    score_bias = [1 + 0.22 * (v / cmax) + jit.random() * 1e-3 for v in cov]

    def adist(a, b):
        return math.hypot(a[0] - b[0], (a[1] - b[1]) * 1.25)

    chosen = []
    mind = [1e9] * len(uniq)

    def take(bi):
        chosen.append(uniq[bi])
        for i, c in enumerate(uniq):
            mind[i] = min(mind[i], adist(c, uniq[bi]))

    # seeds: the valid candidates nearest each entrance and nearest the point 300 px down its road
    # (the farthest-point pass alone tends to leave the cramped first stretch next to a gate thin)
    for path in raw_paths:
        pts = resample(path, 10.0)
        for e0 in (pts[0], pts[min(len(pts) - 1, 30)]):
            order = sorted(range(len(uniq)), key=lambda i: math.hypot(uniq[i][0] - e0[0], uniq[i][1] - e0[1]))
            for i in order:
                if all(pair_ok(uniq[i], p) for p in chosen):
                    take(i)
                    break
    while len(chosen) < NPLOTS:
        best, bi = -1.0, -1
        for i, c in enumerate(uniq):
            if mind[i] <= 0 or not all(pair_ok(c, p) for p in chosen):
                continue
            s = mind[i] * score_bias[i]
            if s > best:
                best, bi = s, i
        if bi < 0:
            break
        take(bi)
    return sorted(chosen, key=route_key), len(uniq)


if '--keep-plots' in args:
    plots = [tuple(map(float, p)) for p in L['plots']]
    ncand = 0
else:
    plots, ncand = generate_plots()

# ---------------------------------------------------------------- checks
fails = []
if len(plots) != NPLOTS:
    fails.append(f'{len(plots)} plots, wanted {NPLOTS}')
for i, p in enumerate(plots):
    r = plot_ok(*p)
    if r:
        fails.append(f'plot {i} {tuple(round(v) for v in p)}: {r}')
for i in range(len(plots)):
    for j in range(i + 1, len(plots)):
        if not pair_ok(plots[i], plots[j]):
            fails.append(f'plots {i} and {j} overlap')
counts = {k: 0 for k in SECTIONS}
for p in plots:
    counts[section_of(*p)[0]] += 1
trunk_len = poly_len(SECTIONS['trunk'])
near_entrance = {k: 0 for k in SECTIONS if k != 'trunk'}
merge_n = last_n = 0
for p in plots:
    name, arc = section_of(*p)
    if name in near_entrance and arc < max(poly_len(SECTIONS[name]) * 0.4, 350.0):
        near_entrance[name] += 1
    if math.hypot(p[0] - MERGE[0], p[1] - MERGE[1]) < 230:
        merge_n += 1
    if name == 'trunk' and arc > trunk_len * 0.75:
        last_n += 1
for k, n in near_entrance.items():
    if n < 2:
        fails.append(f'only {n} plots on the first stretch from entrance {k}')
if merge_n < 2:
    fails.append(f'only {merge_n} plots at the merge')
if last_n < 2:
    fails.append(f'only {last_n} plots on the last stretch')
if dev > ROAD_W * 0.3:
    fails.append(f'spline deviates {dev:.1f} px from the sim polyline (> 30% of the road width)')
# Landmarks must not be cut by the screen edge at 16:9 (the safe area is exactly what a 16:9 / 16:10
# screen shows) nor sit under the HUD. Entrance caves may bleed a little past the left / right edge
# (a rock mound running off-screen reads fine); their mouth must be on screen.
warns = []
for (n, x, yb, h), r in zip(LANDMARKS, landmark_rects):
    if r[0] < sx or r[2] > sx + sw or r[1] < sy or r[3] > sy + sh:
        fails.append(f'{n} rect {tuple(round(v) for v in r)} leaves the safe area')
    if any(rects_hit(r, z) for z in HUD_RECTS[:6]):
        fails.append(f'{n} rect {tuple(round(v) for v in r)} is under the HUD')
for G in GATES:
    r = G['g']['rect']
    out = max(sx - r[0], r[2] - (sx + sw), sy - r[1], r[3] - (sy + sh), 0)
    if G['role'] == 'goal' and out > 0:
        fails.append(f'castle gate rect {tuple(round(v) for v in r)} leaves the safe area by {out:.0f} px')
    elif out > ROAD_W * 0.6:
        fails.append(f'gate {G["id"]} rect {tuple(round(v) for v in r)} leaves the safe area by {out:.0f} px')
    elif out > 0:
        warns.append(f'gate {G["id"]} bleeds {out:.0f} px past the safe area')
    if any(rects_hit(r, z) for z in HUD_RECTS[:6]):
        fails.append(f'gate {G["id"]} rect {tuple(round(v) for v in r)} is under the HUD')
gaps = [min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in plots if q is not p) for p in plots]
reach = [dist_to_road(*p) for p in plots]

# ---------------------------------------------------------------- ground (output px)
def tiled(tex, w, h, scale):
    t = tex.resize((max(1, round(tex.width * scale)), max(1, round(tex.height * scale))), Image.LANCZOS)
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


P = lambda p: (p[0] * S, p[1] * S)
rw = ROAD_W * S
TEX = W / 2560  # texture scale reference: the approved mock was 2560 px wide
grass = load(GRASS)
grass_dark = load('tex-grass-dark.png') or grass
ground = tiled(grass, W, H, 0.55 * TEX)
dark = tiled(grass_dark, W, H, 0.55 * TEX)
mask = soft_noise(W, H, round(260 * TEX), SEED).point(lambda v: max(0, min(255, (v - 110) * 3)))
ground = Image.composite(dark, ground, mask)
# very soft, large light patches: breaks the tiling without adding detail
light = soft_noise(W, H, round(420 * TEX), SEED + 11).point(lambda v: max(0, min(255, (v - 150) * 2)))
ground = Image.composite(Image.new('RGBA', (W, H), (196, 214, 120, 255)), ground, light.point(lambda v: int(v * 0.10)))
# crisp painted detail: the high-pass of a finer tiling of the same grass (brush strokes at ~1/3
# the scale), luminance only -> sharper at 100% without new colours or busier large shapes
ground = fine_detail(ground, grass, round(1024 * 0.2 * TEX), 0.55, 9 * TEX)

# ---------------------------------------------------------------- road
road_hard = Image.new('L', (W, H))
dr = ImageDraw.Draw(road_hard)
for path in spl_paths:
    pts = [P(p) for p in path]
    dr.line(pts, fill=255, width=round(rw), joint='curve')
    for x, y in (pts[0], pts[-1]):
        dr.ellipse((x - rw / 2, y - rw / 2, x + rw / 2, y + rw / 2), fill=255)
# crisp, slightly irregular painted edge (was a ~10-25 px Gaussian ramp: the main "blurry" cue)
road_mask = ragged_mask(road_hard, rw * 0.05, max(4, round(rw * 0.16)), 0.22, SEED + 21, aa=1.1 * W / 3692)
dirt = tiled(load('tex-dirt.png'), W, H, 0.45 * TEX)
dirt = fine_detail(dirt, load('tex-dirt.png'), round(1024 * 0.16 * TEX), 0.45, 7 * TEX)
# a faint wide shade on the grass along the road, a thin darker rim right at the edge, the dirt,
# then a narrow darker lip just inside the edge
shade = road_mask.filter(ImageFilter.MaxFilter(2 * round(rw * 0.05) + 1)).filter(ImageFilter.GaussianBlur(rw * 0.10))
ground = Image.composite(Image.new('RGBA', (W, H), (70, 52, 30, 255)), ground, shade.point(lambda v: int(v * 0.22)))
rim_band = ring(road_mask, max(2, round(rw * 0.035)), 0.7 * W / 3692)
ground = Image.composite(Image.new('RGBA', (W, H), (74, 70, 30, 255)), ground, rim_band.point(lambda v: int(v * 0.50)))
ground = Image.composite(dirt, ground, road_mask)
lip = inner_band(road_mask, max(2, round(rw * 0.06)), 1.2 * W / 3692)
ground = Image.composite(Image.new('RGBA', (W, H), (122, 80, 42, 255)), ground, lip.point(lambda v: int(v * 0.30)))

# ---------------------------------------------------------------- crisp painted details
decals = Decals(load)
fringe_n = scatter_n = None
if decals.ok and '--no-decals' not in args:
    road_np = np.array([q for p in spl_paths for q in resample(p, 3.0)])
    edge_polys = [resample(p, 4.0) for p in spl_paths]
    fringe_n = road_fringe(ground, decals, edge_polys, road_np, ROAD_W / 2, S, SEED + 31)
    plot_ells = [(px, py) for px, py in plots]

    def decal_ok(x, y, r):
        if nearest_dist(road_np, x, y) < ROAD_W / 2 + r + 2:
            return False
        for px, py in plot_ells:
            if ((x - px) / (PLOT_R + r)) ** 2 + ((y - py) / (PLOT_RY + r)) ** 2 < 1:
                return False
        return not any(rects_hit((x - r, y - r, x + r, y + r), z, 4) for z in landmark_rects)

    scatter_n = scatter(ground, decals, iw, ih, decal_ok, S, SEED + 41, n=opt('--decals', 240))

# ---------------------------------------------------------------- sprites (depth sorted)
items = []  # (sort_y, img, x_center, y_bottom, shadow)


def sprite(name, x, y_bottom, height_px, flip=False, shadow=True):
    im = load(name)
    if im is None:
        return
    s = height_px / im.height
    im = im.resize((max(1, round(im.width * s)), max(1, round(height_px))), Image.LANCZOS)
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    items.append((y_bottom, im, x, y_bottom, shadow))


if not BAKE:
    # --towers <file stem>:<plot>,...  e.g. t3-archer-2:3 (looked up in assets/, then design/art-2d/v2/out/)
    tower_at = {}
    for spec in filter(None, TOWERS.split(',')):
        t, i = spec.rsplit(':', 1)
        tower_at[int(i)] = t
    base_w = 2 * PLOT_R * S
    bh = base_img_src.height * base_w / base_img_src.width
    base_img = base_img_src.resize((round(base_w), round(bh)), Image.LANCZOS)
    plot_ring = measure_ring(base_img_src)
    k_plot = base_w / base_img_src.width
    for i, p in enumerate(plots):
        x, y = P(p)
        top = y - bh / 2
        im = None
        if i in tower_at:
            for d in (assets, assets.parent / 'out'):
                if (d / f'{tower_at[i]}.png').exists():
                    im = Image.open(d / f'{tower_at[i]}.png').convert('RGBA')
                    break
        if im is not None:
            # the fit rule (same as src/render2d/towerFit.ts): scale so the tower's measured stone
            # ring is as wide as the plot sprite's ring, ring bottom-centre on the plot's ring bottom-centre
            r = measure_ring(im)
            s_t = plot_ring['ringWidthPx'] * k_plot / r['ringWidthPx']
            ring_cx = x - base_w / 2 + plot_ring['ringCenterXPx'] * k_plot
            ring_by = top + plot_ring['ringBottomPx'] * k_plot
            t_im = im.resize((round(im.width * s_t), round(im.height * s_t)), Image.LANCZOS)
            left = ring_cx - r['ringCenterXPx'] * s_t
            topt = ring_by - r['ringBottomPx'] * s_t
            items.append((ring_by, t_im, left + t_im.width / 2, topt + t_im.height, True))
        else:
            items.append((y - 9999, base_img, x, top + bh, False))

for n, x, yb, h in LANDMARKS:
    sprite(n, x * S, yb * S, h * S)
for G in GATES:
    gx0, gy0, gw_, gh_ = output_box(G['g'], S)
    items.append((gy0 + gh_, output_sprite(G['g'], S), gx0 + gw_ / 2, gy0 + gh_, True))

# scatter props (layout px), mostly on the margins, never on the road / plots / towers / landmarks
PROPS = [('prop-tree-1.png', 2.1), ('prop-tree-2.png', 2.4), ('prop-tree-3.png', 1.9), ('prop-bush.png', 1.0),
         ('prop-rock-1.png', 0.9), ('prop-rock-2.png', 0.8), ('prop-flowers.png', 0.55)]
WEIGHTS = [5, 3, 2, 4, 2, 2, 2]
prop_ims = {n: load(n) for n, _ in PROPS}
rnd = random.Random(SEED)
placed = []
tries = 0
zones = [plot_zone(*p) for p in plots] + landmark_rects
while len(placed) < 70 and tries < 12000:
    tries += 1
    x, y = rnd.uniform(0, iw), rnd.uniform(ROAD_W * 0.4, ih - ROAD_W * 0.6)
    margin = x < sx or x > sx + sw or min(x, iw - x) < iw * 0.12 or y < ih * 0.12
    if not margin and rnd.random() < 0.75:  # keep the play area calm
        continue
    name, rel = rnd.choices(PROPS, WEIGHTS)[0]
    h = ROAD_W * rel
    rect = sprite_rect(prop_ims[name], x, y, h)
    foot = (rect[0] + (rect[2] - rect[0]) * 0.2, rect[1] + (rect[3] - rect[1]) * 0.1, rect[2] - (rect[2] - rect[0]) * 0.2, rect[3])
    if any(rects_hit(foot, z, 6) for z in zones):
        continue
    if any(rects_hit(foot, p[1], -4) for p in placed):
        continue
    cx, cy = (foot[0] + foot[2]) / 2, (foot[1] + foot[3]) / 2
    half = max(foot[2] - foot[0], foot[3] - foot[1]) / 2
    if dist_to_road(cx, cy) < ROAD_W / 2 + half + 6:
        continue
    placed.append((name, foot))
    sprite(name, x * S, y * S, h * S, flip=rnd.random() < 0.5)

if '--enemies' in args and not BAKE:
    ens = ['enemy-raider.png', 'enemy-brute.png', 'enemy-runner.png', 'enemy-warden.png', 'enemy-healer.png']
    for k, name in enumerate(ens):
        path = spl_paths[k % len(spl_paths)]
        x, y = P(path[int(len(path) * (0.25 + 0.12 * k))])
        sprite(name, x, y + rw * 0.15, rw * 1.15)

canvas = ground.copy()
shadow = Image.new('L', (W, H))
sd = ImageDraw.Draw(shadow)
for _, im, x, yb, sh_on in items:
    if not sh_on:
        continue
    r = im.width * 0.42
    sd.ellipse((x - r, yb - r * 0.22, x + r, yb + r * 0.18), fill=95)
shadow = shadow.filter(ImageFilter.GaussianBlur(rw * 0.12))
canvas = Image.composite(Image.new('RGBA', (W, H), (30, 40, 20, 255)), canvas, shadow.point(lambda v: int(v * 0.55)))
for _, im, x, yb, _s in sorted(items, key=lambda t: t[0]):
    canvas.alpha_composite(im, (round(x - im.width / 2), round(yb - im.height)))

vig = Image.new('L', (W, H), 0)
ImageDraw.Draw(vig).rectangle((0, 0, W, H), outline=255, width=round(H * 0.05))
vig = vig.filter(ImageFilter.GaussianBlur(H * 0.05))
canvas = Image.composite(Image.new('RGBA', (W, H), (40, 52, 30, 255)), canvas, vig.point(lambda v: int(v * 0.35)))
cliff = load('tex-cliff.png') if '--cliff' in args else None
if cliff:
    band_h = round(H * 0.075)
    strip = tiled(cliff, W, band_h, band_h / cliff.height)
    edge_mask = soft_noise(W, band_h, 40, SEED + 3).point(lambda v: 255 if v > 70 else 0).filter(ImageFilter.GaussianBlur(2))
    canvas.paste(strip, (0, H - band_h), edge_mask)

rgb = canvas.convert('RGB')
if out_p.suffix.lower() == '.webp':
    rgb.save(out_p, quality=90, method=6)
else:
    rgb.save(out_p, quality=92)
inv = [[round(x), round(y)] for x, y in plots]
Path(str(out_p) + '.plots.json').write_text(json.dumps(inv))

# resolution variants (mapVariant.ts): <stem>@<scale>x, texture width = scale x layout width
variant_files = {}
for v in filter(None, opt('--variants', '').split(',')):
    vs = float(v)
    vw, vh = round(iw * vs), round(ih * vs)
    vp = out_p.with_name(f'{out_p.stem}@{v}x{out_p.suffix}')
    rgb.resize((vw, vh), Image.LANCZOS).save(vp, quality=90, method=6)
    variant_files[f'{out_p.stem}@{v}x'] = vp.name

# gate front layers, cut from the final composite (same pixels as the bake underneath)
gate_json = []
for G in GATES:
    front_im, (fx, fy) = cut_front(canvas, G['g'], S, exit_cut=G['role'] == 'entrance')
    entry = {'prop': G['prop'], 'facing': G['facing'], 'front': None}
    if front_im is not None:
        key = f'{out_p.stem}-gate-{G["id"]}'
        fp = out_p.with_name(f'{key}.webp')
        front_im.save(fp, quality=90, method=6, exact=True)
        gr = G['g']['rect']
        entry['front'] = {
            'art': key,
            'rect': [round(fx / S, 2), round(fy / S, 2), round(front_im.width / S, 2), round(front_im.height / S, 2)],
            # depth key: the gate's front ground line (its sprite bottom), layout px
            'baseY': round(gr[3], 2),
        }
        G['file'] = fp.name
    G['json'] = entry
    gate_json.append({'role': G['role'], 'lane': G['lane'], **entry})
Path(str(out_p) + '.gates.json').write_text(json.dumps(gate_json, indent=1))
if '--write-layout' in args:
    for G in GATES:
        if G['role'] == 'entrance':
            L['entrances'][G['lane']]['gate'] = G['json']
        else:
            L['goalGate'] = G['json']
    layout_p.write_text(json.dumps(L, indent=1))
for k, f in variant_files.items():
    print(f'  variant {k} -> {f}')
for G in GATES:
    fr = G['json']['front']
    print(f'  gate {G["id"]}: {G["prop"]} facing {G["facing"]} rect {tuple(round(v) for v in G["g"]["rect"])}'
          f' front {G.get("file")} {fr["rect"] if fr else None}')
if fringe_n:
    print(f'  road fringe tufts {fringe_n[0]} pebbles {fringe_n[1]}; decals {scatter_n}')
for w_ in warns:
    print('  warning: ' + w_)

print(f'{out_p} {W}x{H} mode={"bake" if BAKE else "mock"} plots={len(plots)} (candidates {ncand}) props={len(placed)}')
print(f'  plot footprint {2 * PLOT_R:.0f}x{2 * PLOT_RY:.0f} layout px, road width {ROAD_W:.1f}, spline deviation {dev:.1f} px')
print(f'  sections {counts}  first-stretch {near_entrance}  merge {merge_n}  last-stretch {last_n}')
if plots:
    print(f'  nearest-neighbour gap min {min(gaps):.0f} / median {sorted(gaps)[len(gaps) // 2]:.0f} / max {max(gaps):.0f} px; '
          f'road reach max {max(reach):.0f} px (limit {REACH:.0f})')
if fails:
    print('PLOT RULES FAILED:\n  ' + '\n  '.join(fails))
    sys.exit(1)
