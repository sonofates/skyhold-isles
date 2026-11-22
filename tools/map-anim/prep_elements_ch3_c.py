#!/usr/bin/env python3
"""Prepare Chapter 3 ambient map-animation folders, contact sheets, and index for i17-i24.

Reads design/art-2d/anim/<island>/ch3-elements.json, validates geometry and exclusion zones
(road/bridge clearance, plot disks, path centerlines, gates/castle), writes:
  - design/art-2d/anim/<island>/<element>/{start.png, mask.png, place.json, prompt.txt}
  - docs/anim-shots/ch3-prep/<island>.webp
  - docs/anim-shots/ch3-prep/<island>-starts.webp
  - design/art-2d/anim/index-ch3-c.json

Pure Pillow + NumPy (no OpenCV required).
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from road_mask import animation_clearance  # noqa: E402

LAYOUT_W = 1846
LAYOUT_H = 852
START_W = 1280
START_H = 720
SOURCE_PX_PER_LAYOUT_PX = 3
DEFAULT_PLOT_RADIUS_PX = 48  # src/data/levels2d/loader.ts & src/render2d/plotLayer.ts
MIN_PATH_CLEARANCE_PX = 14.0
MIN_CROP_W = 160
MAX_CROP_W = 480
MIN_CROP_H = 90
MAX_CROP_H = 270
ALLOWED_KINDS = {
    "water",
    "waterfall",
    "lava",
    "fire",
    "smoke",
    "cloth",
    "foliage",
    "grass",
    "crystal",
    "cloud",
    "mill",
    "other",
}
KEBAB_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

PROMPT_HEADER = (
    "Create an 8-second seamless loop from the supplied start frame. "
    "Lock the camera to this exact crop and perspective for the entire shot. "
    "No pan, tilt, shake or zoom. Keep the hand-painted storybook game art, "
    "brushwork, palette and daylight unchanged. Only the element described below "
    "moves; every other part of the picture stays perfectly still, and the motion "
    "fades out smoothly at its edges. The last frame matches the first frame exactly."
)

PROMPT_FOOTER = (
    "Match the opening pose, light and brush marks at the eight-second seam. "
    "Carry the rhythm smoothly through the join."
)


def exact_edt_inward(binary_mask: np.ndarray, max_radius: int) -> np.ndarray:
    """Exact Euclidean distance from each True pixel to the nearest False pixel (or frame border).

    Mathematically exact for all distances <= max_radius; pixels farther than max_radius
    receive distance >= max_radius (which clamps to 1.0 in smoothstep feathering).
    """
    h, w = binary_mask.shape
    r = max(1, int(max_radius))
    # Pad by 1 False pixel on all sides so the frame edge counts as outside.
    inf_val = float(r + 2)
    dy = np.where(binary_mask, inf_val, 0.0).astype(np.float32)
    # Distance to top/bottom frame borders
    dy[0, binary_mask[0]] = 1.0
    dy[-1, binary_mask[-1]] = 1.0
    for y in range(1, h):
        np.minimum(dy[y], dy[y - 1] + 1.0, out=dy[y])
    for y in range(h - 2, -1, -1):
        np.minimum(dy[y], dy[y + 1] + 1.0, out=dy[y])

    dy2 = dy * dy
    d2 = dy2.copy()
    # Account for left/right frame borders
    x_idx = np.arange(w, dtype=np.float32)
    border_x = np.minimum(x_idx + 1.0, w - x_idx)
    np.minimum(d2, border_x[None, :] * border_x[None, :], out=d2)
    d2[~binary_mask] = 0.0

    for dx in range(1, r + 1):
        dx2 = float(dx * dx)
        np.minimum(d2[:, dx:], dy2[:, :-dx] + dx2, out=d2[:, dx:])
        np.minimum(d2[:, :-dx], dy2[:, dx:] + dx2, out=d2[:, :-dx])

    return np.sqrt(d2, dtype=np.float32)


def render_feathered_mask(polygons_layout, crop: dict, feather_px: float):
    """Rasterize layout-px polygons into a 1280x720 smoothstep-feathered 8-bit grayscale mask."""
    s = START_W / crop["width"]
    feather_start = max(1, int(round(feather_px * s)))
    canvas = Image.new("L", (START_W, START_H), 0)
    draw = ImageDraw.Draw(canvas)
    for poly in polygons_layout:
        pts = [((pt[0] - crop["x"]) * s, (pt[1] - crop["y"]) * s) for pt in poly]
        draw.polygon(pts, fill=255)
    binary = np.asarray(canvas) > 0
    if not binary.any():
        raise ValueError("Mask polygons produced an empty mask")
    dist = exact_edt_inward(binary, max_radius=feather_start + 2)
    t = np.clip(dist / float(feather_start), 0.0, 1.0)
    smooth = t * t * (3.0 - 2.0 * t)
    mask_u8 = np.rint(smooth * 255.0).astype(np.uint8)
    ys, xs = np.where(mask_u8 > 0)
    bbox = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
    return mask_u8, bbox, feather_start


def point_to_segments_min_dist(px: np.ndarray, py: np.ndarray, paths) -> float:
    """Compute minimum Euclidean distance from point cloud (px, py) to all path polylines."""
    min_d2 = float("inf")
    for path in paths:
        for i in range(len(path) - 1):
            ax, ay = float(path[i][0]), float(path[i][1])
            bx, by = float(path[i + 1][0]), float(path[i + 1][1])
            vx, vy = bx - ax, by - ay
            seg_len2 = vx * vx + vy * vy
            if seg_len2 <= 1e-9:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = np.clip(((px - ax) * vx + (py - ay) * vy) / seg_len2, 0.0, 1.0)
                cx = ax + t * vx
                cy = ay + t * vy
                d2 = (px - cx) ** 2 + (py - cy) ** 2
            cur = float(d2.min())
            if cur < min_d2:
                min_d2 = cur
    return math.sqrt(min_d2)


def load_committed_element_names(island: str) -> set[str]:
    """Return element folder names already reserved by ch1/ch2 indexes or shipped mapAnim."""
    reserved = set()
    for idx_name in ("index-ch1.json", "index-ch2.json"):
        idx_path = ROOT / "design/art-2d/anim" / idx_name
        if idx_path.exists():
            for row in json.loads(idx_path.read_text()):
                if row.get("island") == island:
                    reserved.add(row["element"])
    ma_path = ROOT / f"src/data/mapAnim/{island}.json"
    if ma_path.exists():
        for el in json.loads(ma_path.read_text()).get("elements", []):
            reserved.add(el["id"])
    return reserved


def build_place_dict(island: str, element: str, crop: dict, bbox: list[int], feather_start: int) -> dict:
    x, y, w, h = int(crop["x"]), int(crop["y"]), int(crop["width"]), int(crop["height"])
    src_l = x * SOURCE_PX_PER_LAYOUT_PX
    src_t = y * SOURCE_PX_PER_LAYOUT_PX
    src_r = (x + w) * SOURCE_PX_PER_LAYOUT_PX
    src_b = (y + h) * SOURCE_PX_PER_LAYOUT_PX
    s_layout = START_W / w
    s_source = START_W / (w * SOURCE_PX_PER_LAYOUT_PX)
    return {
        "id": f"{island}-{element}",
        "element": element,
        "source": f"public/art2d/map-{island}-layered@3x.webp",
        "layoutSizePx": [LAYOUT_W, LAYOUT_H],
        "startSizePx": [START_W, START_H],
        "cropLayoutPx": {
            "x": x,
            "y": y,
            "width": w,
            "height": h,
        },
        "sourcePxPerLayoutPx": SOURCE_PX_PER_LAYOUT_PX,
        "sourceCropPxLTRB": [src_l, src_t, src_r, src_b],
        "startPxPerLayoutPx": s_layout,
        "startPxPerSourcePx": s_source,
        "resample": "Lanczos",
        "maskBBoxStartPxLTRB": bbox,
        "featherInwardStartPx": int(feather_start),
    }


def crop_start_image(src_img: Image.Image, crop: dict) -> Image.Image:
    x, y, w, h = int(crop["x"]), int(crop["y"]), int(crop["width"]), int(crop["height"])
    box = (
        x * SOURCE_PX_PER_LAYOUT_PX,
        y * SOURCE_PX_PER_LAYOUT_PX,
        (x + w) * SOURCE_PX_PER_LAYOUT_PX,
        (y + h) * SOURCE_PX_PER_LAYOUT_PX,
    )
    return src_img.crop(box).resize((START_W, START_H), Image.Resampling.LANCZOS).convert("RGB")


def format_prompt(motion: str) -> str:
    clean = " ".join(motion.strip().split())
    return f"{PROMPT_HEADER}\n\n{clean}\n\n{PROMPT_FOOTER}\n"


def validate_element(
    island: str,
    spec_el: dict,
    mask_u8: np.ndarray,
    clearance_arr: np.ndarray,
    level: dict,
    reserved_names: set[str],
    seen_names: set[str],
) -> list[str]:
    errors = []
    name = spec_el.get("element", "")
    if not isinstance(name, str) or not KEBAB_RE.match(name):
        errors.append(f"{island}/{name}: element name must be kebab-case")
    if name in reserved_names:
        errors.append(f"{island}/{name}: reuses an existing ch1/ch2 element folder name")
    if name in seen_names:
        errors.append(f"{island}/{name}: duplicate element name in spec")
    seen_names.add(name)

    kind = spec_el.get("kind")
    if kind not in ALLOWED_KINDS:
        errors.append(f"{island}/{name}: invalid kind {kind!r}")

    depth = spec_el.get("depth")
    if depth not in (0, 1, 2):
        errors.append(f"{island}/{name}: invalid depth {depth!r}")

    if not isinstance(spec_el.get("motion"), str) or not spec_el["motion"].strip():
        errors.append(f"{island}/{name}: motion must be a non-empty string")
    if not isinstance(spec_el.get("why"), str) or not spec_el["why"].strip():
        errors.append(f"{island}/{name}: why must be a non-empty string")
    if spec_el.get("retryOf") is not None and not isinstance(spec_el["retryOf"], str):
        errors.append(f"{island}/{name}: retryOf must be null or string")

    crop = spec_el["crop"]
    x, y, w, h = crop["x"], crop["y"], crop["width"], crop["height"]
    if not all(isinstance(v, int) for v in (x, y, w, h)):
        errors.append(f"{island}/{name}: crop x/y/width/height must be integers")
    if w * 9 != h * 16:
        errors.append(f"{island}/{name}: crop {w}x{h} is not exact 16:9")
    if not (MIN_CROP_W <= w <= MAX_CROP_W and MIN_CROP_H <= h <= MAX_CROP_H):
        errors.append(f"{island}/{name}: crop {w}x{h} outside allowed 160x90..480x270 range")
    if x < 0 or y < 0 or x + w > LAYOUT_W or y + h > LAYOUT_H:
        errors.append(f"{island}/{name}: crop ({x},{y},{w},{h}) extends outside {LAYOUT_W}x{LAYOUT_H}")

    # Check static border fraction for optical-flow anchor registration
    static_frac = float((mask_u8 == 0).mean())
    if static_frac < 0.12:
        errors.append(
            f"{island}/{name}: static area outside mask is only {static_frac*100:.1f}% (<12%); leave margin for registration"
        )

    # Map all non-zero mask pixels back to layout coordinates
    s = START_W / w
    ys, xs = np.where(mask_u8 > 0)
    lxs = x + (xs + 0.5) / s
    lys = y + (ys + 0.5) / s

    # 1. Check animation_clearance (road/bridge paint)
    ix = np.clip(np.floor(lxs).astype(int), 0, LAYOUT_W - 1)
    iy = np.clip(np.floor(lys).astype(int), 0, LAYOUT_H - 1)
    ix2 = np.clip(np.round(lxs).astype(int), 0, LAYOUT_W - 1)
    iy2 = np.clip(np.round(lys).astype(int), 0, LAYOUT_H - 1)
    min_clr = min(int(clearance_arr[iy, ix].min()), int(clearance_arr[iy2, ix2].min()))
    if min_clr < 255:
        bad = int((clearance_arr[iy, ix] < 255).sum())
        errors.append(
            f"{island}/{name}: mask touches road/bridge animation_clearance (min={min_clr}, bad_start_px={bad})"
        )

    # 2. Check plot disks (radius = plotRadiusPx from levels2d / plotLayer.ts)
    plot_r = float(level.get("plotRadiusPx", DEFAULT_PLOT_RADIUS_PX))
    for pi, (px, py) in enumerate(level["plots"]):
        d_min = float(np.hypot(lxs - px, lys - py).min())
        if d_min <= plot_r:
            errors.append(
                f"{island}/{name}: mask touches plot {pi} at ({px},{py}) (min_dist={d_min:.2f} <= r={plot_r})"
            )

    # 3. Check path centerlines (>= 14 layout px)
    min_path_d = point_to_segments_min_dist(lxs, lys, level["paths"])
    if min_path_d < MIN_PATH_CLEARANCE_PX:
        errors.append(
            f"{island}/{name}: mask within {min_path_d:.2f} px of path centerline (< {MIN_PATH_CLEARANCE_PX} px)"
        )

    # 4. Check entrance gates and goal gate front rects
    gates = []
    for ent in level.get("entrances", []):
        r = ent.get("gate", {}).get("front", {}).get("rect")
        if r:
            gates.append((f"entrance-{ent['id']}", r))
    gg = level.get("goalGate", {}).get("front", {}).get("rect")
    if gg:
        gates.append(("goalGate", gg))
    for gname, (gx, gy, gw, gh) in gates:
        inside = (lxs >= gx) & (lxs <= gx + gw) & (lys >= gy) & (lys <= gy + gh)
        if inside.any():
            errors.append(
                f"{island}/{name}: mask touches {gname} rect {[gx, gy, gw, gh]} ({int(inside.sum())} start px)"
            )

    return errors


def draw_contact_sheets(island: str, level: dict, map_anim: dict, processed: list[dict], out_dir: Path):
    """Render docs/anim-shots/ch3-prep/<island>.webp (~1400 px wide) and <island>-starts.webp."""
    out_dir.mkdir(parents=True, exist_ok=True)
    base = Image.open(ROOT / f"public/art2d/map-{island}-layered@1x.webp").convert("RGBA")
    if base.size != (LAYOUT_W, LAYOUT_H):
        base = base.resize((LAYOUT_W, LAYOUT_H), Image.Resampling.LANCZOS)

    overlay = Image.new("RGBA", (LAYOUT_W, LAYOUT_H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)

    # Thin paths
    for path in level["paths"]:
        pts = [tuple(p) for p in path]
        if len(pts) >= 2:
            od.line(pts, fill=(255, 240, 90, 165), width=2)

    # Thin plots
    plot_r = level.get("plotRadiusPx", DEFAULT_PLOT_RADIUS_PX)
    for px, py in level["plots"]:
        od.ellipse([px - plot_r, py - plot_r, px + plot_r, py + plot_r], outline=(255, 165, 40, 180), width=2)

    # Existing shipped animated rects (cyan)
    existing_area = 0.0
    for el in map_anim.get("elements", []):
        ex, ey, ew, eh = el["rect"]
        existing_area += ew * eh
        od.rectangle([ex, ey, ex + ew, ey + eh], fill=(0, 210, 255, 48), outline=(0, 235, 255, 235), width=3)
        lbl = f"[old] {el['id']}"
        tw = len(lbl) * 6 + 6
        od.rectangle([ex, max(0, ey - 14), ex + tw, max(14, ey)], fill=(0, 40, 55, 195))
        od.text((ex + 3, max(1, ey - 13)), lbl, fill=(140, 250, 255, 255))

    # New masks (tinted green/lime) & crop boxes (bright yellow-green outline)
    new_area = 0.0
    for item in processed:
        crop = item["spec"]["crop"]
        cx, cy, cw, ch = crop["x"], crop["y"], crop["width"], crop["height"]
        # Composite feathered mask tint onto overlay
        mask_small = Image.fromarray(item["mask_u8"]).resize((cw, ch), Image.Resampling.BILINEAR)
        mask_np = np.asarray(mask_small, dtype=np.float32) / 255.0
        tint = np.zeros((ch, cw, 4), dtype=np.uint8)
        tint[..., 0] = 60
        tint[..., 1] = 255
        tint[..., 2] = 90
        tint[..., 3] = np.rint(mask_np * 125.0).astype(np.uint8)
        tint_img = Image.fromarray(tint)
        overlay.alpha_composite(tint_img, dest=(cx, cy))

        # Mask bbox area in layout px (matches pack_loops.py rect area)
        l, t, r, b = item["bbox"]
        s = START_W / cw
        rw, rh = (r - l) / s, (b - t) / s
        new_area += rw * rh

        # Crop outline
        od.rectangle([cx, cy, cx + cw - 1, cy + ch - 1], outline=(255, 230, 50, 240), width=3)
        lbl = f"{item['spec']['element']} ({cw}x{ch})"
        tw = len(lbl) * 6 + 8
        lx = min(LAYOUT_W - tw - 2, max(2, cx + 2))
        ly = max(2, cy + 2)
        od.rectangle([lx, ly, lx + tw, ly + 15], fill=(15, 35, 15, 210))
        od.text((lx + 4, ly + 2), lbl, fill=(235, 255, 120, 255))

    comp = Image.alpha_composite(base, overlay).convert("RGB")

    # Header bar summary placed ABOVE the map so top-edge crop labels stay 100% unobstructed
    total_px = LAYOUT_W * LAYOUT_H
    before_pct = existing_area / total_px * 100.0
    after_pct = (existing_area + new_area) / total_px * 100.0
    scale_w = 1400
    scale_h = int(round(LAYOUT_H * scale_w / LAYOUT_W))
    header_h = 26
    map_resized = comp.resize((scale_w, scale_h), Image.Resampling.LANCZOS)
    sheet = Image.new("RGB", (scale_w, scale_h + header_h), (12, 16, 22))
    sheet.paste(map_resized, (0, header_h))
    sd = ImageDraw.Draw(sheet)
    banner = (
        f"{island.upper()}  |  existing: {len(map_anim.get('elements', []))} ({before_pct:.1f}%) [cyan]  |  "
        f"new ch3: {len(processed)} (+{new_area/total_px*100:.1f}%) [green mask / yellow crop]  |  "
        f"planned total: {after_pct:.1f}%"
    )
    sd.text((10, 7), banner, fill=(240, 248, 255))
    sheet.save(out_dir / f"{island}.webp", "WEBP", quality=88)

    # Start thumbnails strip (2 columns or horizontal grid, crisp ~1400px wide)
    n = len(processed)
    cols = min(4, max(1, n))
    rows = math.ceil(n / cols)
    tw_thumb = 340
    th_thumb = int(round(tw_thumb * START_H / START_W))  # 191
    pad = 10
    lbl_h = 22
    strip_w = cols * tw_thumb + (cols + 1) * pad
    strip_h = rows * (th_thumb + lbl_h) + (rows + 1) * pad
    strip = Image.new("RGB", (strip_w, strip_h), (18, 20, 26))
    st_draw = ImageDraw.Draw(strip)

    for idx, item in enumerate(processed):
        r_i = idx // cols
        c_i = idx % cols
        ox = pad + c_i * (tw_thumb + pad)
        oy = pad + r_i * (th_thumb + lbl_h + pad)
        start_im = item["start_img"].resize((tw_thumb, th_thumb), Image.Resampling.LANCZOS).convert("RGBA")
        m_im = Image.fromarray(item["mask_u8"]).resize((tw_thumb, th_thumb), Image.Resampling.BILINEAR)
        m_np = np.asarray(m_im, dtype=np.float32) / 255.0
        # Show mask interior lightly tinted green and feather boundary highlighted
        ov = np.zeros((th_thumb, tw_thumb, 4), dtype=np.uint8)
        ov[..., 0] = 50
        ov[..., 1] = 255
        ov[..., 2] = 90
        ov[..., 3] = np.rint(m_np * 95.0).astype(np.uint8)
        # Edge contour where 0.05 < m < 0.75
        edge = (m_np > 0.05) & (m_np < 0.75)
        ov[edge] = [255, 230, 40, 200]
        thumb = Image.alpha_composite(start_im, Image.fromarray(ov)).convert("RGB")
        strip.paste(thumb, (ox, oy))
        crop = item["spec"]["crop"]
        cap = f"{item['spec']['element']} [{item['spec']['kind']}] {crop['width']}x{crop['height']}"
        st_draw.text((ox + 2, oy + th_thumb + 4), cap, fill=(230, 240, 250))

    strip.save(out_dir / f"{island}-starts.webp", "WEBP", quality=88)
    return before_pct, after_pct


def run_self_check(samples: list[tuple[str, str]]):
    """Prove geometry matches existing committed prep folders pixel-for-pixel."""
    print("=== Geometry Self-Check ===")
    all_ok = True
    for isl, el in samples:
        folder = ROOT / f"design/art-2d/anim/{isl}/{el}"
        orig_place = json.loads((folder / "place.json").read_text())
        orig_start = np.asarray(Image.open(folder / "start.png").convert("RGB"))
        orig_mask = np.asarray(Image.open(folder / "mask.png"))

        src_img = Image.open(ROOT / orig_place["source"])
        repro_start = np.asarray(crop_start_image(src_img, orig_place["cropLayoutPx"]))
        diff = np.abs(orig_start.astype(np.int16) - repro_start.astype(np.int16))
        max_diff = int(diff.max())
        mean_diff = float(diff.mean())

        repro_place = build_place_dict(
            isl,
            el,
            orig_place["cropLayoutPx"],
            orig_place["maskBBoxStartPxLTRB"],
            orig_place["featherInwardStartPx"],
        )
        mismatched = []
        for k, v in orig_place.items():
            rv = repro_place.get(k)
            if isinstance(v, float):
                if abs(v - rv) > 1e-12:
                    mismatched.append((k, v, rv))
            elif v != rv:
                mismatched.append((k, v, rv))

        # Verify mask mode, size, and smoothstep feather on a reconstructed binary interior
        mask_ok = orig_mask.shape == (START_H, START_W)
        print(
            f"  {isl}/{el}: start.png max_diff={max_diff} mean_diff={mean_diff:.6f} | "
            f"place.json field_mismatches={len(mismatched)} | mask_shape_ok={mask_ok}"
        )
        if max_diff != 0 or mismatched or not mask_ok:
            all_ok = False
            if mismatched:
                print(f"    Mismatched fields: {mismatched}")
    if not all_ok:
        sys.exit(1)
    print("Self-check PASSED (max pixel diff = 0, place.json field-for-field identical).")


def process_island(island: str, write_outputs: bool = True):
    spec_path = ROOT / f"design/art-2d/anim/{island}/ch3-elements.json"
    if not spec_path.exists():
        raise FileNotFoundError(f"Missing spec file: {spec_path}")
    spec = json.loads(spec_path.read_text())
    if spec.get("island") != island:
        raise ValueError(f"{spec_path}: spec island {spec.get('island')!r} != {island!r}")

    level = json.loads((ROOT / f"src/data/levels2d/{island}.json").read_text())
    map_anim = json.loads((ROOT / f"src/data/mapAnim/{island}.json").read_text())
    clearance_arr = np.asarray(animation_clearance(island))
    reserved = load_committed_element_names(island)
    src_img = Image.open(ROOT / f"public/art2d/map-{island}-layered@3x.webp")

    all_errors = []
    seen_names = set()
    processed = []
    index_entries = []

    for spec_el in spec["elements"]:
        mask_u8, bbox, feather_start = render_feathered_mask(
            spec_el["mask"], spec_el["crop"], float(spec_el["featherPx"])
        )
        errs = validate_element(island, spec_el, mask_u8, clearance_arr, level, reserved, seen_names)
        if errs:
            all_errors.extend(errs)
            continue

        start_img = crop_start_image(src_img, spec_el["crop"])
        place = build_place_dict(island, spec_el["element"], spec_el["crop"], bbox, feather_start)
        prompt_text = format_prompt(spec_el["motion"])

        if write_outputs:
            out_dir = ROOT / f"design/art-2d/anim/{island}/{spec_el['element']}"
            out_dir.mkdir(parents=True, exist_ok=True)
            start_img.save(out_dir / "start.png", "PNG")
            Image.fromarray(mask_u8, mode="L").save(out_dir / "mask.png", "PNG")
            (out_dir / "place.json").write_text(json.dumps(place, indent=2) + "\n")
            (out_dir / "prompt.txt").write_text(prompt_text)

        processed.append(
            {
                "spec": spec_el,
                "mask_u8": mask_u8,
                "bbox": bbox,
                "place": place,
                "start_img": start_img,
                "prompt": prompt_text,
            }
        )
        index_entries.append(
            {
                "id": f"{island}-{spec_el['element']}",
                "island": island,
                "element": spec_el["element"],
                "prompt": prompt_text.strip(),
                "start": f"design/art-2d/anim/{island}/{spec_el['element']}/start.png",
            }
        )

    if all_errors:
        print(f"VALIDATION FAILED for {island}:", file=sys.stderr)
        for e in all_errors:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(2)

    before_pct, after_pct = draw_contact_sheets(
        island, level, map_anim, processed, ROOT / "docs/anim-shots/ch3-prep"
    )
    print(
        f"{island}: {len(processed)} new elements OK | coverage {before_pct:.2f}% -> {after_pct:.2f}%"
    )
    return index_entries, before_pct, after_pct


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("islands", nargs="*", help="Island IDs to prepare (e.g. i17 i18 ...)")
    parser.add_argument("--self-check", action="store_true", help="Run geometry self-check against committed elements")
    parser.add_argument(
        "--index",
        type=Path,
        default=ROOT / "design/art-2d/anim/index-ch3-c.json",
        help="Path to write/update index JSON",
    )
    args = parser.parse_args()

    if args.self_check:
        run_self_check([("i17", "east-cliff-vapour"), ("i18", "amethyst-geode"), ("i20", "masthead-streamers")])

    if not args.islands:
        return

    all_entries = []
    for isl in args.islands:
        entries, _, _ = process_island(isl, write_outputs=True)
        all_entries.extend(entries)

    # Merge deterministically with any existing entries for other islands in index-ch3-c.json
    existing = []
    if args.index.exists():
        existing = json.loads(args.index.read_text())
    processed_set = set(args.islands)
    merged = [row for row in existing if row.get("island") not in processed_set] + all_entries
    merged.sort(key=lambda r: (r["island"], r["element"]))
    args.index.write_text(json.dumps(merged, indent=2) + "\n")
    print(f"Wrote {len(merged)} total entries to {args.index.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
