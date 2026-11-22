"""Prepare Ch3-A animated map elements from per-island ch3-elements.json specs.

Pure Pillow + NumPy (no cv2/scipy/shapely). Validates all keep-out constraints
(animation_clearance, plot disks, path centerlines >= 14 layout px, castle/caves/gates),
emits prep folders matching the existing Ch1/Ch2 format field-for-field, builds
contact sheets + start strips, and updates design/art-2d/anim/index-ch3-a.json.

Usage:
  python3 tools/map-anim/prep_elements_ch3_a.py --self-check l1c/orchard-crown
  python3 tools/map-anim/prep_elements_ch3_a.py l1c i01 i02 i03 i04 i05 i06 i07 i08
"""

import argparse
import json
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/map-anim"))
sys.path.insert(0, str(ROOT / "tools/map-compose"))

from road_mask import animation_clearance
from ground import catmull

START_W, START_H = 1280, 720
LAYOUT_W, LAYOUT_H = 1846, 852
SOURCE_SCALE = 3
DEFAULT_PLOT_RADIUS_PX = 48
PATH_MIN_DIST_PX = 14.0
GATE_POINT_CLEAR_PX = 24.0
MIN_STATIC_RATIO = 0.15

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

PROMPT_HEADER = (
    "Create an 8-second seamless loop from the supplied start frame. Lock the camera to this "
    "exact crop and perspective for the entire shot. No pan, tilt, shake or zoom. Keep the "
    "hand-painted storybook game art, brushwork, palette and daylight unchanged. Only the "
    "element described below moves; every other part of the picture stays perfectly still, "
    "and the motion fades out smoothly at its edges. The last frame matches the first frame "
    "exactly."
)

PROMPT_FOOTER = (
    "Match the opening pose, light and brush marks at the eight-second seam. "
    "Carry the rhythm smoothly through the join."
)

KEBAB_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def euclidean_distance_to_zero_bounded(binary_inside: np.ndarray, max_radius: int) -> np.ndarray:
    """Exact 2D Euclidean distance from each True pixel to the nearest False pixel, capped at max_radius.

    Separable vectorized NumPy implementation: exact for all distances <= max_radius,
    and runs ~100x faster than a pure-Python 1D envelope loop.
    """
    h, w = binary_inside.shape
    r = max(1, int(max_radius))
    inf_sq = float((r + 2) * (r + 2) * 2)
    f = np.where(binary_inside, inf_sq, 0.0).astype(np.float32)
    if not np.any(binary_inside):
        return np.zeros((h, w), dtype=np.float32)

    # 1D squared distance along X (bounded by r)
    # Pad with 0 outside image? Only interior pixels have False neighbors inside crop; pad with inf_sq.
    pad_x = np.pad(f, ((0, 0), (r, r)), mode="constant", constant_values=inf_sq)
    d1 = f.copy()
    for dx in range(1, r + 1):
        d2 = float(dx * dx)
        np.minimum(d1, pad_x[:, r - dx : r - dx + w] + d2, out=d1)
        np.minimum(d1, pad_x[:, r + dx : r + dx + w] + d2, out=d1)

    # 1D squared distance along Y (bounded by r)
    pad_y = np.pad(d1, ((r, r), (0, 0)), mode="constant", constant_values=inf_sq)
    d2_out = d1.copy()
    for dy in range(1, r + 1):
        d2 = float(dy * dy)
        np.minimum(d2_out, pad_y[r - dy : r - dy + h, :] + d2, out=d2_out)
        np.minimum(d2_out, pad_y[r + dy : r + dy + h, :] + d2, out=d2_out)

    return np.sqrt(np.minimum(d2_out, float(r * r)))


