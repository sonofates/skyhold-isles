#!/usr/bin/python3
"""Layered map compositor: tiled calm ground + spline road from the sim path + props + landmarks,
with generated build plots.

usage: /usr/bin/python3 tools/map-compose/compose.py <layout.json> <assets_dir> <out.png|.webp>
         [--biome name] [--w 3072] [--plots 24] [--seed 7] [--bake] [--keep-plots]
         [--towers archer:3,cannon:9,...] [--enemies] [--cliff]
         [--variants 1,1.5] [--3x] [--write-layout] [--cave-h 2.5] [--castle-h 2.7] [--gate-inset 0.5]
         [--quality 0..100] [--windmill x,ybottom,h|none] [--props 70] [--decals 240] [--no-decals] [--check-plots]

  shipped L1c master and smaller variants (follow with the --3x pass below):
    /usr/bin/python3 tools/map-compose/compose.py src/data/levels2d/l1c.json design/art-2d/v2/assets \\
      public/art2d/map-L1c-layered.webp --bake --keep-plots --w 3692 --variants 1,1.5 --write-layout
    /usr/bin/python3 tools/map-compose/compose.py src/data/levels2d/l1c.json design/art-2d/v2/assets \\
      public/art2d/map-L1c-layered.webp --bake --keep-plots --3x
  (gate / decal art: tools/map-compose/prep_gates.py keys the Codex renders into assets/)

  --bake        BACKGROUND ONLY (ground, road, props, landmarks). Plots are NOT painted: the game
                draws them (plot-base sprite) and the towers on them. Use this for the shipped map.
  --keep-plots  take the plots from layout.json instead of generating them (re-bakes keep the
                sim's plot indices stable). The rules below are still checked.
  --variants    also write <out stem>@<s>x.<ext> at s x the layout size (src/render2d/mapVariant.ts
                loads the smallest that covers the screen; the master is the --w bake).
  --3x          render only the native @3x WebP and its @3x gate fronts, using the saved master
                gate rectangles. Pass the regular master output path and --bake --keep-plots.
                rebake_all.py runs this pass after the regular master / smaller bakes.
  Campaign defaults for --seed, --plots, --windmill, --props and --decals come from
  campaign.json by layout id. CLI options override them. For a new layout, bake once with
  --write-layout to generate plots, then add --keep-plots for every subsequent bake.
  A recipe may reserve plots at specific layout-pixel centres with seedPlots. These count
  toward --plots and must pass the same clearance and coverage checks as generated plots.
  --biome        select a WebP kit from <assets_dir>/../biomes/. Campaign recipes select their
                kit, painted terrain, landmarks and crossings by default. Shared gameplay sprites
                such as plot-base continue to come from <assets_dir>.
  --check-plots   validate the saved plots and geometry without rendering or writing files:
                compose.py <layout.json> <assets_dir> --check-plots
  --write-layout  save generated plots in route order and write each gate (prop, facing, front layer rect / depth) into layout.json
                (entrances[i].gate, goalGate) — see src/data/levels2d/gates.ts.
  (mock mode)   without --bake the plots (and --towers / --enemies) are painted in, for design mocks.

Entrance caves (gates.py) face along the first road segment. --gate-seat threshold (default)
aims the road through the midpoint of the cave sill. --gate-seat exit uses the original anchor.
With --keep-plots a cave can move partway toward its seat to respect the saved tower envelopes.
--gate-bleed sets the maximum cave bleed beyond the safe area in road widths (default 0.6).

Goal keeps (keeps.py) are single keyed gatehouses with an arch in the main facade. The
painted sill and the flared stone apron share the final road tangent. --castle-h sets the
nominal height in road widths. The whole building shrinks uniformly to clear existing
plots, towers and the safe area. The front redraws the masonry and deep tunnel over walkers.
Re-bake every shipped island: /usr/bin/python3 tools/map-compose/rebake_all.py (checks that only
gate fields of the layouts changed). Gate contact sheet: tools/map-compose/gate_sheet.py.
Crisp ground (ground.py): fine brush detail, a ragged crisp road edge with a thin dark rim, grass
fringe and pebbles, sparse decals (assets/decal-*.png).

Everything geometric is computed in LAYOUT px (layout.json `imageSize`), so the plots and the
prop layout do not depend on --w; the bake is rendered at --w px wide (keep the aspect).
Writes <out>.plots.json: the plots in layout px, in route order (entrance branches first, then shared
sections to the gate).

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
    branch or 350 px, whichever is longer), >= 2 at each shared-tail junction, >= 2 on the last quarter of each final section
    (a single lane counts its own first stretch and last quarter)
Selection: candidates hug the road on both sides (closest offset that clears it); a farthest-point
pass (anisotropic, light bonus for covering more road) spreads them evenly along the whole route.
The road itself is a Catmull-Rom spline THROUGH the sim polyline vertices; the max deviation from
the polyline (what enemies walk) is printed and checked.
"""
from io import BytesIO
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
from gates import (  # noqa: E402
    blend_placement, clip_road_at_gate, contact_shadow, cut_front, entrance_dir, entrance_facing, gate_alpha_hit, goal_dir, goal_facing, output_box, output_sprite, place_gate, point_in_opening, resolve_prop,
)
import fords  # noqa: E402
from banks import shore_foundation  # noqa: E402
from masonry import marble_road, moat_wall  # noqa: E402
from keeps import Keep  # noqa: E402
from ground import Decals, DressingArea, brushed_surface, fine_detail, inner_band, ragged_mask, ring, road_fringe, scatter  # noqa: E402
from ringfit import measure_ring  # noqa: E402

