#!/usr/bin/env python3
"""Generate a precomputed grayscale grass/foliage wind-sway mask for a 2D island map.

White (255) = swaying grass / meadow foliage.
Black (0)   = strictly stationary (roads, plots, tower bases, gates, caves, castle,
              landmarks, stone ruins/columns/bells/paving, buildings, cliff edges, sky).

Usage:
    python3 tools/map-life/gen_sway_mask.py i17 [--scale 0.5] [--overlay docs/anim-shots/maplife/i17/i17-sway-mask-overlay.png]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/map-compose'))
sys.path.insert(0, str(ROOT / 'tools/map-anim'))

from ground import ROAD_WIDTH_FRACTION, catmull, road_footprint  # noqa: E402
from road_mask import animation_clearance  # noqa: E402

# Plot base sprite aspect (plot-base.png is 512 x 343) matching src/render2d/plotLayer.ts.
PLOT_ASPECT = 343.0 / 512.0


def rgb_to_hsv_np(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Vectorized RGB (0..255 float32) -> (H in 0..360, S in 0..1, V in 0..1)."""
    r = rgb[..., 0] / 255.0
    g = rgb[..., 1] / 255.0
    b = rgb[..., 2] / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rm = nz & (mx == r)
    gm = nz & (mx == g) & (~rm)
    bm = nz & (~rm) & (~gm)
    h[rm] = 60.0 * (((g[rm] - b[rm]) / d[rm]) % 6.0)
    h[gm] = 60.0 * (((b[gm] - r[gm]) / d[gm]) + 2.0)
    h[bm] = 60.0 * (((r[bm] - g[bm]) / d[bm]) + 4.0)
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0.0)
    return h, s, mx


def filter_small_components(mask_bool: np.ndarray, min_area: int) -> np.ndarray:
    """Keep only 4-connected components with at least `min_area` pixels (pure NumPy BFS)."""
    h, w = mask_bool.shape
    visited = np.zeros((h, w), dtype=bool)
    out = np.zeros((h, w), dtype=bool)
    ys, xs = np.nonzero(mask_bool)
    for sy, sx in zip(ys.tolist(), xs.tolist()):
        if visited[sy, sx]:
            continue
        stack = [(sy, sx)]
        visited[sy, sx] = True
        comp = []
        while stack:
            cy, cx = stack.pop()
            comp.append((cy, cx))
            if cy > 0 and mask_bool[cy - 1, cx] and not visited[cy - 1, cx]:
                visited[cy - 1, cx] = True
                stack.append((cy - 1, cx))
            if cy + 1 < h and mask_bool[cy + 1, cx] and not visited[cy + 1, cx]:
                visited[cy + 1, cx] = True
                stack.append((cy + 1, cx))
            if cx > 0 and mask_bool[cy, cx - 1] and not visited[cy, cx - 1]:
                visited[cy, cx - 1] = True
                stack.append((cy, cx - 1))
            if cx + 1 < w and mask_bool[cy, cx + 1] and not visited[cy, cx + 1]:
                visited[cy, cx + 1] = True
                stack.append((cy, cx + 1))
        if len(comp) >= min_area:
            for cy, cx in comp:
                out[cy, cx] = True
    return out


