#!/usr/bin/env python3
"""Per-island wind-sway mask generator for Group B islands (i09, i10, i11, i12, i15).

Imports shared helpers from gen_sway_mask.py (without modifying it) and applies biome-specific
HSV foliage/material segmentation, prop-diffing thresholds, water/cliff exclusions, and geometric
clearance rules.

Islands i13 (barren slate rock), i14 (desert sand; date palm already in mapAnim), and
i16 (volcanic ash/magma) intentionally have no wind-sway mask.

Usage:
    python3 tools/map-life/gen_sway_mask_b.py i09 [--overlay docs/anim-shots/maplife/i09/i09-sway-mask-overlay.jpg]
    python3 tools/map-life/gen_sway_mask_b.py --all --overlays --fixtures
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

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

WIND_ISLANDS_B = ('i09', 'i10', 'i11', 'i12', 'i15')

# Per-island biome tuning dictionary.
ISLAND_PARAMS: dict[str, dict[str, Any]] = {
    # i09: Royal Orchard Garden — lush sunlit green lawn, marble road/bridge, balustrades, lanterns, cypresses.
    'i09': {
        'land_erode': 25,
        'border_margin': 10,
        'prop_diff_hard': 46.0,
        'prop_diff_soft': 28.0,
        'prop_chroma_shift': 26.0,
        'prop_min_area': 7,
        'prop_dilate': 13,
        'foliage_prop_hue': (56.0, 118.0),
        'foliage_prop_sat_min': 0.34,
        # Allow green grass & foliage (H 52..128, S >= 0.24), block stone balustrades/sky/gold lanterns.
        'material_mode': 'green_garden',
        'extra_rects': [
            # Top-left & top-right stone balustrades + top-center sky peek
            (0, 0, 140, 88),
            (1706, 0, 1846, 92),
            (1080, 0, 1345, 38),
        ],
        'extra_ellipses': [],
        'stone_dilate': 9,
        'min_grass_area': 45,
        'feather_erode': 9,
        'feather_blur': 5.5,
    },
    # i10: Willow Stream Terraces — warm olive terraced slopes, blue stream (NEVER sway water!), 5 bridges, sluice, stone walls.
    'i10': {
        'land_erode': 37,  # extra inward margin from land-i10 stream channel so creek banks stay 0
        'border_margin': 10,
        'prop_diff_hard': 44.0,
        'prop_diff_soft': 28.0,
        'prop_chroma_shift': 26.0,
        'prop_min_area': 8,
        'prop_dilate': 13,
        'foliage_prop_hue': (54.0, 108.0),
        'foliage_prop_sat_min': 0.44,
        'material_mode': 'olive_terraces',
        'extra_rects': [],
        'extra_ellipses': [],
        'stone_dilate': 11,
        'min_grass_area': 45,
        'feather_erode': 9,
        'feather_blur': 5.5,
    },
    # i11: Gale Sky Highlands — vibrant emerald clifftop meadows above cloud chasm, rock ledges, 4 landmarks.
    'i11': {
        'land_erode': 35,  # generous inward cliff-rim clearance
        'border_margin': 10,
        'prop_diff_hard': 48.0,
        'prop_diff_soft': 30.0,
        'prop_chroma_shift': 28.0,
        'prop_min_area': 10,
        'prop_dilate': 15,
        'foliage_prop_hue': (50.0, 118.0),
        'foliage_prop_sat_min': 0.45,
        'material_mode': 'highland_meadow',
        'extra_rects': [],
        'extra_ellipses': [
            # SW & SE jutting limestone cliff ledges (organic ellipses)
            (-90, 650, 240, 920),
            (1590, 650, 1936, 920),
        ],
        'stone_dilate': 11,
        'min_grass_area': 50,
        'feather_erode': 9,
        'feather_blur': 5.5,
    },
    # i12: Twilight Hollow Glade — purple/lavender feathery grass meadow, golden lanterns, stumps, stones, shrine.
    'i12': {
        'land_erode': 25,
        'border_margin': 12,
        'prop_diff_hard': 36.0,
        'prop_diff_soft': 24.0,
        'prop_chroma_shift': 22.0,
        'prop_min_area': 12,
        'prop_dilate': 13,
        # Allow cool twilight grass tufts & blue-green tree leaves to sway while blocking warm lanterns/stumps/stones/shrine
        'foliage_prop_hue': (185.0, 275.0),
        'foliage_prop_sat_min': 0.14,
        'material_mode': 'twilight_hollow',
        'extra_rects': [],
        'extra_ellipses': [],
        'stone_dilate': 9,
        'min_grass_area': 55,
        'feather_erode': 9,
        'feather_blur': 6.0,
    },
    # i15: Moonlit Hollow Pools — cool periwinkle-blue moonlit clearing grass with 3 reflection ponds (NEVER sway water!).
    'i15': {
        'land_erode': 21,
        'border_margin': 12,
        'prop_diff_hard': 34.0,
        'prop_diff_soft': 22.0,
        'prop_chroma_shift': 20.0,
        'prop_min_area': 10,
        'prop_dilate': 13,
        # Allow cool periwinkle grass tufts to sway while blocking warm lanterns/stones/stumps and teal puddles
        'foliage_prop_hue': (208.0, 265.0),
        'foliage_prop_sat_min': 0.16,
        'material_mode': 'moonlit_hollow',
        'extra_rects': [],
        # Explicit ellipses around the 3 moonlit water ponds + lily pads (plus HSV water filter below)
        'extra_ellipses': [
            (8, 100, 326, 646),       # west vertical pond
            (1140, -60, 1850, 178),   # northeast pond
            (882, 434, 1296, 662),    # south-center pond
        ],
        'stone_dilate': 9,
        'min_grass_area': 55,
        'feather_erode': 9,
        'feather_blur': 6.0,
    },
}


def compute_material_block(
    mode: str,
    map_pil: Image.Image,
    terrain_pil: Image.Image | None,
    cw: int,
    ch: int,
    iw: int,
    ih: int,
    dilate: int,
) -> Image.Image:
    """Return a binary mask (255 = blocked non-foliage material) tailored to the island biome."""
    smooth_rgb = np.asarray(map_pil.filter(ImageFilter.GaussianBlur(2.2)), dtype=np.float32)
    h_s, s_s, v_s = rgb_to_hsv_np(smooth_rgb)
    r_s, g_s, b_s = smooth_rgb[..., 0], smooth_rgb[..., 1], smooth_rgb[..., 2]

    if mode == 'green_garden':
        # i09: Green lawn/shrubs sit around H 52..135, S >= 0.22; block pale beige stone, marble, gold lanterns, sky.
        is_beige = (s_s < 0.45) & (h_s < 56.0) & (v_s > 0.46)
        is_gold_lantern = (h_s < 50.0) & (s_s >= 0.35) & (v_s > 0.55)
        is_grey_cool = (s_s < 0.24) | (h_s > 142.0) | (h_s < 46.0)
        is_blocked = is_beige | is_gold_lantern | is_grey_cool
    elif mode == 'olive_terraces':
        # i10: Olive grass sits around H 52..95, S 0.36..0.72; block teal/blue water (H > 118),
        # brown dirt creek banks & wooden bridges (H < 50), pale stone terrace ledges & rocks (S < 0.34).
        is_water = (h_s > 112.0)
        is_brown_or_stone = (h_s < 50.0) | (s_s < 0.35)
        is_pale_rock = (v_s > 0.72) & (s_s < 0.46)
        is_blocked = is_water | is_brown_or_stone | is_pale_rock
    elif mode == 'highland_meadow':
        # i11: Vibrant emerald highland grass (H 46..120, S >= 0.28) + small heather tufts;
        # block grey/white limestone cliffs, stone slabs, blue sky/clouds, tan cobble road, snow.
        is_cliff_or_sky = (s_s < 0.27) | (h_s > 130.0) | (h_s < 43.0)
        is_pale_stone = (v_s > 0.72) & (s_s < 0.42)
        is_blocked = is_cliff_or_sky | is_pale_stone
    elif mode == 'twilight_hollow':
        # i12: Feathery purple-lavender twilight grass (H 210..315, S 0.14..0.52).
        # Block warm gold/tan/brown props (lanterns, stumps, standing stones, shrine), pale road (H > 315 or H < 180).
        is_warm_prop = (h_s < 185.0) | (h_s > 318.0)
        is_too_grey = (s_s < 0.13) & (v_s > 0.42)
        is_blocked = is_warm_prop | is_too_grey
    elif mode == 'moonlit_hollow':
        # i15: Cool periwinkle-blue moonlit grass (H 208..265, S 0.14..0.46).
        # Block teal/greenish pond water (H < 208) on BOTH map and bare terrain, pale moonstone road (S < 0.15),
        # warm lanterns/stones/stumps (H < 170 or H > 290).
        is_water_or_warm = (h_s < 207.0) | (h_s > 275.0)
        is_pale_stone = (s_s < 0.16)
        is_blocked = is_water_or_warm | is_pale_stone
        if terrain_pil is not None:
            t_sm = np.asarray(terrain_pil.filter(ImageFilter.GaussianBlur(2.2)), dtype=np.float32)
            ht, st, _ = rgb_to_hsv_np(t_sm)
            # Teal ponds and bright white water reflections in terrain plate
            is_pond_water = ((ht >= 135.0) & (ht <= 209.0) & (st >= 0.08)) | (st < 0.12)
            is_blocked = is_blocked | is_pond_water
    else:
        is_beige_stone = (s_s < 0.52) & (h_s < 51.0) & ((g_s - r_s) < -17.0) & (v_s > 0.45)
        is_grey_or_cool = (s_s < 0.36) | (h_s > 152.0) | (h_s < 32.0)
        is_blocked = is_beige_stone | is_grey_or_cool

    st_small = np.asarray(
        Image.fromarray((is_blocked * 255).astype(np.uint8), 'L')
        .resize((cw, ch), Image.Resampling.BOX)
    ) > 100
    st_closed_img = Image.fromarray((st_small * 255).astype(np.uint8), 'L')
    st_closed_img = st_closed_img.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    st_clean = filter_small_components(np.asarray(st_closed_img) > 128, min_area=18)
    stone_block = Image.fromarray((st_clean * 255).astype(np.uint8), 'L').resize((iw, ih), Image.Resampling.NEAREST)
    if dilate >= 3:
        stone_block = stone_block.filter(ImageFilter.MaxFilter(dilate))
    return stone_block


def erode_mask(img: Image.Image, total_px: int) -> Image.Image:
    """Erode a binary L mask by ~total_px/2 pixels inward (splitting large kernels cleanly)."""
    cur = img
    rem = total_px
    while rem > 1:
        k = min(25, rem)
        if k % 2 == 0:
            k -= 1
        if k < 3:
            break
        cur = cur.filter(ImageFilter.MinFilter(k))
        rem -= (k - 1)
    return cur


def build_sway_mask_b(island: str, scale: float = 0.5) -> tuple[Image.Image, Image.Image, dict[str, Any]]:
    if island not in ISLAND_PARAMS:
        raise ValueError(f'Unsupported Group B wind island: {island} (expected one of {WIND_ISLANDS_B})')
    cfg = ISLAND_PARAMS[island]

    layout_path = ROOT / f'src/data/levels2d/{island}.json'
    layout = json.loads(layout_path.read_text())
    recipes = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())
    recipe = recipes.get(island, {})

    iw, ih = int(layout['imageSize'][0]), int(layout['imageSize'][1])
    map_img_path = ROOT / f'public/art2d/{layout["image"]}.webp'
    map_pil = Image.open(map_img_path).convert('RGB').resize((iw, ih), Image.Resampling.BILINEAR)

    biome = recipe.get('biome', '')
    biome_dir = ROOT / 'design/art-2d/v2/biomes' / biome if biome else None

    # 1. Playable land polygon (excludes sky, cliff rims, stream channels).
    land_file = biome_dir / f'land-{island}.webp' if biome_dir else None
    if land_file and land_file.exists():
        land = Image.open(land_file).convert('L').resize((iw, ih), Image.Resampling.NEAREST)
        land = land.point(lambda v: 255 if v > 128 else 0)
        land = erode_mask(land, int(cfg['land_erode']))
    else:
        land = Image.new('L', (iw, ih), 255)
        ImageDraw.Draw(land).rectangle((0, 0, iw - 1, ih - 1), outline=0, width=int(cfg['border_margin']) * 2)
    ImageDraw.Draw(land).rectangle((0, 0, iw - 1, ih - 1), outline=0, width=int(cfg['border_margin']))

    # 2. Road clearance + bridge/crossing protection + safety padding.
    road_clear = animation_clearance(island).resize((iw, ih), Image.Resampling.BILINEAR)
    road_hard = road_clear.point(lambda v: 255 if v > 250 else 0)
    road_w = ih * ROAD_WIDTH_FRACTION
    paths = [list(map(tuple, p)) for p in layout.get('paths', [])]
    splines = [catmull(p) for p in paths]
    road_extra = road_footprint((iw, ih), paths + splines, road_w + 18).convert('L')
    road_hard = ImageChops.darker(road_hard, ImageChops.invert(road_extra))

    # 3. Hard geometric exclusions: plots, gates, castle, landmarks, crossings, mapAnim, island-specific exclusions.
    geom_block = Image.new('L', (iw, ih), 0)
    gdraw = ImageDraw.Draw(geom_block)

    plot_r = float(layout.get('plotRadiusPx', 48))
    plot_rx = plot_r * 1.24
    plot_ry = plot_r * PLOT_ASPECT * 1.32
    for px, py in layout.get('plots', []):
        gdraw.ellipse((px - plot_rx, py - plot_ry, px + plot_rx, py + plot_ry), fill=255)

    for ent in layout.get('entrances', []):
        ex, ey = float(ent['x']), float(ent['y'])
        gdraw.ellipse((ex - 72, ey - 72, ex + 72, ey + 48), fill=255)
        front = ent.get('gate', {}).get('front', {})
        if 'rect' in front:
            rx, ry, rw, rh = front['rect']
            gdraw.rounded_rectangle((rx - 24, ry - 22, rx + rw + 24, ry + rh + 18), radius=28, fill=255)

    goal = layout.get('goal')
    if goal:
        gx, gy = float(goal[0]), float(goal[1])
        gdraw.ellipse((gx - 78, gy - 90, gx + 114, gy + 70), fill=255)
    goal_front = layout.get('goalGate', {}).get('front', {})
    if 'rect' in goal_front:
        rx, ry, rw, rh = goal_front['rect']
        gdraw.rounded_rectangle((rx - 24, ry - 30, rx + rw + 36, ry + rh + 22), radius=34, fill=255)

    for lm in recipe.get('landmarks', []) + recipe.get('groundPaint', []):
        name, lx, lyb, lh = lm[0], float(lm[1]), float(lm[2]), float(lm[3])
        lw = lh * 1.25
        if biome_dir:
            lm_file = biome_dir / f'landmark-{name}.webp'
            if lm_file.exists():
                im_lm = Image.open(lm_file)
                lw = lh * im_lm.width / max(1, im_lm.height)
        gdraw.rounded_rectangle((lx - lw * 0.58 - 14, lyb - lh - 14, lx + lw * 0.58 + 14, lyb + 14), radius=24, fill=255)

    # Extra safety around crossings/bridges beyond road_mask
    for _, cx, cy, length, breadth, angle in recipe.get('crossings', []):
        sin, cos = math.sin(math.radians(angle)), math.cos(math.radians(angle))
        b_pad, l_pad = breadth + 24, length + 24
        gdraw.polygon(
            [(cx + u * b_pad * cos + v * l_pad * sin, cy - u * b_pad * sin + v * l_pad * cos)
             for u, v in [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]],
            fill=255,
        )

    anim_path = ROOT / f'src/data/mapAnim/{island}.json'
    if anim_path.exists():
        anim = json.loads(anim_path.read_text())
        for el in anim.get('elements', []):
            rx, ry, rw, rh = el['rect']
            gdraw.rectangle((rx - 8, ry - 8, rx + rw + 8, ry + rh + 8), fill=255)

    for rect in cfg['extra_rects']:
        gdraw.rectangle(rect, fill=255)
    for ell in cfg['extra_ellipses']:
        gdraw.ellipse(ell, fill=255)

    # 4. Composited solid objects detected by diffing baked map against bare terrain plate.
    cw, ch = iw // 2, ih // 2
    prop_block = Image.new('L', (iw, ih), 0)
    terrain_file = biome_dir / f'terrain-{island}.webp' if biome_dir else None
    terrain_pil = None
    if terrain_file and terrain_file.exists():
        terrain_pil = Image.open(terrain_file).convert('RGB').resize((iw, ih), Image.Resampling.BILINEAR)
        m_sm = np.asarray(map_pil.filter(ImageFilter.GaussianBlur(1.4)), dtype=np.float32)
        t_sm = np.asarray(terrain_pil.filter(ImageFilter.GaussianBlur(1.4)), dtype=np.float32)
        diff_rgb = np.abs(m_sm - t_sm).sum(axis=2)
        h_m, s_m, _ = rgb_to_hsv_np(m_sm)
        h_t, s_t, _ = rgb_to_hsv_np(t_sm)
        dh = np.minimum(np.abs(h_m - h_t), 360.0 - np.abs(h_m - h_t))
        chroma_shift = np.abs(s_m - s_t) * 255.0 + dh * 2.0

        f_hue = cfg['foliage_prop_hue']
        if f_hue is not None:
            is_foliage_prop = (h_m >= f_hue[0]) & (h_m <= f_hue[1]) & (s_m >= cfg['foliage_prop_sat_min'])
        else:
            is_foliage_prop = np.zeros_like(diff_rgb, dtype=bool)

        changed_solid = (
            (diff_rgb > cfg['prop_diff_hard'])
            | ((diff_rgb > cfg['prop_diff_soft']) & (chroma_shift > cfg['prop_chroma_shift']))
        ) & (~is_foliage_prop)

        small_changed = np.asarray(
            Image.fromarray((changed_solid * 255).astype(np.uint8), 'L')
            .resize((cw, ch), Image.Resampling.BOX)
        ) > 95
        big_props = filter_small_components(small_changed, min_area=int(cfg['prop_min_area']))
        prop_block = (
            Image.fromarray((big_props * 255).astype(np.uint8), 'L')
            .resize((iw, ih), Image.Resampling.NEAREST)
            .filter(ImageFilter.MaxFilter(int(cfg['prop_dilate'])))
        )

    # 5. Biome-specific material segmentation (exclude water, rock, stone walls, cliffs, lanterns, etc.).
    stone_block = compute_material_block(
        cfg['material_mode'], map_pil, terrain_pil, cw, ch, iw, ih, int(cfg['stone_dilate'])
    )

    blocked = ImageChops.lighter(ImageChops.lighter(geom_block, prop_block), stone_block)
    hard_clear = ImageChops.darker(ImageChops.darker(land, road_hard), ImageChops.invert(blocked))

    hc_small = np.asarray(hard_clear.resize((cw, ch), Image.Resampling.BOX)) > 128
    hc_clean = filter_small_components(hc_small, min_area=int(cfg['min_grass_area']))
    hard_clear = Image.fromarray((hc_clean * 255).astype(np.uint8), 'L').resize((iw, ih), Image.Resampling.NEAREST)
    hard_clear = ImageChops.darker(hard_clear, road_hard)
    hard_clear = ImageChops.darker(hard_clear, ImageChops.invert(geom_block))

    # 6. Feather ONLY inward onto the grass side.
    eroded = hard_clear.filter(ImageFilter.MinFilter(int(cfg['feather_erode'])))
    feathered = eroded.filter(ImageFilter.GaussianBlur(float(cfg['feather_blur'])))
    full_mask = ImageChops.darker(hard_clear, feathered)

    # 7. Output at target scale and re-enforce hard zeros on roads, plots, entrances, goal, mapAnim.
    ow, oh = max(1, round(iw * scale)), max(1, round(ih * scale))
    out_mask = full_mask.resize((ow, oh), Image.Resampling.BILINEAR)
    hard_out = hard_clear.resize((ow, oh), Image.Resampling.BOX).point(lambda v: 255 if v == 255 else 0)
    out_mask = ImageChops.darker(out_mask, hard_out)

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

    # Diagnostic overlay at layout resolution.
    base = Image.open(map_img_path).convert('RGBA').resize((iw, ih), Image.Resampling.BILINEAR)
    mask_vis = out_mask.resize((iw, ih), Image.Resampling.BILINEAR)
    tint = Image.new('RGBA', (iw, ih), (0, 230, 140, 255))
    tint.putalpha(mask_vis.point(lambda v: int(v * 0.48)))
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
            ov_draw.rectangle((rx, ry, rx + rw, ry + rh), outline=(255, 110, 240, 220), width=2)

    arr = np.asarray(out_mask)
    stats: dict[str, Any] = {
        'island': island,
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
                midx = min(ow - 1, max(0, round((path[i - 1][0] + x) * 0.5 * scale)))
                midy = min(oh - 1, max(0, round((path[i - 1][1] + y) * 0.5 * scale)))
                max_path_val = max(max_path_val, int(arr[midy, midx]))
    max_plot_val = 0
    for px, py in layout.get('plots', []):
        for ox, oy in ((0, 0), (-plot_r * 0.85, 0), (plot_r * 0.85, 0), (0, -plot_r * 0.55), (0, plot_r * 0.55)):
            mx = min(ow - 1, max(0, round((px + ox) * scale)))
            my = min(oh - 1, max(0, round((py + oy) * scale)))
            max_plot_val = max(max_plot_val, int(arr[my, mx]))
    stats['max_path_val'] = max_path_val
    stats['max_plot_val'] = max_plot_val
    return out_mask, overlay.convert('RGB'), stats


def write_fixture(island: str, webp_path: Path) -> dict[str, Any]:
    """Decode the shipped WebP into tests/fixtures/<id>-sway-mask.{gray.gz,json}."""
    im = Image.open(webp_path).convert('L')
    w, h = im.size
    raw = f'{w} {h}\n'.encode('utf-8') + im.tobytes()
    gz_path = ROOT / f'tests/fixtures/{island}-sway-mask.gray.gz'
    gz_path.parent.mkdir(parents=True, exist_ok=True)
    gz_path.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))

    sha = hashlib.sha256(webp_path.read_bytes()).hexdigest()
    meta = {
        'source': str(webp_path.relative_to(ROOT)),
        'sha256': sha,
    }
    meta_path = ROOT / f'tests/fixtures/{island}-sway-mask.json'
    meta_path.write_text(json.dumps(meta, indent=2) + '\n')
    return {'fixture_gz': str(gz_path.relative_to(ROOT)), 'sha256': sha}


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate wind-sway masks for Group B islands.')
    parser.add_argument('island', nargs='?', help='Island id (one of i09, i10, i11, i12, i15)')
    parser.add_argument('--all', action='store_true', help='Generate masks for all Group B wind islands')
    parser.add_argument('--scale', type=float, default=0.5, help='Output mask scale relative to layout (default 0.5)')
    parser.add_argument('--overlay', help='Optional diagnostic overlay path (single island)')
    parser.add_argument('--overlays', action='store_true', help='Write overlays into docs/anim-shots/maplife/<id>/')
    parser.add_argument('--fixtures', action='store_true', help='Write tests/fixtures/<id>-sway-mask.*')
    args = parser.parse_args()

    targets = list(WIND_ISLANDS_B) if args.all else ([args.island] if args.island else [])
    if not targets:
        parser.error('Specify an island id or --all')

    results = []
    for island in targets:
        out_path = ROOT / f'public/art2d/life/{island}-sway.webp'
        out_path.parent.mkdir(parents=True, exist_ok=True)
        mask, overlay, stats = build_sway_mask_b(island, scale=args.scale)
        mask.save(out_path, format='WEBP', lossless=True, method=6)
        stats['out'] = str(out_path.relative_to(ROOT))
        stats['bytes'] = out_path.stat().st_size

        ov_path = Path(args.overlay) if (args.overlay and not args.all) else (
            ROOT / f'docs/anim-shots/maplife/{island}/{island}-sway-mask-overlay.jpg' if args.overlays else None
        )
        if ov_path:
            ov_path.parent.mkdir(parents=True, exist_ok=True)
            if ov_path.suffix.lower() in ('.jpg', '.jpeg'):
                overlay.save(ov_path, quality=88)
            else:
                overlay.save(ov_path)
            stats['overlay'] = str(ov_path.relative_to(ROOT))

        if args.fixtures:
            stats.update(write_fixture(island, out_path))

        results.append(stats)
        if stats['max_path_val'] != 0 or stats['max_plot_val'] != 0:
            sys.exit(f'ERROR ({island}): non-zero mask on path ({stats["max_path_val"]}) or plot ({stats["max_plot_val"]})')

    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