args = sys.argv[1:]
layout_p, assets = Path(args[0]), Path(args[1])
out_p = None if '--check-plots' in args else Path(args[2])


L = json.loads(layout_p.read_text())
recipe = json.loads(Path(__file__).with_name('campaign.json').read_text()).get(L['id'], {})


def opt(k, d):
    return type(d)(args[args.index(k) + 1]) if k in args else recipe.get(k[2:], d)


biome = opt('--biome', '')
kit = assets.parent / 'biomes' / biome if biome else None
if kit and not kit.is_dir():
    sys.exit(f'Unknown biome kit: {kit}')
kit_spec = json.loads((kit / 'kit.json').read_text()) if kit else {}
base_kit = kit.parent / kit_spec['baseKit'] if 'baseKit' in kit_spec else None
dressing = recipe if biome and biome == recipe.get('biome') else {}
quality = opt('--quality', 72 if kit else 90)

W = opt('--w', 3072)
NPLOTS = opt('--plots', 24)
SEED = opt('--seed', 7)
GRASS = opt('--grass', dressing.get('groundMaterial', 'tex-grass.png'))
TOWERS = opt('--towers', '')
BAKE = '--bake' in args
random.seed(SEED)

iw, ih = L['imageSize']
variants = list(filter(None, opt('--variants', '').split(',')))
if BAKE and any(float(v) == 3 for v in variants):
    sys.exit('Use the --3x pass for a native 3x map and aligned gate fronts')
native_3x = '--3x' in args
if native_3x:
    if (not BAKE or '--keep-plots' not in args or out_p is None or out_p.suffix != '.webp'
            or '--write-layout' in args or '--variants' in args):
        sys.exit('--3x requires a WebP bake with --keep-plots and the saved master gate layout')
    W = 3 * iw
    quality = opt('--quality', 90)

S = W / iw  # layout px -> output px
H = round(ih * S)


def asset_file(name):
    if kit:
        themed = (kit / dressing.get('sprites', {}).get(name, name)).with_suffix('.webp')
        if themed.exists():
            return themed
        if base_kit and (base_kit / themed.name).exists():
            return base_kit / themed.name
    return assets / name


def load(name):
    p = asset_file(name)
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


# Vectorized segment projection keeps geometry checks inexpensive on long switchbacks.
segments = np.array([(a, b) for path in spl_paths + raw_paths for a, b in zip(path, path[1:])])
ax, ay = segments[:, 0].T
vx, vy = (segments[:, 1] - segments[:, 0]).T
length_sq = vx * vx + vy * vy
length_sq[length_sq == 0] = 1
qx, qy = np.array(road_pts).T


def dist_to_road(x, y):
    """Distance to the road centreline (spline AND sim polyline, whichever is closer)."""
    dx, dy = x - ax, y - ay
    t = np.clip((dx * vx + dy * vy) / length_sq, 0, 1)
    return float(np.sqrt(((dx - t * vx) ** 2 + (dy - t * vy) ** 2).min()))


def ellipse_clears_road(x, y, rx, ry):
    """True when the ellipse grown by the road half-width + rim touches no road point."""
    dx, dy = (qx - x) / (rx + ROAD_W / 2 + RIM), (qy - y) / (ry + ROAD_W / 2 + RIM)
    return not np.any(dx * dx + dy * dy < 1)


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
CAVE_H, CASTLE_H, GATE_INSET = opt('--cave-h', 2.5), opt('--castle-h', 2.7), opt('--gate-inset', 0.42 if kit else 0.5)
CAVE_SEAT = opt('--gate-seat', 'threshold').split('/')[0]  # accept older split-seat recipes
GATES = []  # dict(role, lane, id, prop, facing, g = placement)
for _i, _e in enumerate(L['entrances']):
    _f = entrance_facing(raw_paths[_i])
    _prop, _file, _flip = resolve_prop('cave', _f, asset_file)
    _g = place_gate(load(_file), _flip, (_e['x'], _e['y']), _f, ROAD_W * CAVE_H, ROAD_W * GATE_INSET, entrance_dir(raw_paths[_i]), fit_opening=bool(kit),
                    seat=CAVE_SEAT)
    _gx = place_gate(load(_file), _flip, (_e['x'], _e['y']), _f, ROAD_W * CAVE_H, ROAD_W * GATE_INSET, entrance_dir(raw_paths[_i]), fit_opening=bool(kit))
    GATES.append({'role': 'entrance', 'lane': _i, 'id': str(_e['id']), 'prop': _prop, 'facing': _f, 'g': _g, 'g_exit': _gx})
