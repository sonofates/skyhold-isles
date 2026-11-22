#!/usr/bin/env python3
"""Generate precomputed grayscale grass/foliage wind-sway masks for group C islands.

Imports shared helpers from gen_sway_mask.py without modifying it, and applies
biome-tuned HSV thresholds, terrain-prop exclusions, and per-island geometry masks.

Islands in group C with wind sway: i19, i20, i21, i23, i24, l1c.
(i18 and i22 are underground crystal/salt caverns with no swaying foliage.)

Usage:
    python3 tools/map-life/gen_sway_mask_c.py all --overlay-dir docs/anim-shots/maplife --write-fixtures
    python3 tools/map-life/gen_sway_mask_c.py i20 --overlay docs/anim-shots/maplife/i20/i20-sway-mask-overlay.jpg
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

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/map-life'))
sys.path.insert(0, str(ROOT / 'tools/map-compose'))
sys.path.insert(0, str(ROOT / 'tools/map-anim'))

from gen_sway_mask import PLOT_ASPECT, filter_small_components, rgb_to_hsv_np  # noqa: E402
from ground import ROAD_WIDTH_FRACTION, catmull, road_footprint  # noqa: E402
from road_mask import animation_clearance  # noqa: E402

GROUP_C_SWAY_ISLANDS = ('i19', 'i20', 'i21', 'i23', 'i24', 'l1c')

# Per-island biome tuning.
# All coordinates are in 1846x852 layout space.
ISLAND_PARAMS: dict[str, dict[str, Any]] = {
    'i19': {
        # Sunlit tropical figwood meadow: bright yellow-green & emerald turf.
        'land_erode': 25,
        'road_pad': 16,
        'foliage_h': (36.0, 145.0),
        'foliage_s_min': 0.34,
        'foliage_v_min': 0.22,
        'beige_stone': False,
        'prop_foliage_h': (40.0, 120.0),
        'prop_foliage_s': 0.45,
        'stone_min_area': 24,
        'stone_dilate': 9,
        'grass_min_area': 45,
        # Giant ancient fig tree trunk/roots/buttresses in center (crown is already in mapAnim).
        'extra_ellipses': [
            (922, 472, 162, 108),  # trunk + spreading roots + central flowers on roots
        ],
        'extra_rects': [
            (745, 225, 355, 220),  # full fig crown + upper trunk shadow
        ],
    },
    'i20': {
        # Stormy coastal headland: muted desaturated olive-ochre grass & marram,
        # grey shingle/basalt roads, rocky sea cliffs & dark ocean surf.
        'land_erode': 27,
        'road_pad': 18,
        'foliage_h': (36.0, 118.0),
        'foliage_s_min': 0.23,
        'foliage_v_min': 0.20,
        'beige_stone': False,
        'prop_foliage_h': (38.0, 95.0),
        'prop_foliage_s': 0.34,
        'stone_min_area': 20,
        'stone_dilate': 11,
        'grass_min_area': 45,
        'extra_ellipses': [
            (118, 695, 118, 128),  # bottom-left storm masthead + rocky outcrop
        ],
        'extra_rects': [],
    },
    'i21': {
        # Breezy chalk downland: sunlit olive/golden-green turf, pale chalk road,
        # red-gold fallen weather kite & rope in center.
        'land_erode': 25,
        'road_pad': 16,
        'foliage_h': (38.0, 125.0),
        'foliage_s_min': 0.38,
        'foliage_v_min': 0.24,
        'beige_stone': True,
        'prop_foliage_h': (40.0, 90.0),
        'prop_foliage_s': 0.56,
        'stone_min_area': 22,
        'stone_dilate': 11,
        'grass_min_area': 45,
        # Fallen red-gold weather kite + tails + coiled rope (painted into terrain-i21).
        'extra_ellipses': [
            (912, 418, 86, 84),    # diamond kite body
            (846, 466, 62, 34),    # red/gold kite tails
            (980, 468, 72, 40),    # coiled kite line
        ],
        'extra_rects': [],
    },
    'i23': {
        # Golden autumn orchard meadow: warm golden-ochre & olive grass (H~40-62, high S),
        # brown dirt road, terracotta brick court, autumn apple/berry border boughs.
        'land_erode': 25,
        'road_pad': 16,
        'foliage_h': (38.0, 110.0),
        'foliage_s_min': 0.55,
        'foliage_v_min': 0.26,
        'beige_stone': False,
        'prop_foliage_h': (42.0, 88.0),
        'prop_foliage_s': 0.72,
        'stone_min_area': 18,
        'stone_dilate': 9,
        'grass_min_area': 45,
        'extra_ellipses': [
            (130, 68, 195, 115),   # top-left apple bough canopy
            (1720, 95, 200, 135),  # top-right hollow beehive tree & bough
            (145, 785, 225, 118),  # bottom-left apple bough
        ],
        'extra_rects': [],
    },
    'i24': {
        # Dusk coastal sea-fort headland: deep emerald/olive & sunlit golden coastal grass,
        # rocky cliff ledges, ocean surf on west/east, stone outcrops in grass.
        'land_erode': 27,
        'road_pad': 16,
        'foliage_h': (36.0, 122.0),
        'foliage_s_min': 0.42,
        'foliage_v_min': 0.16,
        'beige_stone': False,
        'prop_foliage_h': (40.0, 105.0),
        'prop_foliage_s': 0.48,
        'stone_min_area': 14,
        'stone_dilate': 11,
        'grass_min_area': 45,
        'extra_ellipses': [
            (1158, 558, 62, 86),   # lighthouse beacon tower + base
            (1148, 646, 48, 42),   # keeper + keeper slates
            (585, 106, 56, 26),    # flat mossy coastal rock slab (north-west)
            (1312, 505, 48, 26),   # flat mossy coastal rock slab (east)
        ],
        'extra_rects': [],
    },
    'l1c': {
        # Classic storybook sunny meadow (no land/terrain files):
        # bright green grass (H~52-105) + white daisies; ochre dirt road, rocky caves,
        # grey boulders, stone castle, windmill, fir/oak/orange trees.
        'land_erode': 0,
        'road_pad': 20,
        'foliage_h': (50.0, 120.0),
        'foliage_s_min': 0.34,
        'foliage_v_min': 0.24,
        'beige_stone': True,
        'prop_foliage_h': (52.0, 110.0),
        'prop_foliage_s': 0.42,
        'stone_min_area': 18,
        'stone_dilate': 13,
        'grass_min_area': 50,
        # Extra geometric blocks for large props on l1c (no terrain diff available):
        'extra_ellipses': [
            (235, 92, 118, 86),    # Cave A rocky mound
            (225, 388, 118, 86),   # Cave B rocky mound
            (1605, 224, 86, 102),  # Windmill tower & sails base
            (1508, 540, 88, 98),   # Goal castle full body
            (1635, 422, 48, 68),   # East pine tree (trunk + lower base)
            (1752, 398, 56, 68),   # Far-east oak tree
            (1624, 756, 54, 62),   # Southeast orange/oak tree
            (88, 548, 58, 68),     # West orange tree
            (66, 386, 64, 78),     # West pine tree
            (1046, 492, 44, 38),   # Central grey boulder
        ],
        'extra_rects': [],
    },
}


def build_sway_mask_c(island: str, scale: float = 0.5) -> tuple[Image.Image, Image.Image, dict]:
    if island not in ISLAND_PARAMS:
        raise ValueError(f'Unsupported island {island!r}; expected one of {list(ISLAND_PARAMS)}')
    p = ISLAND_PARAMS[island]

    layout_path = ROOT / f'src/data/levels2d/{island}.json'
    layout = json.loads(layout_path.read_text())
    recipes = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())
    recipe = recipes.get(island, {})

    iw, ih = int(layout['imageSize'][0]), int(layout['imageSize'][1])
    map_img_path = ROOT / f'public/art2d/{layout["image"]}.webp'
    map_pil = Image.open(map_img_path).convert('RGB').resize((iw, ih), Image.Resampling.BILINEAR)

    biome = recipe.get('biome', '')
    biome_dir = ROOT / 'design/art-2d/v2/biomes' / biome if biome else None

    # 1. Playable land polygon (excludes sky, ocean, cliff rims, border ruins).
    land_file = biome_dir / f'land-{island}.webp' if biome_dir else None
    if land_file and land_file.exists():
        land = Image.open(land_file).convert('L').resize((iw, ih), Image.Resampling.NEAREST)
        land = land.point(lambda v: 255 if v > 128 else 0)
        erode = int(p['land_erode'])
        if erode >= 3:
            land = land.filter(ImageFilter.MinFilter(erode))
    else:
        land = Image.new('L', (iw, ih), 255)
        ImageDraw.Draw(land).rectangle((0, 0, iw - 1, ih - 1), outline=0, width=16)
    # Keep a thin outer frame margin at 0 so UV sway never samples outside the map texture.
    ImageDraw.Draw(land).rectangle((0, 0, iw - 1, ih - 1), outline=0, width=8)

    # 2. Road clearance from tools/map-anim/road_mask.py + safety padding on every path.
    road_clear = animation_clearance(island).resize((iw, ih), Image.Resampling.BILINEAR)
    road_hard = road_clear.point(lambda v: 255 if v > 250 else 0)
    road_w = ih * ROAD_WIDTH_FRACTION
    paths = [list(map(tuple, pt)) for pt in layout.get('paths', [])]
    splines = [catmull(pt) for pt in paths]
    road_extra = road_footprint((iw, ih), paths + splines, road_w + p['road_pad']).convert('L')
    road_hard = ImageChops.darker(road_hard, ImageChops.invert(road_extra))

    # 3. Hard geometric exclusions: plots, gates, castle, landmarks, mapAnim, island extras.
    geom_block = Image.new('L', (iw, ih), 0)
    gdraw = ImageDraw.Draw(geom_block)

    plot_r = float(layout.get('plotRadiusPx', 48))
    plot_rx = plot_r * 1.24
    plot_ry = plot_r * PLOT_ASPECT * 1.32
    for px, py in layout.get('plots', []):
        gdraw.ellipse((px - plot_rx, py - plot_ry, px + plot_rx, py + plot_ry), fill=255)

    for ent in layout.get('entrances', []):
        ex, ey = float(ent['x']), float(ent['y'])
        gdraw.ellipse((ex - 66, ey - 66, ex + 66, ey + 46), fill=255)
        front = ent.get('gate', {}).get('front', {})
        if 'rect' in front:
            rx, ry, rw, rh = front['rect']
            gdraw.rounded_rectangle((rx - 22, ry - 20, rx + rw + 22, ry + rh + 16), radius=28, fill=255)

    goal = layout.get('goal')
    if goal:
        gx, gy = float(goal[0]), float(goal[1])
        gdraw.ellipse((gx - 72, gy - 86, gx + 112, gy + 66), fill=255)
    goal_front = layout.get('goalGate', {}).get('front', {})
    if 'rect' in goal_front:
        rx, ry, rw, rh = goal_front['rect']
        gdraw.rounded_rectangle((rx - 24, ry - 28, rx + rw + 36, ry + rh + 20), radius=34, fill=255)

    for lm in recipe.get('landmarks', []) + recipe.get('groundPaint', []):
        name, lx, lyb, lh = lm[0], float(lm[1]), float(lm[2]), float(lm[3])
        lw = lh * 1.25
        if biome_dir:
            sprites_map = recipe.get('sprites', {})
            cand = sprites_map.get(f'landmark-{name}.webp', f'landmark-{name}.webp')
            lm_file = biome_dir / cand
            if not lm_file.exists():
                lm_file = biome_dir / f'{name}.webp'
            if lm_file.exists():
                im_lm = Image.open(lm_file)
                lw = lh * im_lm.width / max(1, im_lm.height)
        gdraw.rounded_rectangle(
            (lx - lw * 0.58 - 14, lyb - lh - 14, lx + lw * 0.58 + 14, lyb + 14),
            radius=24,
            fill=255,
        )

    anim_path = ROOT / f'src/data/mapAnim/{island}.json'
    if anim_path.exists():
        anim = json.loads(anim_path.read_text())
        for el in anim.get('elements', []):
            rx, ry, rw, rh = el['rect']
            gdraw.rectangle((rx - 8, ry - 8, rx + rw + 8, ry + rh + 8), fill=255)

    for cx, cy, erx, ery in p.get('extra_ellipses', []):
        gdraw.ellipse((cx - erx, cy - ery, cx + erx, cy + ery), fill=255)
    for rx, ry, rw, rh in p.get('extra_rects', []):
        gdraw.rectangle((rx, ry, rx + rw, ry + rh), fill=255)

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
        pf_lo, pf_hi = p['prop_foliage_h']
        is_foliage_prop = (h_m >= pf_lo) & (h_m <= pf_hi) & (s_m >= p['prop_foliage_s'])
        changed_solid = ((diff_rgb > 58.0) | ((diff_rgb > 36.0) & (chroma_shift > 32.0))) & (~is_foliage_prop)
        small_changed = np.asarray(
            Image.fromarray((changed_solid * 255).astype(np.uint8), 'L')
            .resize((cw, ch), Image.Resampling.BOX)
        ) > 100
        big_props = filter_small_components(small_changed, min_area=20)
        prop_block = (
            Image.fromarray((big_props * 255).astype(np.uint8), 'L')
            .resize((iw, ih), Image.Resampling.NEAREST)
            .filter(ImageFilter.MaxFilter(15))
        )

    # 5. Material segmentation on slightly smoothed map: keep only biome foliage/grass hues,
    #    block rocks, stone paving, roofs, water, wood, dark shadows, dirt/sand outside grass range.
    smooth_rgb = np.asarray(map_pil.filter(ImageFilter.GaussianBlur(2.4)), dtype=np.float32)
    h_s, s_s, v_s = rgb_to_hsv_np(smooth_rgb)
    r_s, g_s = smooth_rgb[..., 0], smooth_rgb[..., 1]

    h_lo, h_hi = p['foliage_h']
    is_non_foliage = (s_s < p['foliage_s_min']) | (v_s < p['foliage_v_min']) | (h_s < h_lo) | (h_s > h_hi)
    if p['beige_stone']:
        is_beige = (s_s < 0.52) & (h_s < 51.0) & ((g_s - r_s) < -17.0) & (v_s > 0.45)
        is_non_foliage = is_non_foliage | is_beige

    st_small = np.asarray(
        Image.fromarray((is_non_foliage * 255).astype(np.uint8), 'L')
        .resize((cw, ch), Image.Resampling.BOX)
    ) > 110
    st_closed_img = Image.fromarray((st_small * 255).astype(np.uint8), 'L')
    st_closed_img = st_closed_img.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    st_clean = filter_small_components(np.asarray(st_closed_img) > 128, min_area=int(p['stone_min_area']))
    stone_block = (
        Image.fromarray((st_clean * 255).astype(np.uint8), 'L')
        .resize((iw, ih), Image.Resampling.NEAREST)
        .filter(ImageFilter.MaxFilter(int(p['stone_dilate'])))
    )

    blocked = ImageChops.lighter(ImageChops.lighter(geom_block, prop_block), stone_block)
    hard_clear = ImageChops.darker(ImageChops.darker(land, road_hard), ImageChops.invert(blocked))

    hc_small = np.asarray(hard_clear.resize((cw, ch), Image.Resampling.BOX)) > 128
    hc_clean = filter_small_components(hc_small, min_area=int(p['grass_min_area']))
    hard_clear = Image.fromarray((hc_clean * 255).astype(np.uint8), 'L').resize((iw, ih), Image.Resampling.NEAREST)
    hard_clear = ImageChops.darker(hard_clear, road_hard)
    hard_clear = ImageChops.darker(hard_clear, ImageChops.invert(geom_block))

    # 6. Feather ONLY inward onto the grass side (protected inner boundary stays strictly 0).
    eroded = hard_clear.filter(ImageFilter.MinFilter(9))
    feathered = eroded.filter(ImageFilter.GaussianBlur(5.5))
    full_mask = ImageChops.darker(hard_clear, feathered)

    # 7. Output at target scale and re-enforce hard zeros on roads, plots, entrances, goal.
    ow, oh = max(1, round(iw * scale)), max(1, round(ih * scale))
    out_mask = full_mask.resize((ow, oh), Image.Resampling.BILINEAR)
    hard_out = hard_clear.resize((ow, oh), Image.Resampling.BOX).point(lambda v: 255 if v == 255 else 0)
    out_mask = ImageChops.darker(out_mask, hard_out)

    odraw = ImageDraw.Draw(out_mask)
    for path in paths:
        pts = [(x * scale, y * scale) for x, y in path]
        odraw.line(pts, fill=0, width=max(3, math.ceil((road_w + 10) * scale)), joint='curve')
        for x, y in pts:
            r = max(2, math.ceil((road_w * 0.5 + 5) * scale))
            odraw.ellipse((x - r, y - r, x + r, y + r), fill=0)
    for px, py in layout.get('plots', []):
        odraw.ellipse(
            ((px - plot_rx) * scale, (py - plot_ry) * scale, (px + plot_rx) * scale, (py + plot_ry) * scale),
            fill=0,
        )

    # Build visual diagnostic overlay at layout resolution.
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
            ov_draw.rectangle((rx, ry, rx + rw, ry + rh), outline=(80, 180, 255, 180), width=2)

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
                px0, py0 = path[i - 1]
                mx2 = min(ow - 1, max(0, round((px0 + x) * 0.5 * scale)))
                my2 = min(oh - 1, max(0, round((py0 + y) * 0.5 * scale)))
                max_path_val = max(max_path_val, int(arr[my2, mx2]))
    max_plot_val = 0
    for px, py in layout.get('plots', []):
        for dx, dy in [(0, 0), (-plot_r * 0.85, 0), (plot_r * 0.85, 0), (0, -plot_r * 0.55), (0, plot_r * 0.55)]:
            mx = min(ow - 1, max(0, round((px + dx) * scale)))
            my = min(oh - 1, max(0, round((py + dy) * scale)))
            max_plot_val = max(max_plot_val, int(arr[my, mx]))
    stats['max_path_val'] = max_path_val
    stats['max_plot_val'] = max_plot_val
    return out_mask, overlay.convert('RGB'), stats


def write_fixture(island: str, webp_path: Path) -> dict[str, str]:
    """Write tests/fixtures/<island>-sway-mask.{gray.gz,json} from the shipped lossless WebP."""
    raw_bytes = webp_path.read_bytes()
    sha = hashlib.sha256(raw_bytes).hexdigest()
    im = Image.open(webp_path).convert('L')
    header = f'{im.width} {im.height}\n'.encode('ascii')
    gz_path = ROOT / f'tests/fixtures/{island}-sway-mask.gray.gz'
    gz_path.parent.mkdir(parents=True, exist_ok=True)
    gz_path.write_bytes(gzip.compress(header + im.tobytes(), compresslevel=9, mtime=0))
    meta = {
        'source': str(webp_path.relative_to(ROOT)),
        'sha256': sha,
    }
    meta_path = ROOT / f'tests/fixtures/{island}-sway-mask.json'
    meta_path.write_text(json.dumps(meta, indent=2) + '\n')
    return meta


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate grass wind-sway masks for group C islands.')
    parser.add_argument('islands', nargs='+', help='Island ids (e.g. i19 i20) or "all"')
    parser.add_argument('--scale', type=float, default=0.5, help='Output mask scale (default 0.5)')
    parser.add_argument('--overlay', help='Diagnostic overlay path (single island)')
    parser.add_argument('--overlay-dir', help='Directory to write <dir>/<id>/<id>-sway-mask-overlay.jpg')
    parser.add_argument('--write-fixtures', action='store_true', help='Also write tests/fixtures/<id>-sway-mask.*')
    args = parser.parse_args()

    targets = list(GROUP_C_SWAY_ISLANDS) if args.islands == ['all'] else args.islands
    results = []
    for island in targets:
        out_path = ROOT / f'public/art2d/life/{island}-sway.webp'
        out_path.parent.mkdir(parents=True, exist_ok=True)
        mask, overlay, stats = build_sway_mask_c(island, scale=args.scale)
        mask.save(out_path, format='WEBP', lossless=True, method=6)
        stats['out'] = str(out_path.relative_to(ROOT))
        stats['bytes'] = out_path.stat().st_size

        ov_path: Path | None = None
        if args.overlay and len(targets) == 1:
            ov_path = Path(args.overlay)
        elif args.overlay_dir:
            ov_path = Path(args.overlay_dir) / island / f'{island}-sway-mask-overlay.jpg'
        if ov_path is not None:
            ov_path.parent.mkdir(parents=True, exist_ok=True)
            if ov_path.suffix.lower() in ('.jpg', '.jpeg'):
                overlay.save(ov_path, quality=88)
            else:
                overlay.save(ov_path)
            stats['overlay'] = str(ov_path)

        if args.write_fixtures:
            meta = write_fixture(island, out_path)
            stats['sha256'] = meta['sha256'][:12]

        results.append(stats)
        if stats['max_path_val'] != 0 or stats['max_plot_val'] != 0:
            sys.exit(f'ERROR ({island}): non-zero mask on path ({stats["max_path_val"]}) or plot ({stats["max_plot_val"]})')

    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