def rasterize_mask_start(polygons_layout, crop, feather_layout_px):
    """Rasterize layout-px polygons into 1280x720 8-bit grayscale smoothstep-feathered mask."""
    cx, cy, cw, ch = crop["x"], crop["y"], crop["width"], crop["height"]
    sx = START_W / cw
    sy = START_H / ch
    assert abs(sx - sy) < 1e-9, f"Non-16:9 crop scale: {sx} vs {sy}"
    feather_start_px = max(1, int(round(feather_layout_px * sx)))

    img = Image.new("L", (START_W, START_H), 0)
    draw = ImageDraw.Draw(img)
    for poly in polygons_layout:
        pts = [((x - cx) * sx, (y - cy) * sy) for x, y in poly]
        draw.polygon(pts, fill=255)
    inside = np.asarray(img) > 0
    dist = euclidean_distance_to_zero_bounded(inside, feather_start_px)
    t = np.clip(dist / float(feather_start_px), 0.0, 1.0)
    smooth = 3.0 * t * t - 2.0 * t * t * t
    mask_arr = np.rint(255.0 * smooth).astype(np.uint8)
    mask_arr[~inside] = 0
    return Image.fromarray(mask_arr, mode="L"), feather_start_px


def rasterize_mask_layout(polygons_layout, size=(LAYOUT_W, LAYOUT_H)):
    """Rasterize layout-px polygons directly into layout-space boolean array."""
    img = Image.new("L", size, 0)
    draw = ImageDraw.Draw(img)
    for poly in polygons_layout:
        pts = [(float(x), float(y)) for x, y in poly]
        draw.polygon(pts, fill=255)
    return np.asarray(img) > 0


def point_to_segments_min_dist(xs: np.ndarray, ys: np.ndarray, segments) -> float:
    """Minimum Euclidean distance from a set of (xs, ys) points to a list of segments (ax, ay, bx, by)."""
    best = float("inf")
    for ax, ay, bx, by in segments:
        dx = bx - ax
        dy = by - ay
        l2 = dx * dx + dy * dy
        if l2 <= 1e-12:
            d2 = (xs - ax) ** 2 + (ys - ay) ** 2
        else:
            t = np.clip(((xs - ax) * dx + (ys - ay) * dy) / l2, 0.0, 1.0)
            px = ax + t * dx
            py = ay + t * dy
            d2 = (xs - px) ** 2 + (ys - py) ** 2
        m = float(np.sqrt(d2.min()))
        if m < best:
            best = m
    return best