LANDMARKS = []  # (name, layout x centre, layout y bottom, layout height)
mill = opt('--windmill', '1609,298,2.7')
if mill != 'none':
    mx, my, mh = map(float, mill.split(','))
    LANDMARKS.append(('prop-windmill.png', mx, my, ROAD_W * mh))
for name, x, yb, h in dressing.get('landmarks', []):
    LANDMARKS.append((f'landmark-{name}.webp', x, yb, h))
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
# game2d.ts anchors the horn 30 px east and 8 px north of the entrance midpoint.
# hud.ts clamps it above the plaque: on 915x412 and 1600x900 the southern limits
# are 619 and 668 layout px. Reserve the sweep between the two fits, plus the
# label above the button (its screen-space offset is largest on the phone).
horn_x = ex_m + 30
horn_y_low = max(80, min(615, ey_m - 8))
horn_y_high = max(82, min(672, ey_m - 8))
HUD_RECTS.append((horn_x - 56, horn_y_low - 102, horn_x + 56, horn_y_high - 44))



def rects_hit(a, b, pad=0.0):
    return a[0] - pad < b[2] and b[0] - pad < a[2] and a[1] - pad < b[3] and b[1] - pad < a[3]


def plot_zone(x, y):
    """Plot ring + the tower that may stand on it (layout px rect)."""
    return (x - PLOT_R, y - TOWER_UP, x + PLOT_R, y + PLOT_RY)


# Protect scenery painted directly on a chapter terrain plate as well as its cliff edge.
dressing_mask = load(dressing['dressingMask']).convert('L').resize((iw, ih), Image.Resampling.NEAREST) if 'dressingMask' in dressing else None


def plot_ok(x, y):
    """Single-plot rules (safe area, HUD, road clearance and reach, landmarks). Returns a reason or ''."""
    if not (sx + PLOT_R + 6 <= x <= sx + sw - PLOT_R - 6 and sy + TOWER_UP + 6 <= y <= sy + sh - PLOT_RY - 14):
        return 'safe area'
    ring = (x - PLOT_R, y - PLOT_RY, x + PLOT_R, y + PLOT_RY)
    if dressing_mask and dressing_mask.crop(ring).getextrema()[0] < 128:
        return 'terrain'
    if any(rects_hit(ring, r) for r in HUD_RECTS):
        return 'hud'
    closest_y = max(horn_y_low, min(horn_y_high, y))
    if math.hypot(x - horn_x, y - closest_y) < 64 + PLOT_R:
        return 'horn'
    if landmark_hit(plot_zone(x, y), 8):
        return 'landmark'
    if dist_to_road(x, y) > REACH:
        return 'reach'
    if not ellipse_clears_road(x, y, PLOT_R, PLOT_RY):
        return 'road'
    return ''


def gate_bleed(g):
    """How far (layout px) a placed gate's painted pixels leave the safe area."""
    r = g['rect']
    bb = g['im'].getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    k = g['k']
    pr = (r[0] + bb[0] * k, r[1] + bb[1] * k, r[0] + bb[2] * k, r[1] + bb[3] * k) if bb else r
    return max(sx - pr[0], pr[2] - (sx + sw), sy - pr[1], pr[3] - (sy + sh), 0)


# Fit the whole gatehouse at its fixed threshold, independently of output resolution.
keep = Keep(assets.parent / 'gatehouses', kit_spec.get('baseKit', biome), (gx, gy), goal_dir(raw_paths[0]), ROAD_W, ROAD_W * CASTLE_H, recipe.get('gatehouseView'))
kept_zones = [plot_zone(*p) for p in L['plots']] if ('--keep-plots' in args or '--check-plots' in args) else []


def fit_keep():
    for percent in range(100, 9, -2):
        candidate = keep.place(percent / 100)
        if gate_bleed(candidate) or any(rects_hit(candidate['rect'], hud) for hud in HUD_RECTS[:6]):
            continue
        if any(gate_alpha_hit(candidate, z) for z in kept_zones):
            continue
        return candidate
    raise ValueError(f"No clear castle footprint on {L['id']}")


castle = fit_keep()
facing = goal_facing(raw_paths[0])
GATES.append({'role': 'goal', 'lane': -1, 'id': 'goal', 'prop': f'gatehouse-{keep.theme}-{facing.lower()}',
              'facing': facing, 'g': castle})
landmark_rects.append(castle['rect'])