def build_sway_mask(island: str, scale: float = 0.5) -> tuple[Image.Image, Image.Image, dict]:
    layout_path = ROOT / f'src/data/levels2d/{island}.json'
    layout = json.loads(layout_path.read_text())
    recipes = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())
    recipe = recipes.get(island, {})

    iw, ih = int(layout['imageSize'][0]), int(layout['imageSize'][1])
    map_img_path = ROOT / f'public/art2d/{layout["image"]}.webp'
    map_pil = Image.open(map_img_path).convert('RGB').resize((iw, ih), Image.Resampling.BILINEAR)
    map_rgb = np.asarray(map_pil, dtype=np.float32)

    biome = recipe.get('biome', '')
    biome_dir = ROOT / 'design/art-2d/v2/biomes' / biome if biome else None

    # 1. Playable land polygon (excludes sky, cliff rims, border ruins).
    land_file = biome_dir / f'land-{island}.webp' if biome_dir else None
    if land_file and land_file.exists():
        land = Image.open(land_file).convert('L').resize((iw, ih), Image.Resampling.NEAREST)
        land = land.point(lambda v: 255 if v > 128 else 0)
        # Inward clearance from cliff rim & border ruins so rock edges never wobble.
        land = land.filter(ImageFilter.MinFilter(25))  # 12 px inward
    else:
        land = Image.new('L', (iw, ih), 255)
        draw_edge = ImageDraw.Draw(land)
        draw_edge.rectangle((0, 0, iw - 1, ih - 1), outline=0, width=24)
    # Keep a thin outer frame margin at 0 so UV sway never samples outside the map texture.
    ImageDraw.Draw(land).rectangle((0, 0, iw - 1, ih - 1), outline=0, width=8)

    # 2. Road clearance from tools/map-anim/road_mask.py + explicit safety padding on every path.
    road_clear = animation_clearance(island).resize((iw, ih), Image.Resampling.BILINEAR)
    road_hard = road_clear.point(lambda v: 255 if v > 250 else 0)
    road_w = ih * ROAD_WIDTH_FRACTION
    paths = [list(map(tuple, p)) for p in layout.get('paths', [])]
    splines = [catmull(p) for p in paths]
    road_extra = road_footprint((iw, ih), paths + splines, road_w + 16).convert('L')
    road_hard = ImageChops.darker(road_hard, ImageChops.invert(road_extra))

    # 3. Hard geometric exclusions: plots (ring + shadow + tower base), gates, castle, landmarks, mapAnim.
    geom_block = Image.new('L', (iw, ih), 0)
    gdraw = ImageDraw.Draw(geom_block)

    plot_r = float(layout.get('plotRadiusPx', 48))
    # Plot sprite is 2*plot_r wide, contact shadow is ~1.14x wider; add margin for sway amplitude.
    plot_rx = plot_r * 1.24
    plot_ry = plot_r * PLOT_ASPECT * 1.32
    for px, py in layout.get('plots', []):
        gdraw.ellipse((px - plot_rx, py - plot_ry, px + plot_rx, py + plot_ry), fill=255)

    # Entrance gates & goal gatehouse front rects (expanded with rounded corners for organic edges).
    for ent in layout.get('entrances', []):
        ex, ey = float(ent['x']), float(ent['y'])
        gdraw.ellipse((ex - 64, ey - 64, ex + 64, ey + 44), fill=255)
        front = ent.get('gate', {}).get('front', {})
        if 'rect' in front:
            rx, ry, rw, rh = front['rect']
            gdraw.rounded_rectangle((rx - 22, ry - 20, rx + rw + 22, ry + rh + 16), radius=28, fill=255)

    goal = layout.get('goal')
    if goal:
        gx, gy = float(goal[0]), float(goal[1])
        gdraw.ellipse((gx - 70, gy - 84, gx + 110, gy + 64), fill=255)
    goal_front = layout.get('goalGate', {}).get('front', {})
    if 'rect' in goal_front:
        rx, ry, rw, rh = goal_front['rect']
        gdraw.rounded_rectangle((rx - 22, ry - 28, rx + rw + 36, ry + rh + 20), radius=34, fill=255)

    # Landmarks from campaign recipe (e.g. fallen-bell).
    for lm in recipe.get('landmarks', []) + recipe.get('groundPaint', []):
        name, lx, lyb, lh = lm[0], float(lm[1]), float(lm[2]), float(lm[3])
        lw = lh * 1.25
        if biome_dir:
            lm_file = biome_dir / f'landmark-{name}.webp'
            if lm_file.exists():
                im_lm = Image.open(lm_file)
                lw = lh * im_lm.width / max(1, im_lm.height)
        gdraw.rounded_rectangle((lx - lw * 0.56 - 12, lyb - lh - 12, lx + lw * 0.56 + 12, lyb + 12), radius=24, fill=255)

    # Existing video-loop regions (mapAnim) stay stationary underneath their video matte.
    anim_path = ROOT / f'src/data/mapAnim/{island}.json'
    if anim_path.exists():
        anim = json.loads(anim_path.read_text())
        for el in anim.get('elements', []):
            rx, ry, rw, rh = el['rect']
            gdraw.rectangle((rx - 8, ry - 8, rx + rw + 8, ry + rh + 8), fill=255)

    # 4. Composited solid objects (caves, arcade, castle, fallen bell, stone pillars/capitals)
    #    detected by diffing the baked map against the bare terrain plate.
    #    Use a threshold above compose.py's subtle edge vignette (~25-35) and ignore foliage shrubs.
    cw, ch = iw // 2, ih // 2
    prop_block = Image.new('L', (iw, ih), 0)
    terrain_file = biome_dir / f'terrain-{island}.webp' if biome_dir else None
    if terrain_file and terrain_file.exists():
        terrain_pil = Image.open(terrain_file).convert('RGB').resize((iw, ih), Image.Resampling.BILINEAR)
        # Smooth slightly to ignore fine_detail high-pass brush texture.
        m_sm = np.asarray(map_pil.filter(ImageFilter.GaussianBlur(1.5)), dtype=np.float32)
        t_sm = np.asarray(terrain_pil.filter(ImageFilter.GaussianBlur(1.5)), dtype=np.float32)
        # Compare chroma + strong luminance jumps so edge vignette darkening doesn't trigger false props.
        diff_rgb = np.abs(m_sm - t_sm).sum(axis=2)
        h_m, s_m, v_m = rgb_to_hsv_np(m_sm)
        h_t, s_t, _ = rgb_to_hsv_np(t_sm)
        # Vignette shifts brightness slightly without shifting saturation/hue much; solid stone/building
        # props change either total RGB strongly (>58) or drop saturation / shift hue sharply.
        chroma_shift = np.abs(s_m - s_t) * 255.0 + np.abs(h_m - h_t) * 2.0
        is_foliage_prop = (h_m >= 38.0) & (h_m <= 70.0) & (s_m >= 0.60)
        changed_solid = ((diff_rgb > 58.0) | ((diff_rgb > 36.0) & (chroma_shift > 32.0))) & (~is_foliage_prop)
        small_changed = np.asarray(
            Image.fromarray((changed_solid * 255).astype(np.uint8), 'L')
            .resize((cw, ch), Image.Resampling.BOX)
        ) > 100
        big_props = filter_small_components(small_changed, min_area=24)
        prop_block = (
            Image.fromarray((big_props * 255).astype(np.uint8), 'L')
            .resize((iw, ih), Image.Resampling.NEAREST)
            .filter(ImageFilter.MaxFilter(15))  # 7 px safety ring around stone props/caves/castle
        )

    # 5. Material segmentation on slightly smoothed map: detect stone paving flagstones, ruins,
    #    masonry, grey rocks, and blue-slate roofs while preserving sunlit warm olive grass & flowers.
    smooth_rgb = np.asarray(map_pil.filter(ImageFilter.GaussianBlur(2.4)), dtype=np.float32)
    h_s, s_s, v_s = rgb_to_hsv_np(smooth_rgb)
    r_s, g_s, b_s = smooth_rgb[..., 0], smooth_rgb[..., 1], smooth_rgb[..., 2]

    # Pale warm stone flagstones / masonry: low-to-mid saturation beige/cream (S < 0.52, H < 51, g-r < -17)
    # OR cool grey/blue stone & roofs (S < 0.36 or hue outside foliage range 34..150 deg).
    is_beige_stone = (s_s < 0.52) & (h_s < 51.0) & ((g_s - r_s) < -17.0) & (v_s > 0.45)
    is_grey_or_cool = (s_s < 0.36) | (h_s > 152.0) | (h_s < 32.0)
    is_stone = is_beige_stone | is_grey_or_cool

    st_small = np.asarray(
        Image.fromarray((is_stone * 255).astype(np.uint8), 'L')
        .resize((cw, ch), Image.Resampling.BOX)
    ) > 110
    # Close mortar joints between flagstones gently (3x3 max then min) and drop tiny speckles (<28 px).
    st_closed_img = Image.fromarray((st_small * 255).astype(np.uint8), 'L')
    st_closed_img = st_closed_img.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    st_clean = filter_small_components(np.asarray(st_closed_img) > 128, min_area=28)
    stone_block = (
        Image.fromarray((st_clean * 255).astype(np.uint8), 'L')
        .resize((iw, ih), Image.Resampling.NEAREST)
        .filter(ImageFilter.MaxFilter(11))  # 5 px rim clearance around stone paving
    )

    # Combine all exclusions into hard_clear (255 = swaying grass, 0 = strictly stationary).
    blocked = ImageChops.lighter(ImageChops.lighter(geom_block, prop_block), stone_block)
    hard_clear = ImageChops.darker(ImageChops.darker(land, road_hard), ImageChops.invert(blocked))

    # Drop tiny isolated grass specks (< 45 px at 1/2 res) trapped between stones/roads.
    hc_small = np.asarray(hard_clear.resize((cw, ch), Image.Resampling.BOX)) > 128
    hc_clean = filter_small_components(hc_small, min_area=45)
    hard_clear = Image.fromarray((hc_clean * 255).astype(np.uint8), 'L').resize((iw, ih), Image.Resampling.NEAREST)
    hard_clear = ImageChops.darker(hard_clear, road_hard)
    hard_clear = ImageChops.darker(hard_clear, ImageChops.invert(geom_block))

    # 6. Feather ONLY inward onto the grass side (protected inner boundary stays strictly 0!).
    eroded = hard_clear.filter(ImageFilter.MinFilter(9))
    feathered = eroded.filter(ImageFilter.GaussianBlur(5.5))
    full_mask = ImageChops.darker(hard_clear, feathered)

    # 7. Output at target scale (default 0.5 -> 923x426) and re-enforce hard zeros on roads & plots.
    ow, oh = max(1, round(iw * scale)), max(1, round(ih * scale))
    out_mask = full_mask.resize((ow, oh), Image.Resampling.BILINEAR)
    hard_out = hard_clear.resize((ow, oh), Image.Resampling.BOX).point(lambda v: 255 if v == 255 else 0)
    out_mask = ImageChops.darker(out_mask, hard_out)

    # Guarantee exact 0 at every path vertex/segment and plot ellipse at output resolution.
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
        ov_draw.ellipse((px - plot_r, py - plot_r * PLOT_ASPECT, px + plot_r, py + plot_r * PLOT_ASPECT),
                        outline=(255, 220, 40, 230), width=2)

    arr = np.asarray(out_mask)
    stats = {
        'island': island,
        'size': [ow, oh],
        'nonzero_pct': round(float((arr > 0).mean() * 100.0), 2),
        'strong_pct': round(float((arr >= 128).mean() * 100.0), 2),
        'mean_val': round(float(arr.mean()), 2),
    }

    max_path_val = 0
    for path in paths:
        for x, y in path:
            mx = min(ow - 1, max(0, round(x * scale)))
            my = min(oh - 1, max(0, round(y * scale)))
            max_path_val = max(max_path_val, int(arr[my, mx]))
    max_plot_val = 0
    for px, py in layout.get('plots', []):
        mx = min(ow - 1, max(0, round(px * scale)))
        my = min(oh - 1, max(0, round(py * scale)))
        max_plot_val = max(max_plot_val, int(arr[my, mx]))
    stats['max_path_val'] = max_path_val
    stats['max_plot_val'] = max_plot_val
    return out_mask, overlay.convert('RGB'), stats


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate grass wind-sway mask for an island.')
    parser.add_argument('island', help='Island id (e.g. i17)')
    parser.add_argument('--scale', type=float, default=0.5, help='Output mask scale relative to layout (default 0.5)')
    parser.add_argument('--out', help='Output WebP path (default public/art2d/life/<island>-sway.webp)')
    parser.add_argument('--overlay', help='Optional diagnostic overlay PNG/JPG path')
    args = parser.parse_args()

    out_path = Path(args.out) if args.out else ROOT / f'public/art2d/life/{args.island}-sway.webp'
    out_path.parent.mkdir(parents=True, exist_ok=True)

    mask, overlay, stats = build_sway_mask(args.island, scale=args.scale)
    mask.save(out_path, format='WEBP', lossless=True, method=6)
    stats['out'] = str(out_path.relative_to(ROOT))
    stats['bytes'] = out_path.stat().st_size

    if args.overlay:
        ov_path = Path(args.overlay)
        ov_path.parent.mkdir(parents=True, exist_ok=True)
        overlay.save(ov_path)
        stats['overlay'] = str(ov_path)

    print(json.dumps(stats, indent=2))
    if stats['max_path_val'] != 0 or stats['max_plot_val'] != 0:
        sys.exit(f'ERROR: non-zero mask on path ({stats["max_path_val"]}) or plot ({stats["max_plot_val"]})')


if __name__ == '__main__':
    main()