def get_preexisting_elements(island: str) -> set[str]:
    """Return element folder names that already exist on base branch art-2d."""
    names = set()
    # 1. From git ls-tree art-2d
    try:
        res = subprocess.run(
            ["git", "ls-tree", "--name-only", "art-2d", f"design/art-2d/anim/{island}/"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                p = Path(line.strip())
                if p.name and not p.name.endswith(".json"):
                    names.add(p.name)
    except Exception:
        pass
    # 2. Also include anything in src/data/mapAnim/<island>.json
    ma_path = ROOT / f"src/data/mapAnim/{island}.json"
    if ma_path.exists():
        ma = json.loads(ma_path.read_text())
        for e in ma.get("elements", []):
            names.add(e["id"])
    return names


def build_keepout_data(island: str):
    """Load clearance image, level layout, plot disks, path segments, and gate rects."""
    lv = json.loads((ROOT / f"src/data/levels2d/{island}.json").read_text())
    clr = np.asarray(animation_clearance(island))
    plot_r = float(lv.get("plotRadiusPx", DEFAULT_PLOT_RADIUS_PX))
    plots = [(float(p[0]), float(p[1])) for p in lv["plots"]]

    # Collect path segments from both raw polyline and Catmull-Rom spline
    segments = []
    for raw_path in lv["paths"]:
        pts = [(float(p[0]), float(p[1])) for p in raw_path]
        for seq in (pts, catmull(pts)):
            for i in range(1, len(seq)):
                segments.append((seq[i - 1][0], seq[i - 1][1], seq[i][0], seq[i][1]))

    # Collect gate rectangles and entrance/goal centers
    gate_rects = []
    gate_pts = []
    for ent in lv.get("entrances", []):
        gate_pts.append((f"entrance-{ent['id']}", float(ent["x"]), float(ent["y"])))
        g = ent.get("gate", {})
        if isinstance(g, dict) and "front" in g and "rect" in g["front"]:
            rx, ry, rw, rh = g["front"]["rect"]
            gate_rects.append((f"entrance-{ent['id']}-gate", rx, ry, rx + rw, ry + rh))
    gx, gy = lv["goal"]
    gate_pts.append(("goal", float(gx), float(gy)))
    gg = lv.get("goalGate", {})
    if isinstance(gg, dict) and "front" in gg and "rect" in gg["front"]:
        rx, ry, rw, rh = gg["front"]["rect"]
        gate_rects.append(("goal-gate", rx, ry, rx + rw, ry + rh))

    return lv, clr, plot_r, plots, segments, gate_rects, gate_pts


def validate_element(island: str, el: dict, preexisting: set[str], seen: set[str], keepout) -> list[str]:
    """Return list of error strings (empty if valid)."""
    errors = []
    lv, clr, plot_r, plots, segments, gate_rects, gate_pts = keepout
    name = el.get("element", "")
    if not isinstance(name, str) or not KEBAB_RE.match(name):
        errors.append(f"{island}/{name}: element name must be kebab-case")
    if name in preexisting:
        errors.append(f"{island}/{name}: reuses an existing pre-ch3 folder/element name")
    if name in seen:
        errors.append(f"{island}/{name}: duplicate element name on island")
    seen.add(name)

    kind = el.get("kind")
    if kind not in ALLOWED_KINDS:
        errors.append(f"{island}/{name}: invalid kind {kind!r}")

    depth = el.get("depth")
    if depth not in (0, 1, 2):
        errors.append(f"{island}/{name}: invalid depth {depth!r}")

    crop = el.get("crop", {})
    for k in ("x", "y", "width", "height"):
        if k not in crop or not isinstance(crop[k], int):
            errors.append(f"{island}/{name}: crop.{k} must be int")
    if errors:
        return errors

    cx, cy, cw, ch = crop["x"], crop["y"], crop["width"], crop["height"]
    if cw * 9 != ch * 16:
        errors.append(f"{island}/{name}: crop {cw}x{ch} is not exact 16:9")
    if not (160 <= cw <= 480 and 90 <= ch <= 270):
        errors.append(f"{island}/{name}: crop {cw}x{ch} outside [160x90, 480x270]")
    if cx < 0 or cy < 0 or cx + cw > LAYOUT_W or cy + ch > LAYOUT_H:
        errors.append(f"{island}/{name}: crop ({cx},{cy},{cw},{ch}) outside {LAYOUT_W}x{LAYOUT_H}")

    feather_px = el.get("featherPx")
    if not isinstance(feather_px, (int, float)) or feather_px <= 0:
        errors.append(f"{island}/{name}: featherPx must be positive number")

    polys = el.get("mask")
    if not isinstance(polys, list) or len(polys) == 0:
        errors.append(f"{island}/{name}: mask must be non-empty list of polygons")
        return errors

    for pi, poly in enumerate(polys):
        if not isinstance(poly, list) or len(poly) < 3:
            errors.append(f"{island}/{name}: mask[{pi}] needs >= 3 points")
            continue
        for x, y in poly:
            if x < cx or x > cx + cw or y < cy or y > cy + ch:
                errors.append(f"{island}/{name}: mask[{pi}] vertex ({x},{y}) outside crop")

    if not isinstance(el.get("motion"), str) or not el["motion"].strip():
        errors.append(f"{island}/{name}: motion paragraph required")
    if not isinstance(el.get("why"), str) or not el["why"].strip():
        errors.append(f"{island}/{name}: why string required")
    if "retryOf" not in el:
        errors.append(f"{island}/{name}: retryOf field required (null or string)")

    if errors:
        return errors

    # Rasterize in start space AND project every non-zero pixel to layout space for strict checks
    mask_img, _ = rasterize_mask_start(polys, crop, feather_px)
    mask_arr = np.asarray(mask_img)
    nz_sy, nz_sx = np.nonzero(mask_arr)
    if len(nz_sx) == 0:
        errors.append(f"{island}/{name}: rasterized mask is empty")
        return errors

    static_ratio = 1.0 - (len(nz_sx) / float(START_W * START_H))
    if static_ratio < MIN_STATIC_RATIO:
        errors.append(
            f"{island}/{name}: only {static_ratio*100:.1f}% static margin outside mask (need >= {MIN_STATIC_RATIO*100:.0f}% for registration)"
        )

    # Map start pixels to layout coordinates (pixel centers)
    scale = START_W / float(cw)
    lx = cx + (nz_sx + 0.5) / scale
    ly = cy + (nz_sy + 0.5) / scale

    # Also include layout-space rasterized pixels to be doubly sure
    lay_mask = rasterize_mask_layout(polys)
    lay_y, lay_x = np.nonzero(lay_mask)
    all_x = np.concatenate([lx, lay_x.astype(np.float64)])
    all_y = np.concatenate([ly, lay_y.astype(np.float64)])

    # 1. animation_clearance check (must be strictly 255 — zero overlap with road/bridge paint + feather)
    ix = np.clip(np.floor(all_x).astype(np.int32), 0, LAYOUT_W - 1)
    iy = np.clip(np.floor(all_y).astype(np.int32), 0, LAYOUT_H - 1)
    clr_vals = clr[iy, ix]
    min_clr = int(clr_vals.min())
    if min_clr < 255:
        bad_n = int((clr_vals < 255).sum())
        bad_idx = int(np.argmin(clr_vals))
        errors.append(
            f"{island}/{name}: mask touches animation_clearance (min={min_clr}, {bad_n} px, worst at ({all_x[bad_idx]:.1f},{all_y[bad_idx]:.1f}))"
        )

    # 2. Plot disks check
    for pidx, (px, py) in enumerate(plots):
        d = np.hypot(all_x - px, all_y - py)
        md = float(d.min())
        if md <= plot_r:
            errors.append(
                f"{island}/{name}: mask touches plot #{pidx} at ({px:.0f},{py:.0f}) r={plot_r:.0f} (min dist={md:.1f})"
            )

    # 3. Path centerline check (>= 14 layout px)
    # Sample at layout pixel resolution for speed (sub-pixel start points differ by <0.5px)
    check_x = lay_x.astype(np.float64) if len(lay_x) > 0 else lx[::4]
    check_y = lay_y.astype(np.float64) if len(lay_y) > 0 else ly[::4]
    pdist = point_to_segments_min_dist(check_x, check_y, segments)
    if pdist < PATH_MIN_DIST_PX:
        errors.append(
            f"{island}/{name}: mask comes within {pdist:.1f} px of path centerline (min {PATH_MIN_DIST_PX} px)"
        )

    # 4. Castle / cave / gate keep-outs
    for label, x0, y0, x1, y1 in gate_rects:
        hit = (all_x >= x0) & (all_x <= x1) & (all_y >= y0) & (all_y <= y1)
        if np.any(hit):
            errors.append(f"{island}/{name}: mask touches {label} rect [{x0:.1f},{y0:.1f},{x1:.1f},{y1:.1f}]")
    for label, gx, gy in gate_pts:
        md = float(np.hypot(all_x - gx, all_y - gy).min())
        if md < GATE_POINT_CLEAR_PX:
            errors.append(f"{island}/{name}: mask within {md:.1f} px of {label} ({gx:.0f},{gy:.0f})")

    return errors


def derive_start_and_place(island: str, element: str, crop: dict, mask_img: Image.Image, feather_start_px: int, source_rel: str, src_img: Image.Image):
    """Crop start.png and construct place.json dict matching existing Ch1/Ch2 format field-for-field."""
    cx, cy, cw, ch = crop["x"], crop["y"], crop["width"], crop["height"]
    sl, st, sr, sb = cx * SOURCE_SCALE, cy * SOURCE_SCALE, (cx + cw) * SOURCE_SCALE, (cy + ch) * SOURCE_SCALE
    start_img = src_img.crop((sl, st, sr, sb)).resize((START_W, START_H), Image.Resampling.LANCZOS)
    if start_img.mode != "RGB":
        start_img = start_img.convert("RGB")

    mk_arr = np.asarray(mask_img)
    ys, xs = np.nonzero(mk_arr)
    bbox = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]

    place = {
        "element": element,
        "id": f"{island}-{element}",
        "source": source_rel,
        "layoutSizePx": [LAYOUT_W, LAYOUT_H],
        "startSizePx": [START_W, START_H],
        "cropLayoutPx": {"x": cx, "y": cy, "width": cw, "height": ch},
        "sourcePxPerLayoutPx": SOURCE_SCALE,
        "sourceCropPxLTRB": [sl, st, sr, sb],
        "startPxPerLayoutPx": START_W / cw,
        "startPxPerSourcePx": START_W / (cw * SOURCE_SCALE),
        "resample": "Lanczos",
        "maskBBoxStartPxLTRB": bbox,
        "featherInwardStartPx": feather_start_px,
    }
    return start_img, place


def format_prompt(motion: str) -> str:
    return f"{PROMPT_HEADER}\n\n{motion.strip()}\n\n{PROMPT_FOOTER}\n"


def load_font(size: int):
    for p in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def render_contact_sheets(island: str, spec: dict, lv: dict, generated_items: list):
    """Write docs/anim-shots/ch3-prep/<island>.webp (~1400px wide) and <island>-starts.webp."""
    out_dir = ROOT / "docs/anim-shots/ch3-prep"
    out_dir.mkdir(parents=True, exist_ok=True)

    base = Image.open(ROOT / f"public/art2d/{lv['image']}@1x.webp").convert("RGBA")
    ov = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(ov)

    # 1. Paths drawn thin (yellow)
    for path in lv["paths"]:
        draw.line([tuple(p) for p in path], fill=(255, 235, 80, 190), width=2)

    # 2. Plots drawn thin (orange circles)
    pr = lv.get("plotRadiusPx", DEFAULT_PLOT_RADIUS_PX)
    for px, py in lv["plots"]:
        draw.ellipse((px - pr, py - pr, px + pr, py + pr), outline=(255, 165, 40, 200), width=2)

    # 3. Existing shipped animated rects in cyan (second colour)
    ma = json.loads((ROOT / f"src/data/mapAnim/{island}.json").read_text())
    font_sm = load_font(13)
    font_md = load_font(15)
    for e in ma.get("elements", []):
        rx, ry, rw, rh = e["rect"]
        draw.rectangle((rx, ry, rx + rw, ry + rh), fill=(0, 210, 255, 45), outline=(0, 235, 255, 230), width=2)
        draw.text((rx + 4, ry + 3), e["id"], fill=(160, 250, 255, 240), font=font_sm)

    # 4. New elements: mask tinted lime-green, crop outline bright lime + label
    for el in spec["elements"]:
        crop = el["crop"]
        cx, cy, cw, ch = crop["x"], crop["y"], crop["width"], crop["height"]
        for poly in el["mask"]:
            draw.polygon([(x, y) for x, y in poly], fill=(90, 255, 110, 85), outline=(140, 255, 150, 220))
        draw.rectangle((cx, cy, cx + cw, cy + ch), outline=(120, 255, 60, 255), width=3)
        label = f"{el['element']} ({el['kind']}, {cw}x{ch})"
        tb0 = draw.textbbox((0, 0), label, font=font_md)
        lw = tb0[2] - tb0[0]
        tx = max(4, min(cx + 5, LAYOUT_W - lw - 8))
        ty = max(4, cy - 18) if cy >= 20 else cy + 5
        tb = draw.textbbox((tx, ty), label, font=font_md)
        draw.rectangle((tb[0] - 3, tb[1] - 1, tb[2] + 3, tb[3] + 2), fill=(10, 26, 12, 200))
        draw.text((tx, ty), label, fill=(170, 255, 120, 255), font=font_md)

    comp = Image.alpha_composite(base, ov).convert("RGB")
    target_w = 1400
    target_h = round(LAYOUT_H * target_w / LAYOUT_W)
    comp = comp.resize((target_w, target_h), Image.Resampling.LANCZOS)
    comp.save(out_dir / f"{island}.webp", "WEBP", quality=88)

    # 5. Strip of new start.png thumbnails + mask overlay
    n = len(generated_items)
    thumb_w, thumb_h = 384, 216
    pad = 12
    header_h = 28
    cols = min(3, max(1, n))
    rows = math.ceil(n / cols)
    sheet_w = cols * thumb_w + (cols + 1) * pad
    sheet_h = rows * (thumb_h + header_h) + (rows + 1) * pad
    sheet = Image.new("RGB", (sheet_w, sheet_h), (22, 24, 28))
    sdraw = ImageDraw.Draw(sheet)

    for idx, (el, start_img, mask_img) in enumerate(generated_items):
        r = idx // cols
        c = idx % cols
        ox = pad + c * (thumb_w + pad)
        oy = pad + r * (thumb_h + header_h + pad)

        st_thumb = start_img.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS).convert("RGBA")
        mk_thumb = mask_img.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        mk_arr = np.asarray(mk_thumb, dtype=np.float32) / 255.0
        # Tint masked interior soft green and darken static exterior slightly
        tint = np.zeros((thumb_h, thumb_w, 4), dtype=np.uint8)
        tint[..., 0] = 60
        tint[..., 1] = 255
        tint[..., 2] = 90
        tint[..., 3] = np.rint(mk_arr * 90.0).astype(np.uint8)
        # Draw mask contour (~128 threshold)
        edge = (mk_arr > 0.05) & (mk_arr < 0.85)
        tint[edge] = [255, 255, 110, 210]
        blended = Image.alpha_composite(st_thumb, Image.fromarray(tint, "RGBA")).convert("RGB")
        sheet.paste(blended, (ox, oy + header_h))
        cw, ch = el["crop"]["width"], el["crop"]["height"]
        title = f"{el['element']} [{el['kind']}, d={el['depth']}, {cw}x{ch}]"
        sdraw.text((ox + 2, oy + 5), title, fill=(230, 245, 230), font=font_sm)

    sheet.save(out_dir / f"{island}-starts.webp", "WEBP", quality=88)