# Re-bakes keep their plots: a seated gate (threshold rule) moves only as far toward its seat as
# the kept plots, the HUD corners and the safe area allow (blend 1 = fully seated, 0 = legacy exit
# anchor). The path end stays inside the dark opening at every step.
GATE_BLEED = opt('--gate-bleed', 0.6)
if L.get('plots') and ('--keep-plots' in args or '--check-plots' in args):
    _kept = [tuple(p) for p in L['plots']]
    for G in GATES:
        g_seat = G['g']
        if g_seat.get('seat') is None:
            continue
        g_exit = G['g_exit']
        for f in (1.0, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0.0):
            cand = blend_placement(g_exit, g_seat, f)
            r = cand['rect']
            if any(gate_alpha_hit(cand, plot_zone(px, py), 0) for px, py in _kept):
                continue
            if any(rects_hit(r, z) for z in HUD_RECTS[:6]):
                continue
            b = gate_bleed(cand)
            if (G['role'] == 'goal' and b > 0) or b > ROAD_W * GATE_BLEED:
                continue
            if f > 0 and not point_in_opening(cand, cand['point']):
                continue
            G['g'] = cand
            break
        else:
            G['g'] = {**g_exit, 'seat': None, 'threshold': None, 'blend': 0.0}
    landmark_rects[len(LANDMARKS):] = [G['g']['rect'] for G in GATES]


def pair_ok(a, b):
    dx, dy = abs(a[0] - b[0]), abs(a[1] - b[1])
    # rings apart (elliptical) ...
    if (dx / (2 * PLOT_R + 14)) ** 2 + (dy / (2 * PLOT_RY + 12)) ** 2 < 1:
        return False
    # ... and the tower in front does not bury the plot behind it
    if dx < BURY_DX and dy < BURY_DY:
        return False
    return True


# A common suffix of path vertices is a shared road. Split at every join, including
# staged merges. A crossing or a repeated vertex on a loop alone is not a join.
# The users of a directed edge are the lanes sharing its entire remaining suffix.
users = {}
for lane, path in enumerate(raw_paths):
    for i in range(len(path) - 1):
        users.setdefault(tuple(path[i:]), []).append(lane)

SECTIONS = {}
first_sections, final_sections, merges = [], set(), set()
for path in raw_paths:
    start = 0
    for i in range(1, len(path)):
        key = tuple(users[tuple(path[start:])])
        at_goal = i == len(path) - 1
        if not at_goal and users[tuple(path[i:])] == list(key):
            continue
        SECTIONS[key] = path[start:i + 1]
        if start == 0:
            first_sections.append(key)
        if at_goal:
            final_sections.add(key)
        else:
            merges.add(path[i])
        start = i


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


ORDER = {key: i for i, key in enumerate(dict.fromkeys([*first_sections, *SECTIONS]))}


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

    def take(point):
        chosen.append(point)
        for i, c in enumerate(uniq):
            mind[i] = min(mind[i], adist(c, point))

    for x, y in recipe.get('seedPlots', []):
        take((x, y))

    # seeds: the valid candidates nearest each entrance and nearest the point 300 px down its road
    # (the farthest-point pass alone tends to leave the cramped first stretch next to a gate thin)
    for path in raw_paths:
        pts = resample(path, 10.0)
        for e0 in (pts[0], pts[min(len(pts) - 1, 30)]):
            order = sorted(range(len(uniq)), key=lambda i: math.hypot(uniq[i][0] - e0[0], uniq[i][1] - e0[1]))
            for i in order:
                if all(pair_ok(uniq[i], p) for p in chosen):
                    take(uniq[i])
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
        take(uniq[bi])
    return sorted(chosen, key=route_key), len(uniq)


if '--keep-plots' in args or '--check-plots' in args:
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
near_entrance = {key: 0 for key in first_sections}
last_counts = {key: 0 for key in final_sections}
for p in plots:
    name, arc = section_of(*p)
    length = poly_len(SECTIONS[name])
    if name in near_entrance and arc < max(length * 0.4, 350.0):
        near_entrance[name] += 1
    if name in last_counts and arc > length * 0.75:
        last_counts[name] += 1
for lane, key in enumerate(first_sections):
    if near_entrance[key] < 2:
        fails.append(f'only {near_entrance[key]} plots on the first stretch from entrance {lane}')
for point in merges:
    n = sum(math.dist(p, point) < 230 for p in plots)
    if n < 2:
        fails.append(f'only {n} plots at the merge {point}')
