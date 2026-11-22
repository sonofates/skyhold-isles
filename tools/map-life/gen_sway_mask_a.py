#!/usr/bin/env python3
"""Per-biome sway mask generator for group A islands (i01, i02, i04, i05, i07, i08).

Islands i03 (snowy alpine highlands) and i06 (sandy coastal atoll) intentionally have no
wind sway layer: i03 is snow/ice/rock (NE spruce stand already animated via mapAnim) and
i06 is sand/lagoon/ocean (SW palms already animated via mapAnim).

Imports shared helpers from tools/map-life/gen_sway_mask.py without modifying it.

Usage:
    python3 tools/map-life/gen_sway_mask_a.py [i01 i02 ...] [--scale 0.5] [--overlay-dir docs/anim-shots/maplife]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from gen_sway_mask import (  # noqa: E402
    PLOT_ASPECT,
    ROAD_WIDTH_FRACTION,
    ROOT,
    animation_clearance,
    catmull,
    filter_small_components,
    rgb_to_hsv_np,
    road_footprint,
)

WIND_ISLANDS = ('i01', 'i02', 'i04', 'i05', 'i07', 'i08')

# Per-island biome tuning parameters.
ISLAND_PARAMS: dict[str, dict[str, Any]] = {
    'i01': {
        'biome_label': 'Sunny Poppy Meadow / Orchard',
        # Lush bright spring green grass + scattered wildflower/poppy margins outside mapAnim.
        'land_erode': 0,
        'edge_margin': 10,
        'grass_h': (40.0, 118.0),
        'grass_s_min': 0.42,
        'grass_v': (0.25, 0.90),
        # Also allow red/orange poppy blooms that sit inside the wildflower grass strips.
        'allow_poppies': True,
        'prop_diff_thresh': 58.0,
        'prop_foliage_h': (42.0, 95.0),
        'prop_foliage_s': 0.55,
        'prop_dilate': 15,
        'extra_blocks': [],
        'min_grass_area': 55,
        'feather_erode': 9,
        'feather_blur': 5.5,
    },
    'i02': {
        'biome_label': 'Coastal Tidal Estuary / Salt Meadow',
        # Olive-green coastal turf & sea-thrift; exclude pale tan sand patches, turquoise water,
        # stone corner blocks, bridges, boats, docks, lookout & net-loft.
        'land_erode': 29,  # 14 px inward from tidal water bank stones
        'edge_margin': 10,
        'grass_h': (46.5, 96.0),
        'grass_s_min': 0.44,
        'grass_v': (0.34, 0.86),
        'min_g_minus_r': -22.0,  # reject warm tan/yellow sand where R >> G
        'prop_diff_thresh': 52.0,
        'prop_foliage_h': (50.0, 88.0),
        'prop_foliage_s': 0.55,
        'prop_dilate': 17,
        # Block stone ruins in NW and SE corners + bridge abutments/piers.
        'extra_blocks': [
            ('rect', (0, 0, 265, 135)),
            ('rect', (1640, 650, 1846, 852)),
            ('rect', (830, 245, 1105, 375)),  # trestle bridge + banner
            ('rect', (835, 455, 1105, 575)),  # lifting span + jetty
        ],
        'min_grass_area': 65,
        'feather_erode': 9,
        'feather_blur': 5.0,
    },
    'i04': {
        'biome_label': 'Emerald Forest Terraces / Crystal Grove',
        # Vibrant emerald grass & moss slopes; exclude mountain brook + rocky banks,
        # corner stone ruins, 3 bridges/crossings, crystal oak, lantern shrine & grove beacon.
        'land_erode': 37,  # 18 px inward from rocky brook edges
        'edge_margin': 10,
        'grass_h': (54.0, 128.0),
        'grass_s_min': 0.42,
        'grass_v': (0.26, 0.86),
        'min_g_minus_r': 4.0,  # emerald grass always has G > R; excludes tan rocks & dirt
        'prop_diff_thresh': 52.0,
        'prop_foliage_h': (66.0, 115.0),
        'prop_foliage_s': 0.58,
        'prop_dilate': 17,
        'extra_blocks': [
            ('poly', [(0, 0), (340, 0), (0, 210)]),           # NW stone terrace blocks
            ('poly', [(1590, 0), (1846, 0), (1846, 200)]),    # NE stone ruins
            ('poly', [(1846, 610), (1846, 852), (1600, 852)]),  # SE stone ruins
            ('poly', [(0, 620), (0, 852), (210, 852)]),       # SW stone block
            ('ellipse', (640, 500, 885, 735)),                # emerald crystal oak + stone pavers
        ],
        'min_grass_area': 60,
        'feather_erode': 9,
        'feather_blur': 5.5,
    },
    'i05': {
        'biome_label': 'Golden Autumn Harvest / Wheat Orchard',
        # Sway ONLY the tall golden wheat fields (black regions of dressing-i05.webp) outside
        # mapAnim video loops! Bare ochre stubble/harvested earth stays strictly stationary.
        'use_inverted_dressing': True,
        'land_erode': 0,
        'edge_margin': 10,
        'grass_h': (26.0, 65.0),
        'grass_s_min': 0.45,
        'grass_v': (0.35, 0.96),
        'prop_diff_thresh': 48.0,
        'prop_foliage_h': (32.0, 48.0),
        'prop_foliage_s': 0.72,
        'prop_dilate': 15,
        'extra_blocks': [
            ('rect', (0, 0, 210, 78)),       # NW apple orchard border foliage/apples
            ('rect', (1645, 755, 1846, 852)),  # SE corner rocks/apples
        ],
        'min_grass_area': 40,
        'feather_erode': 7,
        'feather_blur': 4.5,
    },
    'i07': {
        'biome_label': 'Windswept Highland Gorge / Moorland',
        # Cool sage/olive highland moorland grass; strictly exclude central rocky gorge/cliff
        # rims, both stone arch bridges, paved stone road, garrison + stairs, sundial, woodstore,
        # snow-roofed castle, stone cave, and bare grey rock outcrops.
        'land_erode': 57,  # 28 px inward from canyon cliff rim so rock ledges never wobble
        'edge_margin': 10,
        'grass_h': (45.0, 96.0),
        'grass_s_min': 0.29,
        'grass_v': (0.32, 0.80),
        'min_g_minus_r': -12.0,
        'prop_diff_thresh': 48.0,
        'prop_foliage_h': (48.0, 82.0),
        'prop_foliage_s': 0.48,
        'prop_dilate': 17,
        'extra_blocks': [
            ('rect', (740, 160, 1045, 295)),   # north stone arch bridge
            ('rect', (755, 500, 1045, 625)),   # south stone arch bridge
            ('rect', (995, 0, 1225, 215)),     # garrison + stairs
            ('rect', (695, 35, 810, 145)),     # cliff sundial
            ('rect', (375, 625, 495, 725)),    # span woodstore
        ],
        'min_grass_area': 65,
        'feather_erode': 9,
        'feather_blur': 5.5,
    },
    'i08': {
        'biome_label': 'Twilight Marshland & Moat',
        # Mossy olive marshland grass & shoreline reeds; strictly exclude outer lake water,
        # inner moat pools, drowned arch, flooded piers, drawbridge, lantern, castle, cave,
        # cobble road, plots, and mapAnim rects.
        'land_erode': 17,  # 8 px inward from water shoreline so reeds sway but lake water never moves
        'edge_margin': 10,
        'grass_h': (36.0, 108.0),
        'grass_s_min': 0.34,
        'grass_v': (0.24, 0.78),
        'min_g_minus_r': -18.0,
        'prop_diff_thresh': 50.0,
        'prop_foliage_h': (44.0, 92.0),
        'prop_foliage_s': 0.48,
        'prop_dilate': 15,
        'extra_blocks': [
            ('rect', (895, 238, 1135, 365)),   # marsh drawbridge + stone abutments
            ('ellipse', (495, 645, 582, 750)), # marsh stone lantern
            ('rect', (740, 225, 905, 405)),    # central castle + cobbled apron
        ],
        'min_grass_area': 55,
        'feather_erode': 9,
        'feather_blur': 5.0,
    },
}


def build_sway_mask_a(island: str, scale: float = 0.5) -> tuple[Image.Image, Image.Image, dict]:
    if island not in ISLAND_PARAMS:
        raise ValueError(f'Unsupported wind island {island!r}; expected one of {WIND_ISLANDS}')
    params = ISLAND_PARAMS[island]

    layout_path = ROOT / f'src/data/levels2d/{island}.json'
    layout = json.loads(layout_path.read_text())
    recipes = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())
    recipe = recipes.get(island, {})

    iw, ih = int(layout['imageSize'][0]), int(layout['imageSize'][1])
    map_img_path = ROOT / f'public/art2d/{layout["image"]}.webp'
    map_pil = Image.open(map_img_path).convert('RGB').resize((iw, ih), Image.Resampling.BILINEAR)

    biome = recipe.get('biome', '')
    biome_dir = ROOT / 'design/art-2d/v2/biomes' / biome if biome else None

    # 1. Playable land / crop region.
    if params.get('use_inverted_dressing') and biome_dir:
        dress_file = biome_dir / f'dressing-{island}.webp'
        dress = Image.open(dress_file).convert('L').resize((iw, ih), Image.Resampling.NEAREST)
        # Black regions of dressing-i05.webp are the dense tall wheat fields.
        land = dress.point(lambda v: 255 if v < 128 else 0)
    else:
        land_file = biome_dir / f'land-{island}.webp' if biome_dir else None
        if land_file and land_file.exists():
            land = Image.open(land_file).convert('L').resize((iw, ih), Image.Resampling.NEAREST)
            land = land.point(lambda v: 255 if v > 128 else 0)
            erode_k = int(params.get('land_erode', 25))
            if erode_k >= 3:
                # Apply erosion in steps of <=19 for speed/quality with PIL MinFilter.
                rem = erode_k
                while rem >= 3:
                    step = min(19, rem if rem % 2 == 1 else rem - 1)
                    land = land.filter(ImageFilter.MinFilter(step))
                    rem -= (step - 1)
        else:
            land = Image.new('L', (iw, ih), 255)

    edge_m = int(params.get('edge_margin', 10))
    ImageDraw.Draw(land).rectangle((0, 0, iw - 1, ih - 1), outline=0, width=edge_m)

    # 2. Road & bridge clearance from tools/map-anim/road_mask.py + explicit safety padding on paths.
    road_clear = animation_clearance(island).resize((iw, ih), Image.Resampling.BILINEAR)
    road_hard = road_clear.point(lambda v: 255 if v > 250 else 0)
    road_w = ih * ROAD_WIDTH_FRACTION
    paths = [list(map(tuple, p)) for p in layout.get('paths', [])]
    splines = [catmull(p) for p in paths]
    road_extra = road_footprint((iw, ih), paths + splines, road_w + 18).convert('L')
    road_hard = ImageChops.darker(road_hard, ImageChops.invert(road_extra))

    # 3. Hard geometric exclusions: plots, gates, castle, landmarks, groundPaint, crossings, mapAnim, extras.
    geom_block = Image.new('L', (iw, ih), 0)
    gdraw = ImageDraw.Draw(geom_block)

    plot_r = float(layout.get('plotRadiusPx', 48))
    plot_rx = plot_r * 1.26
    plot_ry = plot_r * PLOT_ASPECT * 1.34
    for px, py in layout.get('plots', []):
        gdraw.ellipse((px - plot_rx, py - plot_ry, px + plot_rx, py + plot_ry), fill=255)

    for ent in layout.get('entrances', []):
        ex, ey = float(ent['x']), float(ent['y'])
        gdraw.ellipse((ex - 68, ey - 68, ex + 68, ey + 48), fill=255)
        front = ent.get('gate', {}).get('front', {})
        if 'rect' in front:
            rx, ry, rw, rh = front['rect']
            gdraw.rounded_rectangle((rx - 24, ry - 22, rx + rw + 24, ry + rh + 18), radius=28, fill=255)

    goal = layout.get('goal')
    if goal:
        gx, gy = float(goal[0]), float(goal[1])
        gdraw.ellipse((gx - 78, gy - 88, gx + 110, gy + 70), fill=255)
    goal_front = layout.get('goalGate', {}).get('front', {})
    if 'rect' in goal_front:
        rx, ry, rw, rh = goal_front['rect']
        gdraw.rounded_rectangle((rx - 26, ry - 28, rx + rw + 34, ry + rh + 22), radius=34, fill=255)

    # Landmarks & groundPaint from campaign recipe.
    for lm in recipe.get('landmarks', []) + recipe.get('groundPaint', []):
        name, lx, lyb, lh = lm[0], float(lm[1]), float(lm[2]), float(lm[3])
        lw = lh * 1.25
        if biome_dir:
            lm_file = biome_dir / f'landmark-{name}.webp'
            if lm_file.exists():
                im_lm = Image.open(lm_file)
                lw = lh * im_lm.width / max(1, im_lm.height)
        gdraw.rounded_rectangle(
            (lx - lw * 0.58 - 14, lyb - lh - 14, lx + lw * 0.58 + 14, lyb + 14),
            radius=24,
            fill=255,
        )

    # Extra crossing/archBridge safety boxes (beyond animation_clearance).
    for _, x, y, length, breadth, angle in recipe.get('crossings', []):
        pad_l, pad_b = length + 28, breadth + 28
        sin_a, cos_a = math.sin(math.radians(angle)), math.cos(math.radians(angle))
        gdraw.polygon(
            [
                (x + u * pad_b * cos_a + v * pad_l * sin_a, y - u * pad_b * sin_a + v * pad_l * cos_a)
                for u, v in [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
            ],
            fill=255,
        )
    for _, (x0, y0), (x1, y1), above, below, _ in recipe.get('archBridges', []):
        gdraw.rectangle((min(x0, x1) - 18, min(y0, y1) - above - 16, max(x0, x1) + 18, max(y0, y1) + below + 16), fill=255)

    # Existing video-loop regions (mapAnim) stay stationary underneath their video matte.
    anim_path = ROOT / f'src/data/mapAnim/{island}.json'
    if anim_path.exists():
        anim = json.loads(anim_path.read_text())
        for el in anim.get('elements', []):
            rx, ry, rw, rh = el['rect']
            gdraw.rectangle((rx - 8, ry - 8, rx + rw + 8, ry + rh + 8), fill=255)

    # Island-specific extra geometric exclusions.
    for shape, box in params.get('extra_blocks', []):
        if shape == 'rect':
            gdraw.rectangle(box, fill=255)
        elif shape == 'ellipse':
            gdraw.ellipse(box, fill=255)
        elif shape == 'poly':
            gdraw.polygon(box, fill=255)

    # 4. Composited solid objects detected by diffing baked map against bare terrain plate.
    cw, ch = iw // 2, ih // 2
    prop_block = Image.new('L', (iw, ih), 0)
    terrain_file = biome_dir / f'terrain-{island}.webp' if biome_dir else None
    if terrain_file and terrain_file.exists():
        terrain_pil = Image.open(terrain_file).convert('RGB').resize((iw, ih), Image.Resampling.BILINEAR)
        m_sm = np.asarray(map_pil.filter(ImageFilter.GaussianBlur(1.5)), dtype=np.float32)
        t_sm = np.asarray(terrain_pil.filter(ImageFilter.GaussianBlur(1.5)), dtype=np.float32)
        diff_rgb = np.abs(m_sm - t_sm).sum(axis=2)
        h_m, s_m, _ = rgb_to_hsv_np(m_sm)
        h_t, s_t, _ = rgb_to_hsv_np(t_sm)
        chroma_shift = np.abs(s_m - s_t) * 255.0 + np.abs(h_m - h_t) * 2.0
        fh_lo, fh_hi = params['prop_foliage_h']
        is_foliage_prop = (h_m >= fh_lo) & (h_m <= fh_hi) & (s_m >= params['prop_foliage_s'])
        thresh = float(params.get('prop_diff_thresh', 55.0))
        changed_solid = ((diff_rgb > thresh) | ((diff_rgb > thresh * 0.62) & (chroma_shift > 30.0))) & (~is_foliage_prop)
        small_changed = (
            np.asarray(
                Image.fromarray((changed_solid * 255).astype(np.uint8), 'L').resize((cw, ch), Image.Resampling.BOX)
            )
            > 100
        )
        big_props = filter_small_components(small_changed, min_area=20)
        dil = int(params.get('prop_dilate', 15))
        prop_block = (
            Image.fromarray((big_props * 255).astype(np.uint8), 'L')
            .resize((iw, ih), Image.Resampling.NEAREST)
            .filter(ImageFilter.MaxFilter(dil))
        )

    # 5. Biome-tuned HSV material segmentation: keep genuine grass/foliage/crops, block rock/sand/water/stone.
    smooth_rgb = np.asarray(map_pil.filter(ImageFilter.GaussianBlur(2.2)), dtype=np.float32)
    h_s, s_s, v_s = rgb_to_hsv_np(smooth_rgb)
    r_s, g_s = smooth_rgb[..., 0], smooth_rgb[..., 1]

    gh_lo, gh_hi = params['grass_h']
    gv_lo, gv_hi = params['grass_v']
    is_grass = (h_s >= gh_lo) & (h_s <= gh_hi) & (s_s >= params['grass_s_min']) & (v_s >= gv_lo) & (v_s <= gv_hi)
    if 'min_g_minus_r' in params:
        is_grass = is_grass & ((g_s - r_s) >= float(params['min_g_minus_r']))

    if params.get('allow_poppies'):
        # Warm red/orange wildflower blossoms inside lush meadow borders (high saturation, warm hue).
        is_poppy = ((h_s <= 40.0) | (h_s >= 345.0)) & (s_s >= 0.56) & (v_s >= 0.35) & (v_s <= 0.90)
        is_grass = is_grass | is_poppy

    is_non_grass = ~is_grass
    ng_small = (
        np.asarray(
            Image.fromarray((is_non_grass * 255).astype(np.uint8), 'L').resize((cw, ch), Image.Resampling.BOX)
        )
        > 115
    )
    # Close tiny gaps inside non-grass patches (stone joints, sand patches) & drop tiny speckles (<28 px).
    ng_img = Image.fromarray((ng_small * 255).astype(np.uint8), 'L')
    ng_img = ng_img.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    ng_clean = filter_small_components(np.asarray(ng_img) > 128, min_area=28)
    material_block = (
        Image.fromarray((ng_clean * 255).astype(np.uint8), 'L')
        .resize((iw, ih), Image.Resampling.NEAREST)
        .filter(ImageFilter.MaxFilter(11))  # 5 px rim clearance around rock/sand/stone/water
    )

    # Combine all exclusions into hard_clear (255 = swaying foliage, 0 = strictly stationary).
    blocked = ImageChops.lighter(ImageChops.lighter(geom_block, prop_block), material_block)
    hard_clear = ImageChops.darker(ImageChops.darker(land, road_hard), ImageChops.invert(blocked))

    # Drop tiny isolated grass specks trapped between stones/roads/plots.
    hc_small = np.asarray(hard_clear.resize((cw, ch), Image.Resampling.BOX)) > 128
    hc_clean = filter_small_components(hc_small, min_area=int(params.get('min_grass_area', 55)))
    hard_clear = Image.fromarray((hc_clean * 255).astype(np.uint8), 'L').resize((iw, ih), Image.Resampling.NEAREST)
    hard_clear = ImageChops.darker(hard_clear, road_hard)
    hard_clear = ImageChops.darker(hard_clear, ImageChops.invert(geom_block))
    hard_clear = ImageChops.darker(hard_clear, land)

    # 6. Feather ONLY inward onto the grass side (protected boundary stays strictly 0).
    fe = int(params.get('feather_erode', 9))
    fb = float(params.get('feather_blur', 5.5))
    eroded = hard_clear.filter(ImageFilter.MinFilter(fe))
    feathered = eroded.filter(ImageFilter.GaussianBlur(fb))
    full_mask = ImageChops.darker(hard_clear, feathered)

    # 7. Output at target scale (default 0.5 -> 923x426) and re-enforce hard zeros on roads, plots & mapAnim.
    ow, oh = max(1, round(iw * scale)), max(1, round(ih * scale))
    out_mask = full_mask.resize((ow, oh), Image.Resampling.BILINEAR)
    hard_out = hard_clear.resize((ow, oh), Image.Resampling.BOX).point(lambda v: 255 if v == 255 else 0)
    out_mask = ImageChops.darker(out_mask, hard_out)

    # Guarantee exact 0 at every path vertex/segment, plot ellipse, and mapAnim rect at output resolution.
    odraw = ImageDraw.Draw(out_mask)
    for path in paths:
        pts = [(x * scale, y * scale) for x, y in path]
        odraw.line(pts, fill=0, width=max(3, math.ceil((road_w + 12) * scale)), joint='curve')
        for x, y in pts:
            r = max(2, math.ceil((road_w * 0.5 + 6) * scale))
            odraw.ellipse((x - r, y - r, x + r, y + r), fill=0)
    for px, py in layout.get('plots', []):
        odraw.ellipse(
            ((px - plot_rx) * scale, (py - plot_ry) * scale, (px + plot_rx) * scale, (py + plot_ry) * scale),
            fill=0,
        )
    if anim_path.exists():
        anim = json.loads(anim_path.read_text())
        for el in anim.get('elements', []):
            rx, ry, rw, rh = el['rect']
            odraw.rectangle(
                ((rx - 4) * scale, (ry - 4) * scale, (rx + rw + 4) * scale, (ry + rh + 4) * scale),
                fill=0,
            )

    # Build visual diagnostic overlay at layout resolution.
    base = Image.open(map_img_path).convert('RGBA').resize((iw, ih), Image.Resampling.BILINEAR)
    mask_vis = out_mask.resize((iw, ih), Image.Resampling.BILINEAR)
    tint = Image.new('RGBA', (iw, ih), (0, 235, 145, 255))
    tint.putalpha(mask_vis.point(lambda v: int(v * 0.52)))
    overlay = Image.alpha_composite(base, tint)
    ov_draw = ImageDraw.Draw(overlay)
    for path in paths:
        ov_draw.line(path, fill=(255, 60, 60, 220), width=2)
    for px, py in layout.get('plots', []):
        ov_draw.ellipse(
            (px - plot_r, py - plot_r * PLOT_ASPECT, px + plot_r, py + plot_r * PLOT_ASPECT),
            outline=(255, 220, 40, 230),
            width=2,
        )
    if anim_path.exists():
        anim = json.loads(anim_path.read_text())
        for el in anim.get('elements', []):
            rx, ry, rw, rh = el['rect']
            ov_draw.rectangle((rx, ry, rx + rw, ry + rh), outline=(80, 190, 255, 200), width=2)

    arr = np.asarray(out_mask)
    stats: dict[str, Any] = {
        'island': island,
        'biome': params['biome_label'],
        'size': [ow, oh],
        'nonzero_pct': round(float((arr > 0).mean() * 100.0), 2),
        'strong_pct': round(float((arr >= 128).mean() * 100.0), 2),
        'mean_val': round(float(arr.mean()), 2),
    }

    max_path_val = 0
    for path in paths:
        for i, (x, y) in enumerate(path):
            mx = min(ow - 1, max(0, round(x * scale)))
            my = min(oh - 1, max(0, round(y * scale)))
            max_path_val = max(max_path_val, int(arr[my, mx]))
            if i > 0:
                mmx = min(ow - 1, max(0, round(((path[i - 1][0] + x) * 0.5) * scale)))
                mmy = min(oh - 1, max(0, round(((path[i - 1][1] + y) * 0.5) * scale)))
                max_path_val = max(max_path_val, int(arr[mmy, mmx]))

    max_plot_val = 0
    for px, py in layout.get('plots', []):
        for dx, dy in [(0, 0), (-plot_r * 0.85, 0), (plot_r * 0.85, 0), (0, -plot_r * 0.55), (0, plot_r * 0.55)]:
            mx = min(ow - 1, max(0, round((px + dx) * scale)))
            my = min(oh - 1, max(0, round((py + dy) * scale)))
            max_plot_val = max(max_plot_val, int(arr[my, mx]))

    stats['max_path_val'] = max_path_val
    stats['max_plot_val'] = max_plot_val
    return out_mask, overlay.convert('RGB'), stats


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate grass/foliage wind-sway masks for group A islands.')
    parser.add_argument('islands', nargs='*', default=list(WIND_ISLANDS), help='Island ids (default: all group A wind islands)')
    parser.add_argument('--scale', type=float, default=0.5, help='Output mask scale relative to layout (default 0.5)')
    parser.add_argument('--overlay', action='store_true', help='Save diagnostic JPG overlay to docs/anim-shots/maplife/<id>/')
    args = parser.parse_args()

    results = []
    for island in args.islands:
        out_path = ROOT / f'public/art2d/life/{island}-sway.webp'
        out_path.parent.mkdir(parents=True, exist_ok=True)
        mask, overlay, stats = build_sway_mask_a(island, scale=args.scale)
        mask.save(out_path, format='WEBP', lossless=True, method=6)
        stats['out'] = str(out_path.relative_to(ROOT))
        stats['bytes'] = out_path.stat().st_size

        if args.overlay:
            ov_path = ROOT / f'docs/anim-shots/maplife/{island}/{island}-sway-mask-overlay.jpg'
            ov_path.parent.mkdir(parents=True, exist_ok=True)
            overlay.save(ov_path, quality=88)
            stats['overlay'] = str(ov_path.relative_to(ROOT))

        results.append(stats)
        if stats['max_path_val'] != 0 or stats['max_plot_val'] != 0:
            print(json.dumps(results, indent=2))
            sys.exit(f'ERROR ({island}): non-zero mask on path ({stats["max_path_val"]}) or plot ({stats["max_plot_val"]})')

    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