def run_self_check(target: str) -> int:
    """Re-derive an existing element from its committed cropLayoutPx and report max pixel diff."""
    island, element = target.split("/", 1)
    folder = ROOT / "design/art-2d/anim" / island / element
    committed_place = json.loads((folder / "place.json").read_text())
    committed_start = Image.open(folder / "start.png").convert("RGB")
    committed_mask = Image.open(folder / "mask.png").convert("L")

    lv = json.loads((ROOT / f"src/data/levels2d/{island}.json").read_text())
    source_rel = f"public/art2d/{lv['image']}@3x.webp"
    src_img = Image.open(ROOT / source_rel)

    rederived_start, rederived_place = derive_start_and_place(
        island,
        element,
        committed_place["cropLayoutPx"],
        committed_mask,
        committed_place["featherInwardStartPx"],
        source_rel,
        src_img,
    )

    diff = np.abs(np.asarray(committed_start, dtype=np.int16) - np.asarray(rederived_start, dtype=np.int16))
    max_diff = int(diff.max())
    mean_diff = float(diff.mean())

    field_mismatches = []
    for k in sorted(set(committed_place.keys()) | set(rederived_place.keys())):
        cv = committed_place.get(k)
        rv = rederived_place.get(k)
        if isinstance(cv, float) and isinstance(rv, float):
            if abs(cv - rv) > 1e-12:
                field_mismatches.append((k, cv, rv))
        elif cv != rv:
            field_mismatches.append((k, cv, rv))

    print(f"SELF-CHECK {target}:")
    print(f"  start.png max pixel diff = {max_diff} (mean = {mean_diff:.6f})")
    print(f"  place.json field mismatches = {len(field_mismatches)}")
    for k, cv, rv in field_mismatches:
        print(f"    MISMATCH {k}: committed={cv!r} vs rederived={rv!r}")
    return 0 if (max_diff == 0 and not field_mismatches) else 1