for key, n in last_counts.items():
    if n < 2:
        fails.append(f'only {n} plots on the last stretch of section {key}')
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
    # painted pixels only (the sprite rect has transparent margins)
    _bb = G['g']['im'].getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    _k = G['g']['k']
    pr = (r[0] + _bb[0] * _k, r[1] + _bb[1] * _k, r[0] + _bb[2] * _k, r[1] + _bb[3] * _k) if _bb else r
    out = max(sx - pr[0], pr[2] - (sx + sw), sy - pr[1], pr[3] - (sy + sh), 0)
    if G['role'] == 'goal':
        # Test the actual occluding paint on the sim line, independently of any PNG bbox.
        ux, uy = castle['along']
        for distance, interior in ((0, True), (ROAD_W * .65, False)):
            ix = round((gx + ux*distance - castle['left']) / castle['k'])
            iy = round((gy + uy*distance - castle['top']) / castle['k'])
            front = castle['front']
            opacity = front.getpixel((ix, iy)) if 0 <= ix < front.width and 0 <= iy < front.height else 0
            if (interior and opacity < 220) or (not interior and opacity > 20):
                fails.append(f'castle threshold opacity {opacity} at {distance:.0f} px from goal')
    if G['role'] == 'goal' and out > 0:
        fails.append(f'castle gate rect {tuple(round(v) for v in r)} leaves the safe area by {out:.0f} px')
    elif out > ROAD_W * opt('--gate-bleed', 0.6):
        fails.append(f'gate {G["id"]} rect {tuple(round(v) for v in r)} leaves the safe area by {out:.0f} px')
    elif out > 0:
        warns.append(f'gate {G["id"]} bleeds {out:.0f} px past the safe area')
    if any(rects_hit(r, z) for z in HUD_RECTS[:6]):
        fails.append(f'gate {G["id"]} rect {tuple(round(v) for v in r)} is under the HUD')
gaps = [min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in plots if q is not p) for p in plots]
reach = [dist_to_road(*p) for p in plots]

if fails:
    sys.exit('PLOT RULES FAILED:\n  ' + '\n  '.join(fails))
if '--check-plots' in args:
    print(f"{layout_p}: {len(plots)} plots pass, keep {castle['size']:.2f}")
    sys.exit(0)

# ---------------------------------------------------------------- ground (output px)
def tiled(tex, w, h, scale):
    resampling = Image.Resampling.BICUBIC if native_3x and scale > 1 else Image.LANCZOS
    t = tex.resize((max(1, round(tex.width * scale)), max(1, round(tex.height * scale))), resampling)
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
if dressing:  # The authored terrain plate supplies the island's broad landforms.
    ground = tiled(grass, W, H, 0.55 * TEX)
    dark = tiled(grass_dark, W, H, 0.55 * TEX)
else:
    ground = brushed_surface(grass, (W, H), 0.55 * TEX, SEED + 3)
    dark = brushed_surface(grass_dark, (W, H), 0.55 * TEX, SEED + 4)
mask = soft_noise(W, H, round(260 * TEX), SEED).point(lambda v: max(0, min(255, (v - 110) * 3)))
ground = Image.composite(dark, ground, mask)
# very soft, large light patches: breaks the tiling without adding detail
light = soft_noise(W, H, round(420 * TEX), SEED + 11).point(lambda v: max(0, min(255, (v - 150) * 2)))
ground = Image.composite(Image.new('RGBA', (W, H), (196, 214, 120, 255)), ground, light.point(lambda v: int(v * 0.10)))
# crisp painted detail: the high-pass of a finer tiling of the same grass (brush strokes at ~1/3
# the scale), luminance only -> sharper at 100% without new colours or busier large shapes
del dark, light, mask
ground = fine_detail(ground, grass, round(1024 * 0.2 * TEX), 0.55, 9 * TEX)

# An island's broad painted landforms sit over the fine repeating biome brushwork.
if dressing:
    plate = load(f'terrain-{L["id"]}.webp').resize((W, H), Image.Resampling.BICUBIC)
    ground = Image.blend(ground, plate, 0.92)
    del plate

# Mask of water and chasm banks in the terrain painting. Keep rooted props on land.
land_mask = load(f'land-{L["id"]}.webp').convert('L') if dressing.get('islet') else None


def on_land(x, y):
    if land_mask is None:
        return True
    u = max(0, min(land_mask.width - 1, int(x / iw * land_mask.width)))
    v = max(0, min(land_mask.height - 1, int(y / ih * land_mask.height)))
    return land_mask.getpixel((u, v)) >= 128


# Give structures that stand in tidal water or over a rift a painted foundation.
if land_mask:
    islet = load(dressing['islet'])

    def foundation(x, y, width, height, force=False):
        if force or not on_land(x, y):
            shelf = islet.resize((round(width * S), round(height * S)), Image.Resampling.LANCZOS)
            ground.alpha_composite(shelf, (round(x * S - shelf.width / 2), round(y * S - shelf.height * 0.43)))

    for px, py in plots:
        shore_foundation(ground, land_mask, (iw, ih), islet, (px, py), (PLOT_R, PLOT_RY), S)
    # Put one footing under the gatehouse if its base crosses the terrain edge.
    left, top, right, bottom = castle['rect']
    width, height = right-left, bottom-top
    base = (left+right)/2, bottom-height*.20
    if 'gatehouseShelf' in recipe:
        dx, dy, w, h = recipe['gatehouseShelf']
        foundation(gx+dx, gy+dy, w, h, force=True)
    elif any(not on_land(base[0]+dx*width, base[1]+dy*height)
           for dx, dy in ((-.35,0), (.35,0), (0,.12), (0,-.15))):
        foundation(*base, width*1.28, max(width*.57, height*.43), force=True)
    shelves = {f'landmark-{name}.webp': rect for name, rect in dressing.get('landmarkShelves', {}).items()}
    for index, (left, top, right, bottom) in enumerate(landmark_rects[:-1]):
        name = LANDMARKS[index][0] if index < len(LANDMARKS) else None
        if name in shelves:
            # Waterworks can span the natural channel directly (no rock shelf).
            if shelves[name]:
                foundation(*shelves[name], force=True)
        else:
            foundation((left + right) / 2, bottom - 5, (right - left) * 1.17, (right - left) * 0.49)

