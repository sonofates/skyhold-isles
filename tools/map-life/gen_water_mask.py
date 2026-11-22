#!/usr/bin/env python3
"""Generate precomputed water (i10, i15) and open-sand heat-haze (i14) surface masks for MapLifeLayer.

Masks are grayscale WebP at 0.5x layout resolution (923x426 for 1846x852 maps):
  - White (255) = active water surface (i10 streams/weir, i15 ponds/moon-well) or open sand (i14 haze).
  - Black (0)   = strictly stationary (roads, plots, bridges, stones, lily pads, plants, buildings,
                  caves, castle, cliffs, courtyard flagstones, and existing mapAnim video-loop rects).

Usage:
    python3 tools/map-life/gen_water_mask.py --all --overlays --fixtures
    python3 tools/map-life/gen_water_mask.py i10 --overlay docs/anim-shots/maplife/i10/i10-water-mask-overlay.jpg
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
from gen_sway_mask_b import erode_mask  # noqa: E402

SURFACE_ISLANDS = ('i10', 'i14', 'i15')

MASK_STEMS: dict[str, str] = {
    'i10': 'water',
    'i14': 'haze',
    'i15': 'water',
}


def build_common_exclusions(
    island: str,
    layout: dict[str, Any],
    recipe: dict[str, Any],
    iw: int,
    ih: int,
    biome_dir: Path | None,
    *,
    skip_landmarks: set[str] | None = None,
    road_pad: int = 16,
    anim_pad: int = 8,
    crossing_pad: int = 20,
    plot_scale_x: float = 1.24,
    plot_scale_y: float = 1.32,
) -> tuple[Image.Image, Image.Image, list[list[tuple[float, float]]], float, float, float]:
    """Return (road_hard, geom_block, paths, road_w, plot_rx, plot_ry)."""
    road_clear = animation_clearance(island).resize((iw, ih), Image.Resampling.BILINEAR)
    road_hard = road_clear.point(lambda v: 255 if v > 250 else 0)
    road_w = ih * ROAD_WIDTH_FRACTION
    paths = [list(map(tuple, p)) for p in layout.get('paths', [])]
    splines = [catmull(p) for p in paths]
    road_extra = road_footprint((iw, ih), paths + splines, road_w + road_pad).convert('L')
    road_hard = ImageChops.darker(road_hard, ImageChops.invert(road_extra))

    geom_block = Image.new('L', (iw, ih), 0)
    gdraw = ImageDraw.Draw(geom_block)

    plot_r = float(layout.get('plotRadiusPx', 48))
    plot_rx = plot_r * plot_scale_x
    plot_ry = plot_r * PLOT_ASPECT * plot_scale_y
    for px, py in layout.get('plots', []):
        gdraw.ellipse((px - plot_rx, py - plot_ry, px + plot_rx, py + plot_ry), fill=255)

    for ent in layout.get('entrances', []):
        ex, ey = float(ent['x']), float(ent['y'])
        gdraw.ellipse((ex - 70, ey - 70, ex + 70, ey + 48), fill=255)
        front = ent.get('gate', {}).get('front', {})
        if 'rect' in front:
            rx, ry, rw, rh = front['rect']
            gdraw.rounded_rectangle((rx - 20, ry - 18, rx + rw + 20, ry + rh + 16), radius=26, fill=255)

    goal = layout.get('goal')
    if goal:
        gx, gy = float(goal[0]), float(goal[1])
        gdraw.ellipse((gx - 72, gy - 84, gx + 108, gy + 58), fill=255)
    goal_front = layout.get('goalGate', {}).get('front', {})
    if 'rect' in goal_front:
        rx, ry, rw, rh = goal_front['rect']
        gdraw.rounded_rectangle((rx - 18, ry - 24, rx + rw + 26, ry + rh + 14), radius=28, fill=255)

    skip = skip_landmarks or set()
    for lm in recipe.get('landmarks', []) + recipe.get('groundPaint', []):
        name, lx, lyb, lh = lm[0], float(lm[1]), float(lm[2]), float(lm[3])
        if name in skip:
            continue
        lw = lh * 1.25
        if biome_dir:
            lm_file = biome_dir / f'landmark-{name}.webp'
            if lm_file.exists():
                im_lm = Image.open(lm_file)
                lw = lh * im_lm.width / max(1, im_lm.height)
        gdraw.rounded_rectangle((lx - lw * 0.56 - 12, lyb - lh - 12, lx + lw * 0.56 + 12, lyb + 12), radius=22, fill=255)

    for _, cx, cy, length, breadth, angle in recipe.get('crossings', []):
        sin, cos = math.sin(math.radians(angle)), math.cos(math.radians(angle))
        b_pad, l_pad = breadth + crossing_pad, length + crossing_pad
        gdraw.polygon(
            [
                (cx + u * b_pad * cos + v * l_pad * sin, cy - u * b_pad * sin + v * l_pad * cos)
                for u, v in [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
            ],
            fill=255,
        )

    anim_path = ROOT / f'src/data/mapAnim/{island}.json'
    if anim_path.exists():
        anim = json.loads(anim_path.read_text())
        for el in anim.get('elements', []):
            rx, ry, rw, rh = el['rect']
            gdraw.rectangle((rx - anim_pad, ry - anim_pad, rx + rw + anim_pad, ry + rh + anim_pad), fill=255)

    return road_hard, geom_block, paths, road_w, plot_rx, plot_ry


def build_i10_water(
    layout: dict[str, Any],
    recipe: dict[str, Any],
    map_pil: Image.Image,
    biome_dir: Path,
    iw: int,
    ih: int,
) -> tuple[Image.Image, Image.Image, list[list[tuple[float, float]]], float, float, float]:
    """Segment the flowing stream, tributary, and sluice/weir chute on i10."""
    road_hard, geom_block, paths, road_w, plot_rx, plot_ry = build_common_exclusions(
        'i10',
        layout,
        recipe,
        iw,
        ih,
        biome_dir,
        skip_landmarks={'sluice'},  # Sluice water chute is masked by colour below (stone walls excluded).
        road_pad=16,
        anim_pad=6,
        crossing_pad=22,
    )

    land_pil = Image.open(biome_dir / 'land-i10.webp').convert('L').resize((iw, ih), Image.Resampling.NEAREST)
    # Channel silhouette is black (0) in land-i10.webp.
    channel_roi = ImageChops.invert(land_pil.point(lambda v: 255 if v > 128 else 0)).filter(ImageFilter.MaxFilter(5))
    # Ensure bottom sluice/weir region is inside ROI.
    sluice_roi = Image.new('L', (iw, ih), 0)
    ImageDraw.Draw(sluice_roi).rectangle((922, 756, 1004, 852), fill=255)
    water_roi = np.asarray(ImageChops.lighter(channel_roi, sluice_roi)) > 128

    map_rgb = np.asarray(map_pil, dtype=np.float32)
    h_m, s_m, v_m = rgb_to_hsv_np(map_rgb)

    terrain_pil = Image.open(biome_dir / 'terrain-i10.webp').convert('RGB').resize((iw, ih), Image.Resampling.BILINEAR)
    terr_rgb = np.asarray(terrain_pil, dtype=np.float32)
    h_t, s_t, _ = rgb_to_hsv_np(terr_rgb)

    # Water on i10: cool greenish-teal stream (H 106..210, S >= 0.16) vs olive grass (H 55..68) and brown banks (H < 52).
    is_stream_col = (h_m >= 106.0) & (h_m <= 215.0) & (s_m >= 0.16) & (v_m >= 0.24)
    # Also confirm terrain underneath is water (outside the sluice where the landmark paints the weir chute).
    in_sluice = np.asarray(sluice_roi) > 128
    is_terrain_water = (h_t >= 104.0) & (h_t <= 215.0) & (s_t >= 0.15)
    # Inside sluice: bright turquoise chute + white frothy weir drop (never stone/wood walls where H < 98).
    yy, xx = np.mgrid[0:ih, 0:iw]
    is_weir_foam = (
        (xx >= 948)
        & (xx <= 974)
        & (yy >= 793)
        & (yy <= 812)
        & (s_m < 0.26)
        & (v_m > 0.60)
    )
    is_sluice_water = in_sluice & (((h_m >= 112.0) & (h_m <= 210.0) & (s_m >= 0.16)) | is_weir_foam)

    # Detect composited props on the stream (rocks, lantern post, bridge piers, ferns) outside the sluice.
    # Require a large RGB jump or hue/saturation shift so compose.py's subtle edge vignette does not clip the NW chute.
    m_sm = np.asarray(map_pil.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)
    t_sm = np.asarray(terrain_pil.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)
    diff_rgb = np.abs(m_sm - t_sm).sum(axis=2)
    h_ms, s_ms, _ = rgb_to_hsv_np(m_sm)
    h_ts, s_ts, _ = rgb_to_hsv_np(t_sm)
    dh = np.minimum(np.abs(h_ms - h_ts), 360.0 - np.abs(h_ms - h_ts))
    chroma_shift = np.abs(s_ms - s_ts) * 255.0 + dh * 2.0
    prop_on_stream = ((diff_rgb > 68.0) | ((diff_rgb > 38.0) & (chroma_shift > 28.0))) & (~in_sluice)
    prop_block = (
        Image.fromarray((prop_on_stream * 255).astype(np.uint8), 'L')
        .filter(ImageFilter.MaxFilter(7))
    )

    raw_water = water_roi & ((is_stream_col & is_terrain_water) | is_sluice_water)
    raw_img = Image.fromarray((raw_water * 255).astype(np.uint8), 'L')
    # Close 1px noise inside water, then erode inward from banks/stones/sluice walls so edges never shimmer.
    raw_img = raw_img.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    # Keep sluice chute delicate (only 3px erosion there) vs 5px inward margin on main stream banks.
    main_eroded = raw_img.filter(ImageFilter.MinFilter(5))
    sluice_eroded = ImageChops.darker(raw_img.filter(ImageFilter.MinFilter(3)), sluice_roi)
    water_clean = ImageChops.lighter(main_eroded, sluice_eroded)

    # Keep small outer border margin (4px) so UV offsets never clamp visibly at edges.
    ImageDraw.Draw(water_clean).rectangle((0, 0, iw - 1, ih - 1), outline=0, width=4)

    blocked = ImageChops.lighter(geom_block, prop_block)
    hard_clear = ImageChops.darker(ImageChops.darker(water_clean, road_hard), ImageChops.invert(blocked))

    # Drop tiny isolated specks (< 12 px at half res) while preserving sluice channels.
    cw, ch = iw // 2, ih // 2
    hc_small = np.asarray(hard_clear.resize((cw, ch), Image.Resampling.BOX)) > 110
    hc_filt = filter_small_components(hc_small, min_area=12)
    hard_clear = Image.fromarray((hc_filt * 255).astype(np.uint8), 'L').resize((iw, ih), Image.Resampling.NEAREST)
    hard_clear = ImageChops.darker(hard_clear, road_hard)
    hard_clear = ImageChops.darker(hard_clear, ImageChops.invert(blocked))

    # Inward feathering: soft blend to 0 strictly inside the water boundary.
    eroded = hard_clear.filter(ImageFilter.MinFilter(5))
    feathered = eroded.filter(ImageFilter.GaussianBlur(3.2))
    # Keep the narrow sluice chute slightly stronger so the weir water stays visible.
    sluice_soft = ImageChops.darker(hard_clear.filter(ImageFilter.GaussianBlur(1.6)), sluice_roi)
    full_mask = ImageChops.darker(hard_clear, ImageChops.lighter(feathered, sluice_soft))

    return hard_clear, full_mask, paths, road_w, plot_rx, plot_ry


def build_i15_water(
    layout: dict[str, Any],
    recipe: dict[str, Any],
    map_pil: Image.Image,
    biome_dir: Path,
    iw: int,
    ih: int,
) -> tuple[Image.Image, Image.Image, list[list[tuple[float, float]]], float, float, float]:
    """Segment the 3 moonlit ponds and moon-well pool on i15, excluding lily pads, stones, reeds, plots, roads."""
    road_hard, geom_block, paths, road_w, plot_rx, plot_ry = build_common_exclusions(
        'i15',
        layout,
        recipe,
        iw,
        ih,
        biome_dir,
        skip_landmarks={'well'},  # Moon-well inner pool is masked by colour below (stone rim excluded).
        road_pad=16,
        anim_pad=6,
        crossing_pad=20,
    )

    # Hand-checked regions for the 3 moonlit ponds + moon-well basin.
    ponds_roi = Image.new('L', (iw, ih), 0)
    pdraw = ImageDraw.Draw(ponds_roi)
    pdraw.ellipse((14, 102, 314, 634), fill=255)      # West moonlit cove
    pdraw.rectangle((1230, 0, 1846, 174), fill=255)   # Northeast reflection pond
    pdraw.ellipse((892, 466, 1284, 666), fill=255)    # South-center lily pond

    well_roi = Image.new('L', (iw, ih), 0)
    ImageDraw.Draw(well_roi).ellipse((683, 474, 722, 498), fill=255)

    # Explicit hand-checked exclusions for lotus flowers, lily pad clusters, shore reeds, and mossy rock.
    lily_block = Image.new('L', (iw, ih), 0)
    ldraw = ImageDraw.Draw(lily_block)
    for ell in (
        # West pond: lotus + lily pads, upper reeds, left shore reeds
        (190, 160, 248, 210),   # upper-right lily pads
        (225, 340, 298, 396),   # mid-right white lotus + pads
        (40, 444, 130, 514),    # lower-left white lotus + pads
        (96, 516, 146, 558),    # lower-left pad cluster
        (230, 96, 324, 295),    # NE shore tall reeds
        (0, 326, 86, 472),      # west shore reeds + lantern
        # Northeast pond: lotus flowers, lily pads, shore reeds
        (1290, 50, 1396, 118),  # west lily pad + lotus
        (1716, 10, 1824, 88),   # east lily pad + lotus
        (1532, 104, 1612, 142), # south-edge pad
        (1170, 0, 1298, 130),   # west shore reeds
        (1612, 72, 1728, 168),  # SE reeds
        # South-center pond: mossy rock, left & right lotus/lily clusters, shore reeds
        (916, 558, 1072, 652),  # left mossy boulder + white lotus + lily pads
        (1152, 540, 1272, 616), # right white lotus + lily pads
        (884, 516, 956, 616),   # west shore reeds
        (1238, 578, 1296, 650), # east shore reeds
    ):
        ldraw.ellipse(ell, fill=255)

    map_rgb = np.asarray(map_pil, dtype=np.float32)
    h_m, s_m, v_m = rgb_to_hsv_np(map_rgb)

    terrain_pil = Image.open(biome_dir / 'terrain-i15.webp').convert('RGB').resize((iw, ih), Image.Resampling.BILINEAR)
    terr_rgb = np.asarray(terrain_pil, dtype=np.float32)
    h_t, s_t, v_t = rgb_to_hsv_np(terr_rgb)

    # Pond water on terrain plate: cool teal-blue (H 176..218) vs purple-periwinkle grass (H 222..236),
    # plus bright silvery moonlight reflection ribbons inside the ponds.
    in_ponds = np.asarray(ponds_roi) > 128
    in_well = np.asarray(well_roi) > 128
    is_pond_teal = (h_t >= 176.0) & (h_t <= 217.5) & (s_t >= 0.14) & (v_t >= 0.28)
    is_moon_streak = (h_t >= 130.0) & (h_t <= 220.0) & (s_t < 0.24) & (v_t >= 0.56)
    is_map_water = (
        ((h_m >= 174.0) & (h_m <= 218.5) & (s_m >= 0.14) & (v_m >= 0.28))
        | ((h_m >= 130.0) & (h_m <= 220.0) & (s_m < 0.24) & (v_m >= 0.56))
    )
    pond_water = in_ponds & (is_pond_teal | is_moon_streak) & is_map_water

    # Moon-well pool: vibrant cyan-turquoise inside the stone well rim (excludes tiny lotus & stone rim).
    well_water = in_well & (h_m >= 152.0) & (h_m <= 204.0) & (s_m >= 0.28) & (v_m >= 0.42)

    # Composited props on ponds (standing stones, ringed starry puddles, grass tufts, mushrooms, lantern, cave).
    # Require chroma shift or strong RGB diff so edge vignette darkening does not clip pond corners.
    m_sm = np.asarray(map_pil.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)
    t_sm = np.asarray(terrain_pil.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)
    diff_rgb = np.abs(m_sm - t_sm).sum(axis=2)
    h_ms, s_ms, _ = rgb_to_hsv_np(m_sm)
    h_ts, s_ts, _ = rgb_to_hsv_np(t_sm)
    dh = np.minimum(np.abs(h_ms - h_ts), 360.0 - np.abs(h_ms - h_ts))
    chroma_shift = np.abs(s_ms - s_ts) * 255.0 + dh * 2.0
    prop_on_pond = ((diff_rgb > 54.0) | ((diff_rgb > 26.0) & (chroma_shift > 22.0))) & (~in_well)
    prop_block = (
        Image.fromarray((prop_on_pond * 255).astype(np.uint8), 'L')
        .filter(ImageFilter.MaxFilter(11))
    )

    pond_img = Image.fromarray((pond_water * 255).astype(np.uint8), 'L')
    pond_img = pond_img.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    pond_img = pond_img.filter(ImageFilter.MinFilter(7))  # 3px inward bank margin

    well_img = Image.fromarray((well_water * 255).astype(np.uint8), 'L')
    well_img = well_img.filter(ImageFilter.MinFilter(3))

    water_clean = ImageChops.lighter(pond_img, well_img)
    ImageDraw.Draw(water_clean).rectangle((0, 0, iw - 1, ih - 1), outline=0, width=6)

    blocked = ImageChops.lighter(ImageChops.lighter(geom_block, prop_block), lily_block)
    hard_clear = ImageChops.darker(ImageChops.darker(water_clean, road_hard), ImageChops.invert(blocked))

    # Filter tiny specks on ponds, keeping the small moon-well pool intact.
    cw, ch = iw // 2, ih // 2
    hc_ponds = ImageChops.darker(hard_clear, ponds_roi)
    hc_small = np.asarray(hc_ponds.resize((cw, ch), Image.Resampling.BOX)) > 110
    hc_filt = filter_small_components(hc_small, min_area=18)
    ponds_clean = Image.fromarray((hc_filt * 255).astype(np.uint8), 'L').resize((iw, ih), Image.Resampling.NEAREST)
    well_clean = ImageChops.darker(hard_clear, well_roi)

    hard_clear = ImageChops.lighter(ponds_clean, well_clean)
    hard_clear = ImageChops.darker(hard_clear, road_hard)
    hard_clear = ImageChops.darker(hard_clear, ImageChops.invert(blocked))

    # Inward feathering so pond edges, plot edges, lily pads, and stones never shimmer.
    eroded = ponds_clean.filter(ImageFilter.MinFilter(7))
    feathered_ponds = eroded.filter(ImageFilter.GaussianBlur(4.2))
    feathered_well = ImageChops.darker(well_clean.filter(ImageFilter.GaussianBlur(1.4)), well_clean)
    full_mask = ImageChops.darker(hard_clear, ImageChops.lighter(feathered_ponds, feathered_well))

    return hard_clear, full_mask, paths, road_w, plot_rx, plot_ry


def build_i14_haze(
    layout: dict[str, Any],
    recipe: dict[str, Any],
    map_pil: Image.Image,
    biome_dir: Path,
    iw: int,
    ih: int,
) -> tuple[Image.Image, Image.Image, list[list[tuple[float, float]]], float, float, float]:
    """Segment open terracotta desert sand on i14 for subtle heat-shimmer (off road, plots, courtyard, cliffs)."""
    road_hard, geom_block, paths, road_w, plot_rx, plot_ry = build_common_exclusions(
        'i14',
        layout,
        recipe,
        iw,
        ih,
        biome_dir,
        road_pad=20,
        anim_pad=10,
        crossing_pad=20,
        plot_scale_x=1.28,
        plot_scale_y=1.36,
    )

    # Playable desert basin inside the sandstone cliff rim.
    dress_pil = Image.open(biome_dir / 'dressing-i14.webp').convert('L').resize((iw, ih), Image.Resampling.NEAREST)
    basin = dress_pil.point(lambda v: 255 if v > 128 else 0)
    basin = erode_mask(basin, 25)
    ImageDraw.Draw(basin).rectangle((0, 0, iw - 1, ih - 1), outline=0, width=16)

    # Exclude the tiled stone courtyard on the west side so flagstone joints never wobble.
    courtyard_block = Image.new('L', (iw, ih), 0)
    cdraw = ImageDraw.Draw(courtyard_block)
    cdraw.rounded_rectangle((110, 170, 595, 575), radius=48, fill=255)

    map_rgb = np.asarray(map_pil.filter(ImageFilter.GaussianBlur(1.8)), dtype=np.float32)
    h_m, s_m, v_m = rgb_to_hsv_np(map_rgb)

    terrain_pil = Image.open(biome_dir / 'terrain-i14.webp').convert('RGB').resize((iw, ih), Image.Resampling.BILINEAR)
    terr_rgb = np.asarray(terrain_pil.filter(ImageFilter.GaussianBlur(1.8)), dtype=np.float32)
    h_t, s_t, v_t = rgb_to_hsv_np(terr_rgb)

    # Open terracotta sand: rich red-orange hue (H 11..22.5), high saturation (S >= 0.64), mid-high value.
    # Excludes pale tan roads/tiles (H > 24 or S < 0.60), agaves (H > 40), dark rocks/shadows.
    is_sand = (
        (h_m >= 11.0)
        & (h_m <= 22.5)
        & (s_m >= 0.64)
        & (v_m >= 0.48)
        & (v_m <= 0.88)
        & (h_t >= 11.0)
        & (h_t <= 23.0)
        & (s_t >= 0.62)
    )

    # Composited scatter props (agaves, desert scrub, sandstone columns) detected by diffing map vs terrain.
    diff_rgb = np.abs(map_rgb - terr_rgb).sum(axis=2)
    prop_block = (
        Image.fromarray(((diff_rgb > 36.0) * 255).astype(np.uint8), 'L')
        .filter(ImageFilter.MaxFilter(13))
    )

    sand_img = Image.fromarray((is_sand * 255).astype(np.uint8), 'L')
    blocked = ImageChops.lighter(ImageChops.lighter(geom_block, courtyard_block), prop_block)
    hard_clear = ImageChops.darker(ImageChops.darker(basin, road_hard), sand_img)
    hard_clear = ImageChops.darker(hard_clear, ImageChops.invert(blocked))

    cw, ch = iw // 2, ih // 2
    hc_small = np.asarray(hard_clear.resize((cw, ch), Image.Resampling.BOX)) > 128
    hc_filt = filter_small_components(hc_small, min_area=80)
    hard_clear = Image.fromarray((hc_filt * 255).astype(np.uint8), 'L').resize((iw, ih), Image.Resampling.NEAREST)
    hard_clear = ImageChops.darker(hard_clear, road_hard)
    hard_clear = ImageChops.darker(hard_clear, ImageChops.invert(blocked))

    # Broad soft inward feathering for calm heat shimmer strictly inside open sand stretches.
    eroded = hard_clear.filter(ImageFilter.MinFilter(11))
    feathered = eroded.filter(ImageFilter.GaussianBlur(7.5))
    full_mask = ImageChops.darker(hard_clear, feathered)

    return hard_clear, full_mask, paths, road_w, plot_rx, plot_ry


def build_surface_mask(island: str, scale: float = 0.5) -> tuple[Image.Image, Image.Image, dict[str, Any]]:
    if island not in SURFACE_ISLANDS:
        raise ValueError(f'Unsupported island: {island} (expected one of {SURFACE_ISLANDS})')

    layout = json.loads((ROOT / f'src/data/levels2d/{island}.json').read_text())
    recipes = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())
    recipe = recipes.get(island, {})
    iw, ih = int(layout['imageSize'][0]), int(layout['imageSize'][1])

    map_img_path = ROOT / f'public/art2d/{layout["image"]}.webp'
    map_pil = Image.open(map_img_path).convert('RGB').resize((iw, ih), Image.Resampling.BILINEAR)
    biome_dir = ROOT / 'design/art-2d/v2/biomes' / recipe['biome']

    if island == 'i10':
        hard_clear, full_mask, paths, road_w, plot_rx, plot_ry = build_i10_water(layout, recipe, map_pil, biome_dir, iw, ih)
        tint_rgb = (40, 215, 255)
    elif island == 'i15':
        hard_clear, full_mask, paths, road_w, plot_rx, plot_ry = build_i15_water(layout, recipe, map_pil, biome_dir, iw, ih)
        tint_rgb = (90, 210, 255)
    else:
        hard_clear, full_mask, paths, road_w, plot_rx, plot_ry = build_i14_haze(layout, recipe, map_pil, biome_dir, iw, ih)
        tint_rgb = (255, 195, 50)

    # Downscale to output mask size and strictly enforce 0 on roads & plots.
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
    tint = Image.new('RGBA', (iw, ih), (*tint_rgb, 255))
    tint.putalpha(mask_vis.point(lambda v: int(v * 0.58)))
    overlay = Image.alpha_composite(base, tint)
    ov_draw = ImageDraw.Draw(overlay)
    for path in paths:
        ov_draw.line(path, fill=(255, 60, 60, 220), width=2)
    plot_r = float(layout.get('plotRadiusPx', 48))
    for px, py in layout.get('plots', []):
        ov_draw.ellipse(
            (px - plot_r, py - plot_r * PLOT_ASPECT, px + plot_r, py + plot_r * PLOT_ASPECT),
            outline=(255, 220, 40, 230),
            width=2,
        )
    anim_path = ROOT / f'src/data/mapAnim/{island}.json'
    if anim_path.exists():
        anim = json.loads(anim_path.read_text())
        for el in anim.get('elements', []):
            rx, ry, rw, rh = el['rect']
            ov_draw.rectangle((rx, ry, rx + rw, ry + rh), outline=(255, 110, 240, 220), width=2)

    arr = np.asarray(out_mask)
    stats: dict[str, Any] = {
        'island': island,
        'kind': MASK_STEMS[island],
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


def write_fixture(island: str, stem: str, webp_path: Path) -> dict[str, Any]:
    """Decode the shipped WebP into tests/fixtures/<id>-<stem>-mask.{gray.gz,json}."""
    im = Image.open(webp_path).convert('L')
    w, h = im.size
    raw = f'{w} {h}\n'.encode('utf-8') + im.tobytes()
    gz_path = ROOT / f'tests/fixtures/{island}-{stem}-mask.gray.gz'
    gz_path.parent.mkdir(parents=True, exist_ok=True)
    gz_path.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))

    sha = hashlib.sha256(webp_path.read_bytes()).hexdigest()
    meta = {
        'source': str(webp_path.relative_to(ROOT)),
        'sha256': sha,
    }
    meta_path = ROOT / f'tests/fixtures/{island}-{stem}-mask.json'
    meta_path.write_text(json.dumps(meta, indent=2) + '\n')
    return {'fixture_gz': str(gz_path.relative_to(ROOT)), 'sha256': sha}


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate water (i10, i15) & sand-haze (i14) masks.')
    parser.add_argument('island', nargs='?', help='Island id (one of i10, i14, i15)')
    parser.add_argument('--all', action='store_true', help='Generate masks for i10, i14, i15')
    parser.add_argument('--scale', type=float, default=0.5, help='Output mask scale relative to layout (default 0.5)')
    parser.add_argument('--overlay', help='Optional diagnostic overlay path (single island)')
    parser.add_argument('--overlays', action='store_true', help='Write overlays into docs/anim-shots/maplife/<id>/')
    parser.add_argument('--fixtures', action='store_true', help='Write tests/fixtures/<id>-<kind>-mask.*')
    args = parser.parse_args()

    targets = list(SURFACE_ISLANDS) if args.all else ([args.island] if args.island else [])
    if not targets:
        parser.error('Specify an island id or --all')

    results = []
    for island in targets:
        stem = MASK_STEMS[island]
        out_path = ROOT / f'public/art2d/life/{island}-{stem}.webp'
        out_path.parent.mkdir(parents=True, exist_ok=True)
        mask, overlay, stats = build_surface_mask(island, scale=args.scale)
        mask.save(out_path, format='WEBP', lossless=True, method=6)
        stats['out'] = str(out_path.relative_to(ROOT))
        stats['bytes'] = out_path.stat().st_size

        ov_path = Path(args.overlay) if (args.overlay and not args.all) else (
            ROOT / f'docs/anim-shots/maplife/{island}/{island}-{stem}-mask-overlay.jpg' if args.overlays else None
        )
        if ov_path:
            ov_path.parent.mkdir(parents=True, exist_ok=True)
            if ov_path.suffix.lower() in ('.jpg', '.jpeg'):
                overlay.save(ov_path, quality=88)
            else:
                overlay.save(ov_path)
            stats['overlay'] = str(ov_path.relative_to(ROOT))

        if args.fixtures:
            stats.update(write_fixture(island, stem, out_path))

        results.append(stats)
        if stats['max_path_val'] != 0 or stats['max_plot_val'] != 0:
            sys.exit(f'ERROR ({island}): non-zero mask on path ({stats["max_path_val"]}) or plot ({stats["max_plot_val"]})')

    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