def process_island(island: str):
    spec_path = ROOT / f"design/art-2d/anim/{island}/ch3-elements.json"
    if not spec_path.exists():
        raise FileNotFoundError(f"Missing spec file: {spec_path}")
    spec = json.loads(spec_path.read_text())
    if spec.get("island") != island:
        raise ValueError(f"{spec_path}: island field {spec.get('island')!r} != {island!r}")

    preexisting = get_preexisting_elements(island)
    keepout = build_keepout_data(island)
    lv = keepout[0]

    # Validate ALL elements before writing anything
    all_errors = []
    seen = set()
    for el in spec.get("elements", []):
        all_errors.extend(validate_element(island, el, preexisting, seen, keepout))
    if all_errors:
        for err in all_errors:
            print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(1)

    source_rel = f"public/art2d/{lv['image']}@3x.webp"
    src_img = Image.open(ROOT / source_rel)
    if src_img.size != (LAYOUT_W * SOURCE_SCALE, LAYOUT_H * SOURCE_SCALE):
        raise ValueError(f"{source_rel}: unexpected size {src_img.size}")

    index_entries = []
    generated_items = []

    # Coverage stats (rect union before vs after, and mask area after)
    ma = json.loads((ROOT / f"src/data/mapAnim/{island}.json").read_text())
    total_area = LAYOUT_W * LAYOUT_H
    before_grid = np.zeros((LAYOUT_H, LAYOUT_W), dtype=bool)
    for e in ma.get("elements", []):
        rx, ry, rw, rh = e["rect"]
        before_grid[
            max(0, int(round(ry))) : min(LAYOUT_H, int(round(ry + rh))),
            max(0, int(round(rx))) : min(LAYOUT_W, int(round(rx + rw))),
        ] = True
    after_rect_grid = before_grid.copy()
    after_mask_grid = before_grid.copy()

    for el in spec["elements"]:
        name = el["element"]
        crop = el["crop"]
        mask_img, feather_start_px = rasterize_mask_start(el["mask"], crop, el["featherPx"])
        start_img, place = derive_start_and_place(island, name, crop, mask_img, feather_start_px, source_rel, src_img)
        prompt_text = format_prompt(el["motion"])

        out_folder = ROOT / "design/art-2d/anim" / island / name
        out_folder.mkdir(parents=True, exist_ok=True)
        start_img.save(out_folder / "start.png", "PNG")
        mask_img.save(out_folder / "mask.png", "PNG")
        (out_folder / "place.json").write_text(json.dumps(place, indent=2) + "\n")
        (out_folder / "prompt.txt").write_text(prompt_text)

        generated_items.append((el, start_img, mask_img))
        index_entries.append(
            {
                "id": f"{island}-{name}",
                "island": island,
                "element": name,
                "prompt": prompt_text.rstrip("\n"),
                "start": f"design/art-2d/anim/{island}/{name}/start.png",
            }
        )

        # Compute resulting rect in layout space (same formula as pack_loops.py)
        bl, bt, br, bb = place["maskBBoxStartPxLTRB"]
        s = place["startPxPerLayoutPx"]
        rx0 = crop["x"] + bl / s
        ry0 = crop["y"] + bt / s
        rx1 = crop["x"] + br / s
        ry1 = crop["y"] + bb / s
        after_rect_grid[
            max(0, int(round(ry0))) : min(LAYOUT_H, int(round(ry1))),
            max(0, int(round(rx0))) : min(LAYOUT_W, int(round(rx1))),
        ] = True
        after_mask_grid |= rasterize_mask_layout(el["mask"])

    render_contact_sheets(island, spec, lv, generated_items)

    before_pct = before_grid.sum() / total_area * 100.0
    after_rect_pct = after_rect_grid.sum() / total_area * 100.0
    after_mask_pct = after_mask_grid.sum() / total_area * 100.0
    print(
        f"{island}: OK ({len(spec['elements'])} new) | coverage before={before_pct:.2f}% -> "
        f"planned rect union={after_rect_pct:.2f}% (exact mask union={after_mask_pct:.2f}%)"
    )
    return index_entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("islands", nargs="*", help="Island IDs to process (e.g. l1c i01 ...)")
    parser.add_argument("--self-check", metavar="ISLAND/ELEMENT", help="Verify exact geometry against an existing prep folder")
    parser.add_argument("--index", type=Path, default=ROOT / "design/art-2d/anim/index-ch3-a.json", help="Output index JSON path")
    parser.add_argument("--no-index", action="store_true", help="Do not write the index JSON")
    args = parser.parse_args()

    if args.self_check:
        sys.exit(run_self_check(args.self_check))

    if not args.islands:
        parser.error("Provide island IDs or --self-check")

    all_entries = []
    for island in args.islands:
        all_entries.extend(process_island(island))

    if not args.no_index:
        # Merge by island order if updating subset, or write complete list
        existing = []
        if args.index.exists():
            try:
                existing = json.loads(args.index.read_text())
            except Exception:
                existing = []
        processed_set = set(args.islands)
        kept = [e for e in existing if e.get("island") not in processed_set]
        combined = kept + all_entries
        order = {isl: idx for idx, isl in enumerate(["l1c", "i01", "i02", "i03", "i04", "i05", "i06", "i07", "i08"])}
        combined.sort(key=lambda e: (order.get(e["island"], 999), e["id"]))
        args.index.write_text(json.dumps(combined, indent=2) + "\n")
        print(f"Wrote {len(combined)} entries to {args.index.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