ford_sites = dressing.get('fords', [])
ford_patches = fords.prepare(ground, land_mask, (iw, ih), ford_sites, S)
if dressing.get('moatWall'):
    moat_wall(ground, land_mask, (iw, ih), spl_paths[0], ROAD_W, S, load('landmark-stone-bridge.webp'), SEED)

# ---------------------------------------------------------------- road
road_hard = Image.new('L', (W, H))
dr = ImageDraw.Draw(road_hard)
for path in spl_paths:
    pts = [P(p) for p in path]
    dr.line(pts, fill=255, width=round(rw), joint='curve')
    # The goal has a flush threshold under the cross-roof. A round end cap would show behind it.
    x, y = pts[0]
    dr.ellipse((x - rw / 2, y - rw / 2, x + rw / 2, y + rw / 2), fill=255)
# the road ends at each seated gate's threshold (no end cap peeking out under the gate)
for G in GATES:
    clip_road_at_gate(road_hard, G['g'], S, rw)
keep.trim_road(road_hard, S, spl_paths)
# crisp, slightly irregular painted edge (was a ~10-25 px Gaussian ramp: the main "blurry" cue)
# Use the master's noise lattice at both scales so the painted contour stays in place.
noise_scale = S / 2 if native_3x else 1
road_mask = ragged_mask(road_hard, rw * 0.05, max(4, round(rw * 0.16 / noise_scale)), 0.22, SEED + 21, aa=1.1 if native_3x else 1.1 * W / 3692, noise_scale=noise_scale)
road_material = load(dressing.get('roadMaterial', 'tex-dirt.png'))
if dressing.get('layMarble'):
    dirt = marble_road((W, H), road_material, spl_paths[0], ROAD_W, S, SEED + 23)
elif not kit or dressing.get('brushRoad'):
    dirt = brushed_surface(road_material, (W, H), 0.45 * TEX, SEED + 23)
else:
    dirt = tiled(road_material, W, H, 0.45 * TEX)
if not dressing.get('layMarble'):
    dirt = fine_detail(dirt, road_material, round(1024 * 0.16 * TEX), 0.45, 7 * TEX)
if 'branchMaterial' in dressing:
    lane, material = dressing['branchMaterial']
    first = catmull(SECTIONS[first_sections[lane]])
    branch = Image.new('L', (W, H))
    ImageDraw.Draw(branch).line([P(p) for p in first], fill=255, width=round(rw * 1.6), joint='curve')
    dirt = Image.composite(tiled(load(material), W, H, 0.45 * TEX), dirt, branch.filter(ImageFilter.GaussianBlur(rw * 0.1)))
# a faint wide shade on the grass along the road, a thin darker rim right at the edge, the dirt,
# then a narrow darker lip just inside the edge
shade = road_mask.filter(ImageFilter.MaxFilter(2 * round(rw * 0.05) + 1)).filter(ImageFilter.GaussianBlur(rw * 0.10))
ground = Image.composite(Image.new('RGBA', (W, H), (70, 52, 30, 255)), ground, shade.point(lambda v: int(v * 0.22)))
rim_band = ring(road_mask, max(2, round(rw * 0.035)), 0.7 * W / 3692)
ground = Image.composite(Image.new('RGBA', (W, H), (74, 70, 30, 255)), ground, rim_band.point(lambda v: int(v * 0.50)))
ground = Image.composite(dirt, ground, road_mask)
lip = inner_band(road_mask, max(2, round(rw * 0.06)), 1.2 * W / 3692)
ground = Image.composite(Image.new('RGBA', (W, H), (122, 80, 42, 255)), ground, lip.point(lambda v: int(v * 0.30)))

del shade, rim_band, lip, dirt, road_hard
keep.apron(ground, castle, S, plots, PLOT_R, PLOT_RY, raw_paths[0])

if ford_patches:
    fords.paint(ground, ford_patches, road_mask, ROAD_W, load('ford-stones.webp'),
                [resample(catmull(section), 17) for section in SECTIONS.values()], S, SEED + 29)

# Crossings share the road centreline. These deck stamps have no collision or sim geometry.
crossing_rects = []
for name, x, y, length, width, angle in dressing.get('crossings', []):
    deck = load(f'landmark-{name}.webp').resize((round(width * S), round(length * S)), Image.Resampling.LANCZOS)
    deck = deck.rotate(angle, Image.Resampling.BICUBIC, expand=True)
    ground.alpha_composite(deck, (round(x * S - deck.width / 2), round(y * S - deck.height / 2)))
    # Prop rejection uses the same rotated bounding box as the master, including its pixel rounding.
    if native_3x:
        ref = Image.new('L', (round(width * 2), round(length * 2))).rotate(angle, expand=True)
        crossing_rects.append((x - ref.width / 4, y - ref.height / 4, x + ref.width / 4, y + ref.height / 4))
        continue
    crossing_rects.append(sprite_rect(deck, x, y + deck.height / (2 * S), deck.height / S))

# ---------------------------------------------------------------- crisp painted details
area = DressingArea((iw, ih), spl_paths, ROAD_W, plots, PLOT_R, PLOT_RY,
                    landmark_rects + crossing_rects)


def grounded(rect):
    if dressing_mask and dressing_mask.crop(rect).getextrema()[0] < 128:
        return False
    if land_mask is None:
        return True
    left, top, right, bottom = rect
    box = (math.floor(left * land_mask.width / iw), math.floor(top * land_mask.height / ih),
           math.ceil(right * land_mask.width / iw), math.ceil(bottom * land_mask.height / ih))
    return land_mask.crop(box).getextrema()[0] >= 128


decals = Decals(load, themed=bool(kit))
fringe_n = scatter_n = None
if decals.ok and '--no-decals' not in args and dressing.get('groundDecals', True):
    def decal_ok(rect):
        return area.clear(rect) and grounded(rect)

    # Shared lanes get a single verge, including after a multi-way merge.
    edge_polys = [resample(catmull(section), 4.0) for section in SECTIONS.values()]
    fringe_n = road_fringe(ground, decals, edge_polys, ROAD_W / 2, S, SEED + 31, decal_ok)
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
    _spr = output_sprite(G['g'], S)
    # gates cast their own silhouette shadow (contact_shadow) instead of the generic ellipse
    items.append((gy0 + gh_, _spr, gx0 + gw_ / 2, gy0 + gh_, False))

# scatter props (layout px), mostly on the margins, never on the road / plots / towers / landmarks
PROPS = [('prop-tree-1.png', 2.1), ('prop-tree-2.png', 2.4), ('prop-tree-3.png', 1.9), ('prop-bush.png', 1.0),
         ('prop-rock-1.png', 0.9), ('prop-rock-2.png', 0.8), ('prop-flowers.png', 0.55)]
PROPS = kit_spec.get('props', PROPS)
WEIGHTS = dressing.get('propWeights', [5, 3, 2, 4, 2, 2, 2])
prop_ims = {n: load(n) for n, _ in PROPS}
rnd = random.Random(SEED)
placed = []
tries = 0
zones = [plot_zone(*p) for p in plots]
prop_count = opt('--props', 70)
while len(placed) < prop_count and tries < 12000:
    tries += 1
    x, y = rnd.uniform(0, iw), rnd.uniform(ROAD_W * 0.4, ih - ROAD_W * 0.6)
    margin = x < sx or x > sx + sw or min(x, iw - x) < iw * 0.12 or y < ih * 0.12
    if not on_land(x, y):
        continue
    if not margin and rnd.random() < 0.75:  # keep the play area calm
        continue
    name, rel = rnd.choices(PROPS, WEIGHTS)[0]
    h = ROAD_W * rel * rnd.uniform(0.72, 1.12)
    rect = sprite_rect(prop_ims[name], x, y, h)
    if not area.clear(rect) or any(rects_hit(rect, zone, 4) for zone in zones):
        continue
    # Keep trunks, stone bases and their contact shadows on a single bank.
    radius = (rect[2] - rect[0]) * .32
    if not grounded((x-radius, y-h*.14, x+radius, y+2)):
        continue
    # Leave complete silhouettes at the desktop crop as well as the phone edges.
    if any(rect[0] < edge < rect[2] for edge in (sx, sx+sw)):
        continue
    if any(rects_hit(rect, other, kit_spec.get('repeatGap', 2) if previous == name else 2)
           for previous, other in placed):
        continue
    placed.append((name, rect))
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
for G in GATES:
    _cs, (_cx, _cy) = contact_shadow(G['g'], S, rw)
    _layer = Image.new('L', (W, H))
    _layer.paste(_cs, (_cx, _cy))
    shadow = ImageChops.lighter(shadow, _layer.point(lambda v: int(v * 0.62)))
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
if native_3x:
    dest = out_p.with_stem(out_p.stem + '@3x')
    while True:
        rgb.save(dest, quality=quality, method=6)
        if dest.stat().st_size <= 3_000_000:
            break
        quality -= 3
        if quality < 0:
            sys.exit(f'{dest} exceeds 3 MB')
elif out_p.suffix.lower() == '.webp':
    rgb.save(out_p, quality=quality, method=6)
else:
    rgb.save(out_p, quality=92)
inv = [[round(x), round(y)] for x, y in plots]
if not native_3x:
    Path(str(out_p) + '.plots.json').write_text(json.dumps(inv))

# resolution variants (mapVariant.ts): <stem>@<scale>x, texture width = scale x layout width
variant_files = {}
for v in variants:
    vs = float(v)
    vw, vh = round(iw * vs), round(ih * vs)
    vp = out_p.with_name(f'{out_p.stem}@{v}x{out_p.suffix}')
    rgb.resize((vw, vh), Image.LANCZOS).save(vp, quality=quality, method=6)
    variant_files[f'{out_p.stem}@{v}x'] = vp.name

# gate front layers, cut from the final composite (same pixels as the bake underneath)
gate_json = []
for G in GATES:
    if G['role'] == 'goal':
        fx, fy, fw, fh = output_box(castle, S)
        front_im = canvas.crop((fx, fy, fx + fw, fy + fh))
        front_im.putalpha(castle['front'].resize((fw, fh), Image.Resampling.LANCZOS))
    else:
        front_im, (fx, fy) = cut_front(canvas, G['g'], S)
    entry = {'prop': G['prop'], 'facing': G['facing'], 'front': None}
    if front_im is not None:
        key = f'{out_p.stem}-gate-{G["id"]}'
        rect = [round(v / S, 2) for v in (fx, fy, front_im.width, front_im.height)]
        if native_3x:
            gate = L['goalGate'] if G['role'] == 'goal' else L['entrances'][G['lane']]['gate']
            # The saved 2x rectangle can start between 3x texels. Sample that exact footprint so
            # the mounted sprite and the painted map agree, even at a half-layout-pixel boundary.
            rect = gate['front']['rect']
            x, y, w, h = rect
            box = (x * S - fx, y * S - fy, (x + w) * S - fx, (y + h) * S - fy)
            front_im = front_im.transform((round(w * S), round(h * S)), Image.Transform.EXTENT, box, Image.Resampling.BICUBIC)
            key += '@3x'
        fp = out_p.with_name(f'{key}.webp')
        encoded = BytesIO()
        front_im.save(encoded, format='WEBP', quality=90, method=6, exact=True)
        # Versions of libwebp can encode identical gate pixels with different lossless
        # alpha streams. Preserve the shipped file when its decoded RGBA already matches.
        try:
            with Image.open(fp) as previous, Image.open(encoded) as candidate:
                same_pixels = np.array_equal(np.asarray(previous), np.asarray(candidate))
        except OSError:
            same_pixels = False
        if not same_pixels:
            fp.write_bytes(encoded.getvalue())
        gr = G['g']['rect']
        entry['front'] = {
            'art': key,
            'rect': rect,
            # depth key: the gate's front ground line (its sprite bottom), layout px
            'baseY': round(gr[3], 2),
        }
        G['file'] = fp.name
    G['json'] = entry
    gate_json.append({'role': G['role'], 'lane': G['lane'], **entry})
if not native_3x:
    Path(str(out_p) + '.gates.json').write_text(json.dumps(gate_json, indent=1))
if '--write-layout' in args:
    L['plots'] = inv
    for G in GATES:
        if G['role'] == 'entrance':
            L['entrances'][G['lane']]['gate'] = G['json']
        else:
            L['goalGate'] = G['json']
    if L != json.loads(layout_p.read_text()):
        layout_p.write_text(json.dumps(L, indent=1))
for k, f in variant_files.items():
    print(f'  variant {k} -> {f}')
for G in GATES:
    fr = G['json']['front']
    _seat = 'exit' if G['g'].get('seat') is None else f"seated {G['g'].get('blend', 1.0):.2f}"
    if G['role'] == 'goal':
        _seat = f"aligned {castle['size']:.2f}"
    print(f'  gate {G["id"]}: {G["prop"]} facing {G["facing"]} {_seat} rect {tuple(round(v) for v in G["g"]["rect"])}'
          f' front {G.get("file")} {fr["rect"] if fr else None}')
if fringe_n is not None:
    print(f'  verge decals {fringe_n}, field decals {scatter_n}')
for w_ in warns:
    print('  warning: ' + w_)

print(f'{dest if native_3x else out_p} {W}x{H} mode={"bake" if BAKE else "mock"} plots={len(plots)} (candidates {ncand}) props={len(placed)}')
print(f'  plot footprint {2 * PLOT_R:.0f}x{2 * PLOT_RY:.0f} layout px, road width {ROAD_W:.1f}, spline deviation {dev:.1f} px')
print(f'  sections {counts}  first-stretch {near_entrance}  merges {len(merges)}  last-stretch {last_counts}')
if plots:
    print(f'  nearest-neighbour gap min {min(gaps):.0f} / median {sorted(gaps)[len(gaps) // 2]:.0f} / max {max(gaps):.0f} px; '
          f'road reach max {max(reach):.0f} px (limit {REACH:.0f})')
