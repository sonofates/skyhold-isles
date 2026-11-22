"""Prepare Chapter 3 (batch B: i09-i16) animated map elements from spec files.

Turns design/art-2d/anim/<island>/ch3-elements.json into:
  - design/art-2d/anim/<island>/<element>/{start.png, mask.png, place.json, prompt.txt}
  - docs/anim-shots/ch3-prep/<island>.webp
  - docs/anim-shots/ch3-prep/<island>-starts.webp
  - design/art-2d/anim/index-ch3-b.json

Validates that every mask avoids animation_clearance (road/bridge/arcade),
plot disks (using levels2d plotRadiusPx), path centerlines (>= 14 layout px),
and castle/entrance gate rects. Uses PIL + NumPy only (no cv2 dependency).
"""

import argparse
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/map-anim"))
sys.path.insert(0, str(ROOT / "tools/map-compose"))

from ground import catmull
from road_mask import animation_clearance

LAYOUT_SIZE = (1846, 852)
START_SIZE = (1280, 720)
SOURCE_SCALE = 3
MIN_PATH_DIST_PX = 14.0
VALID_KINDS = {
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
    "brushwork, palette and daylight unchanged. Only the element described "
    "below moves; every other part of the picture stays perfectly still, and "
    "the motion fades out smoothly at its edges. The last frame matches the "
    "first frame exactly."
)

PROMPT_FOOTER = (
    "Match the opening pose, light and brush marks at the eight-second seam. "
    "Carry the rhythm smoothly through the join."
)


def load_font(size: int):
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def build_prompt(motion: str) -> str:
    return f"{PROMPT_HEADER}\n\n{motion.strip()}\n\n{PROMPT_FOOTER}"


def crop_start_frame(source_img: Image.Image, crop: dict) -> tuple[Image.Image, list[int]]:
    x, y, w, h = crop["x"], crop["y"], crop["width"], crop["height"]
    ltrb = [x * SOURCE_SCALE, y * SOURCE_SCALE, (x + w) * SOURCE_SCALE, (y + h) * SOURCE_SCALE]
    cropped = source_img.crop(tuple(ltrb)).convert("RGB")
    resized = cropped.resize(START_SIZE, Image.Resampling.LANCZOS)
    return resized, ltrb


def rasterize_feathered_mask(polygons_layout: list, crop: dict, feather_layout_px: float) -> tuple[np.ndarray, int, list[int]]:
    """Rasterize layout-space polygons into 1280x720 with inward Chebyshev smoothstep feather."""
    scale = START_SIZE[0] / crop["width"]
    feather_start_px = max(1, int(round(feather_layout_px * scale)))

    canvas = Image.new("L", START_SIZE, 0)
    draw = ImageDraw.Draw(canvas)
    ox, oy = crop["x"], crop["y"]
    for poly in polygons_layout:
        pts = [((p[0] - ox) * scale, (p[1] - oy) * scale) for p in poly]
        draw.polygon(pts, fill=255)

    bin_mask = (np.asarray(canvas) > 0).astype(np.uint8)
    if bin_mask.sum() == 0:
        raise ValueError("Rasterized mask is empty")

    # Exact inward Chebyshev distance matching existing ch1/ch2 prep masks.
    dist = np.zeros(bin_mask.shape, dtype=np.int32)
    cur = bin_mask.copy()
    for _ in range(feather_start_px):
        dist += cur
        if cur.sum() == 0:
            break
        cur = (np.asarray(Image.fromarray(cur * 255).filter(ImageFilter.MinFilter(3))) > 0).astype(np.uint8)

    t = np.clip(dist / float(feather_start_px), 0.0, 1.0)
    mask = np.rint(255.0 * (t * t * (3.0 - 2.0 * t))).astype(np.uint8)

    nz = np.argwhere(mask > 0)
    if len(nz) == 0:
        raise ValueError("Feathered mask is empty")
    bbox = [int(nz[:, 1].min()), int(nz[:, 0].min()), int(nz[:, 1].max()) + 1, int(nz[:, 0].max()) + 1]
    return mask, feather_start_px, bbox


def rasterize_layout_mask(polygons_layout: list) -> np.ndarray:
    canvas = Image.new("L", LAYOUT_SIZE, 0)
    draw = ImageDraw.Draw(canvas)
    for poly in polygons_layout:
        draw.polygon([(p[0], p[1]) for p in poly], fill=255)
    return np.asarray(canvas) > 0


def build_forbidden_zones(island: str) -> dict:
    layout = json.loads((ROOT / f"src/data/levels2d/{island}.json").read_text())
    w, h = layout["imageSize"]
    assert (w, h) == LAYOUT_SIZE, f"{island}: unexpected imageSize {layout['imageSize']}"

    clearance = np.asarray(animation_clearance(island))
    road_forbidden = clearance < 255

    # Plot disks: game uses plotRadiusPx (see src/render2d/towerFit.ts & plotLayer.ts)
    plot_r = float(layout["plotRadiusPx"])
    yy, xx = np.ogrid[:h, :w]
    plot_forbidden = np.zeros((h, w), dtype=bool)
    for px, py in layout["plots"]:
        plot_forbidden |= (xx - px) ** 2 + (yy - py) ** 2 <= plot_r ** 2

    # Path centerlines (raw + Catmull-Rom spline) with MIN_PATH_DIST_PX clearance
    path_forbidden = np.zeros((h, w), dtype=bool)
    path_img = Image.new("L", (w, h), 0)
    pdraw = ImageDraw.Draw(path_img)
    r_int = int(math.ceil(MIN_PATH_DIST_PX))
    for path in layout["paths"]:
        raw_pts = [tuple(p) for p in path]
        for pts in (raw_pts, catmull(raw_pts)):
            for i in range(len(pts) - 1):
                x0, y0 = pts[i]
                x1, y1 = pts[i + 1]
                # Sample densely along segment to get exact circular radius clearance
                seg_len = math.hypot(x1 - x0, y1 - y0)
                steps = max(1, int(math.ceil(seg_len / 2.0)))
                for s in range(steps + 1):
                    u = s / steps
                    cx = x0 + (x1 - x0) * u
                    cy = y0 + (y1 - y0) * u
                    pdraw.ellipse((cx - r_int, cy - r_int, cx + r_int, cy + r_int), fill=255)
    path_forbidden = np.asarray(path_img) > 0

    # Gate rects (castle goalGate + cave entrances)
    gate_img = Image.new("L", (w, h), 0)
    gdraw = ImageDraw.Draw(gate_img)
    for ent in layout.get("entrances", []):
        rect = ent.get("gate", {}).get("front", {}).get("rect")
        if rect:
            gx, gy, gw, gh = rect
            gdraw.rectangle((gx, gy, gx + gw, gy + gh), fill=255)
    gg = layout.get("goalGate", {}).get("front", {}).get("rect")
    if gg:
        gx, gy, gw, gh = gg
        gdraw.rectangle((gx, gy, gx + gw, gy + gh), fill=255)
    gate_forbidden = np.asarray(gate_img) > 0

    return {
        "layout": layout,
        "road": road_forbidden,
        "plots": plot_forbidden,
        "paths": path_forbidden,
        "gates": gate_forbidden,
    }


def existing_reserved_names(island: str) -> set[str]:
    names = set()
    ma_path = ROOT / f"src/data/mapAnim/{island}.json"
    if ma_path.exists():
        ma = json.loads(ma_path.read_text())
        names.update(e["id"] for e in ma.get("elements", []))
    for idx_name in ("index-ch1.json", "index-ch2.json"):
        idx_path = ROOT / "design/art-2d/anim" / idx_name
        if idx_path.exists():
            for row in json.loads(idx_path.read_text()):
                if row.get("island") == island:
                    names.add(row["element"])
    return names


def validate_element(island: str, elem: dict, zones: dict, reserved: set[str], seen: set[str]) -> list[str]:
    errors = []
    name = elem.get("element", "")
    if not isinstance(name, str) or not KEBAB_RE.match(name):
        errors.append(f"{island}/{name}: element name must be kebab-case")
    if name in reserved:
        errors.append(f"{island}/{name}: reuses an existing ch1/ch2/shipped element folder name")
    if name in seen:
        errors.append(f"{island}/{name}: duplicate element name in spec")

    kind = elem.get("kind")
    if kind not in VALID_KINDS:
        errors.append(f"{island}/{name}: invalid kind {kind!r}")

    crop = elem.get("crop", {})
    for k in ("x", "y", "width", "height"):
        if k not in crop or not isinstance(crop[k], int):
            errors.append(f"{island}/{name}: crop.{k} must be an integer")
    if not errors:
        cx, cy, cw, ch = crop["x"], crop["y"], crop["width"], crop["height"]
        if cw * 9 != ch * 16:
            errors.append(f"{island}/{name}: crop {cw}x{ch} is not exact 16:9")
        if cw < 160 or ch < 90 or cw > 480 or ch > 270:
            errors.append(f"{island}/{name}: crop {cw}x{ch} outside 160x90..480x270")
        if cx < 0 or cy < 0 or cx + cw > LAYOUT_SIZE[0] or cy + ch > LAYOUT_SIZE[1]:
            errors.append(f"{island}/{name}: crop ({cx},{cy},{cw},{ch}) outside {LAYOUT_SIZE}")

        polys = elem.get("mask", [])
        if not polys or not isinstance(polys, list):
            errors.append(f"{island}/{name}: mask must be a non-empty list of polygons")
        else:
            for pi, poly in enumerate(polys):
                if len(poly) < 3:
                    errors.append(f"{island}/{name}: mask polygon {pi} has < 3 vertices")
                for px, py in poly:
                    if not (cx <= px <= cx + cw and cy <= py <= cy + ch):
                        errors.append(f"{island}/{name}: mask point ({px},{py}) outside crop ({cx},{cy},{cw},{ch})")

            lmask = rasterize_layout_mask(polys)
            if lmask.sum() == 0:
                errors.append(f"{island}/{name}: layout mask has 0 pixels")

            # Check also the exact start-frame mask projected back to layout space
            # so feathered/rasterized edges cannot leak into forbidden zones.
            start_mask, _, _ = rasterize_feathered_mask(polys, crop, elem["featherPx"])
            s = START_SIZE[0] / cw
            proj_mask = np.zeros((LAYOUT_SIZE[1], LAYOUT_SIZE[0]), dtype=bool)
            # Sample/downsample start mask (>0) onto layout crop region conservatively (max pool)
            sm_nz = start_mask > 0
            ys_s, xs_s = np.where(sm_nz)
            lx = np.clip(np.floor(cx + xs_s / s).astype(int), 0, LAYOUT_SIZE[0] - 1)
            ly = np.clip(np.floor(cy + ys_s / s).astype(int), 0, LAYOUT_SIZE[1] - 1)
            proj_mask[ly, lx] = True
            combined = lmask | proj_mask

            road_hits = int((combined & zones["road"]).sum())
            if road_hits > 0:
                errors.append(f"{island}/{name}: mask touches animation_clearance ({road_hits} layout px)")

            plot_hits = int((combined & zones["plots"]).sum())
            if plot_hits > 0:
                errors.append(f"{island}/{name}: mask touches plot disk ({plot_hits} layout px)")

            path_hits = int((combined & zones["paths"]).sum())
            if path_hits > 0:
                errors.append(f"{island}/{name}: mask within {MIN_PATH_DIST_PX:.0f}px of path centerline ({path_hits} layout px)")

            gate_hits = int((combined & zones["gates"]).sum())
            if gate_hits > 0:
                errors.append(f"{island}/{name}: mask touches castle/entrance gate rect ({gate_hits} layout px)")

            static_frac = float((start_mask == 0).mean())
            if static_frac < 0.15:
                errors.append(f"{island}/{name}: too little static margin outside mask ({static_frac:.2%} < 15%)")

    if not elem.get("motion") or not isinstance(elem["motion"], str) or len(elem["motion"].strip()) < 20:
        errors.append(f"{island}/{name}: motion paragraph missing or too short")
    if elem.get("depth") not in (0, 1, 2):
        errors.append(f"{island}/{name}: depth must be 0, 1, or 2")
    if not elem.get("why"):
        errors.append(f"{island}/{name}: why field required")
    return errors


def render_contact_sheets(island: str, spec: dict, zones: dict, generated: list[dict]):
    out_dir = ROOT / "docs/anim-shots/ch3-prep"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Full island overview (~1400 px wide)
    base = Image.open(ROOT / f"public/art2d/map-{island}-layered@1x.webp").convert("RGBA")
    W, H = base.size
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    font = load_font(16)
    font_sm = load_font(13)

    # Thin paths (white/cyan)
    for path in zones["layout"]["paths"]:
        pts = [tuple(p) for p in path]
        odraw.line(pts, fill=(170, 240, 255, 160), width=2)

    # Thin plots (orange)
    pr = zones["layout"]["plotRadiusPx"]
    for px, py in zones["layout"]["plots"]:
        odraw.ellipse((px - pr, py - pr, px + pr, py + pr), outline=(255, 175, 60, 175), width=2)

    # Existing shipped animated rects (lime green)
    ma = json.loads((ROOT / f"src/data/mapAnim/{island}.json").read_text())
    existing_area = 0.0
    for e in ma["elements"]:
        rx, ry, rw, rh = e["rect"]
        existing_area += rw * rh
        odraw.rectangle((rx, ry, rx + rw, ry + rh), outline=(70, 255, 110, 240), fill=(70, 255, 110, 45), width=3)
        odraw.text((rx + 4, ry + 3), f"[ship] {e['id']}", fill=(210, 255, 220, 255), font=font_sm)

    # NEW masks (tinted cyan/magenta) + crop outlines (bright yellow) + labels
    palette = [
        (0, 220, 255),
        (255, 110, 220),
        (255, 210, 40),
        (130, 180, 255),
        (255, 140, 70),
        (160, 255, 190),
        (220, 150, 255),
    ]
    new_area = 0.0
    for idx, item in enumerate(generated):
        col = palette[idx % len(palette)]
        crop = item["spec"]["crop"]
        cx, cy, cw, ch = crop["x"], crop["y"], crop["width"], crop["height"]
        # Draw tinted mask polygons
        for poly in item["spec"]["mask"]:
            pts = [(p[0], p[1]) for p in poly]
            odraw.polygon(pts, fill=(*col, 95), outline=(*col, 245))
        # Draw crop rectangle
        odraw.rectangle((cx, cy, cx + cw, cy + ch), outline=(255, 245, 90, 235), width=2)
        # Mask rect area in layout px
        l, t, r, b = item["place"]["maskBBoxStartPxLTRB"]
        s = item["place"]["startPxPerLayoutPx"]
        new_area += ((r - l) / s) * ((b - t) / s)
        # Label with dark pill background for readability (clamp inside canvas width)
        label = f"{item['spec']['element']} ({item['spec']['kind']}, {cw}x{ch})"
        tb0 = odraw.textbbox((0, 0), label, font=font_sm)
        tw_lbl = tb0[2] - tb0[0]
        lx = min(max(cx + 4, 4), W - tw_lbl - 8)
        ly = max(cy + 4, 4)
        bbox_t = odraw.textbbox((lx, ly), label, font=font_sm)
        odraw.rectangle((bbox_t[0] - 2, bbox_t[1] - 1, bbox_t[2] + 3, bbox_t[3] + 2), fill=(15, 18, 28, 200))
        odraw.text((lx, ly), label, fill=(255, 255, 240, 255), font=font_sm)

    comp = Image.alpha_composite(base, overlay).convert("RGB")
    target_w = 1400
    target_h = int(round(H * target_w / W))
    comp = comp.resize((target_w, target_h), Image.Resampling.LANCZOS)

    # Header bar
    total_area = W * H
    before_pct = 100.0 * existing_area / total_area
    after_pct = 100.0 * (existing_area + new_area) / total_area
    bar_h = 34
    sheet = Image.new("RGB", (target_w, target_h + bar_h), (20, 24, 32))
    sheet.paste(comp, (0, bar_h))
    sdraw = ImageDraw.Draw(sheet)
    sdraw.text(
        (12, 8),
        f"{island} ch3 prep | {len(generated)} NEW elements | coverage: {before_pct:.1f}% -> {after_pct:.1f}% | "
        f"Green=existing shipped, Yellow=new crops, Tinted=new masks, Orange=plots, Cyan=paths",
        fill=(240, 244, 255),
        font=font,
    )
    sheet.save(out_dir / f"{island}.webp", "WEBP", quality=88)

    # 2. Starts strip with mask overlay
    n = len(generated)
    cols = min(3, max(1, n))
    rows = math.ceil(n / cols)
    tw, th = 448, 252  # 16:9 thumbnails
    pad = 12
    label_h = 26
    strip_w = cols * tw + (cols + 1) * pad
    strip_h = rows * (th + label_h) + (rows + 1) * pad
    strip = Image.new("RGB", (strip_w, strip_h), (18, 20, 28))
    st_draw = ImageDraw.Draw(strip)

    for idx, item in enumerate(generated):
        col = palette[idx % len(palette)]
        gx = pad + (idx % cols) * (tw + pad)
        gy = pad + (idx // cols) * (th + label_h + pad)
        start_im = Image.open(item["folder"] / "start.png").convert("RGBA").resize((tw, th), Image.Resampling.LANCZOS)
        mask_im = Image.open(item["folder"] / "mask.png").resize((tw, th), Image.Resampling.BILINEAR)
        m_arr = np.asarray(mask_im, dtype=np.float32) / 255.0

        tint = np.zeros((th, tw, 4), dtype=np.uint8)
        tint[:, :, 0] = col[0]
        tint[:, :, 1] = col[1]
        tint[:, :, 2] = col[2]
        tint[:, :, 3] = np.rint(m_arr * 95).astype(np.uint8)

        # Draw crisp contour around mask > 0
        edge = (m_arr > 0.02) & (m_arr < 0.45)
        tint[edge, 3] = 220

        blended = Image.alpha_composite(start_im, Image.fromarray(tint, "RGBA")).convert("RGB")
        strip.paste(blended, (gx, gy + label_h))
        c = item["spec"]["crop"]
        title = f"{item['spec']['element']} [{item['spec']['kind']}] {c['width']}x{c['height']} d={item['spec']['depth']}"
        st_draw.text((gx + 2, gy + 5), title, fill=(240, 244, 255), font=font_sm)

    strip.save(out_dir / f"{island}-starts.webp", "WEBP", quality=88)


def run_self_check(island: str, element: str) -> dict:
    """Re-derive an existing committed element and verify pixel-identical start.png + mask.png + place.json."""
    folder = ROOT / "design/art-2d/anim" / island / element
    ref_place = json.loads((folder / "place.json").read_text())
    ref_start = np.asarray(Image.open(folder / "start.png").convert("RGB"), dtype=np.int16)
    ref_mask = np.asarray(Image.open(folder / "mask.png"), dtype=np.int16)

    src_img = Image.open(ROOT / ref_place["source"])
    gen_start_im, gen_ltrb = crop_start_frame(src_img, ref_place["cropLayoutPx"])
    gen_start = np.asarray(gen_start_im, dtype=np.int16)
    start_diff = np.abs(gen_start - ref_start)

    # Re-derive Chebyshev smoothstep feather from ref_mask binary support
    f = ref_place["featherInwardStartPx"]
    cur = (ref_mask > 0).astype(np.uint8)
    dist = np.zeros(cur.shape, dtype=np.int32)
    for _ in range(f):
        dist += cur
        cur = (np.asarray(Image.fromarray(cur * 255).filter(ImageFilter.MinFilter(3))) > 0).astype(np.uint8)
    t = np.clip(dist / float(f), 0.0, 1.0)
    gen_mask = np.rint(255.0 * (t * t * (3.0 - 2.0 * t))).astype(np.int16)
    mask_diff = np.abs(gen_mask - ref_mask)

    s = START_SIZE[0] / ref_place["cropLayoutPx"]["width"]
    nz = np.argwhere(gen_mask > 0)
    gen_bbox = [int(nz[:, 1].min()), int(nz[:, 0].min()), int(nz[:, 1].max()) + 1, int(nz[:, 0].max()) + 1]
    rebuilt_place = {
        "element": element,
        "id": f"{island}-{element}",
        "source": f"public/art2d/map-{island}-layered@3x.webp",
        "layoutSizePx": list(LAYOUT_SIZE),
        "startSizePx": list(START_SIZE),
        "cropLayoutPx": ref_place["cropLayoutPx"],
        "sourcePxPerLayoutPx": SOURCE_SCALE,
        "sourceCropPxLTRB": gen_ltrb,
        "startPxPerLayoutPx": s,
        "startPxPerSourcePx": s / SOURCE_SCALE,
        "resample": "Lanczos",
        "maskBBoxStartPxLTRB": gen_bbox,
        "featherInwardStartPx": f,
    }
    place_exact = rebuilt_place == ref_place
    return {
        "target": f"{island}/{element}",
        "startMaxPixelDiff": int(start_diff.max()),
        "startMeanPixelDiff": float(start_diff.mean()),
        "maskMaxPixelDiff": int(mask_diff.max()),
        "placeExactMatch": place_exact,
    }


def process_island(island: str) -> tuple[list[dict], dict]:
    spec_path = ROOT / "design/art-2d/anim" / island / "ch3-elements.json"
    spec = json.loads(spec_path.read_text())
    if spec.get("island") != island:
        raise ValueError(f"{spec_path}: island mismatch ({spec.get('island')} != {island})")

    zones = build_forbidden_zones(island)
    reserved = existing_reserved_names(island)
    seen = set()
    all_errors = []
    for elem in spec["elements"]:
        errs = validate_element(island, elem, zones, reserved, seen)
        all_errors.extend(errs)
        seen.add(elem.get("element", ""))

    if all_errors:
        for e in all_errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    source_rel = f"public/art2d/map-{island}-layered@3x.webp"
    source_img = Image.open(ROOT / source_rel)

    generated = []
    index_rows = []
    new_rect_area = 0.0

    for elem in spec["elements"]:
        name = elem["element"]
        crop = elem["crop"]
        folder = ROOT / "design/art-2d/anim" / island / name
        folder.mkdir(parents=True, exist_ok=True)

        start_im, ltrb = crop_start_frame(source_img, crop)
        start_im.save(folder / "start.png", "PNG")

        mask_arr, feather_start_px, mask_bbox = rasterize_feathered_mask(elem["mask"], crop, elem["featherPx"])
        Image.fromarray(mask_arr, mode="L").save(folder / "mask.png", "PNG")

        s = START_SIZE[0] / crop["width"]
        place = {
            "element": name,
            "id": f"{island}-{name}",
            "source": source_rel,
            "layoutSizePx": list(LAYOUT_SIZE),
            "startSizePx": list(START_SIZE),
            "cropLayoutPx": crop,
            "sourcePxPerLayoutPx": SOURCE_SCALE,
            "sourceCropPxLTRB": ltrb,
            "startPxPerLayoutPx": s,
            "startPxPerSourcePx": s / SOURCE_SCALE,
            "resample": "Lanczos",
            "maskBBoxStartPxLTRB": mask_bbox,
            "featherInwardStartPx": feather_start_px,
        }
        (folder / "place.json").write_text(json.dumps(place, indent=2) + "\n")

        prompt_text = build_prompt(elem["motion"])
        (folder / "prompt.txt").write_text(prompt_text + "\n")

        l, t, r, b = mask_bbox
        new_rect_area += ((r - l) / s) * ((b - t) / s)

        generated.append({"spec": elem, "place": place, "folder": folder})
        index_rows.append(
            {
                "id": f"{island}-{name}",
                "island": island,
                "element": name,
                "prompt": prompt_text,
                "start": f"design/art-2d/anim/{island}/{name}/start.png",
            }
        )

    render_contact_sheets(island, spec, zones, generated)

    ma = json.loads((ROOT / f"src/data/mapAnim/{island}.json").read_text())
    existing_area = sum(e["rect"][2] * e["rect"][3] for e in ma["elements"])
    total_area = LAYOUT_SIZE[0] * LAYOUT_SIZE[1]
    summary = {
        "island": island,
        "count": len(generated),
        "beforePct": round(100.0 * existing_area / total_area, 2),
        "afterPct": round(100.0 * (existing_area + new_rect_area) / total_area, 2),
    }
    return index_rows, summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("islands", nargs="*", help="Island IDs to process (default: i09..i16)")
    parser.add_argument("--self-check", metavar="ISLAND/ELEMENT", default="i16/brazier-smoke", help="Existing element to verify geometry against")
    parser.add_argument("--skip-index", action="store_true", help="Do not rewrite design/art-2d/anim/index-ch3-b.json")
    args = parser.parse_args()

    if args.self_check:
        isl, el = args.self_check.split("/", 1)
        chk = run_self_check(isl, el)
        print("SELF-CHECK:", json.dumps(chk))
        if chk["startMaxPixelDiff"] != 0 or chk["maskMaxPixelDiff"] != 0 or not chk["placeExactMatch"]:
            print("ERROR: self-check failed!", file=sys.stderr)
            sys.exit(1)

    islands = args.islands or [f"i{i:02d}" for i in range(9, 17)]
    all_rows = []
    summaries = []
    for isl in islands:
        rows, summ = process_island(isl)
        all_rows.extend(rows)
        summaries.append(summ)
        print(f"OK {isl}: {summ['count']} new elements | coverage {summ['beforePct']:.2f}% -> {summ['afterPct']:.2f}%")

    if not args.skip_index:
        idx_path = ROOT / "design/art-2d/anim/index-ch3-b.json"
        # Preserve entries for islands not in this invocation if file exists, otherwise write clean list
        existing = []
        if idx_path.exists():
            existing = [r for r in json.loads(idx_path.read_text()) if r.get("island") not in set(islands)]
        combined = existing + all_rows
        idx_path.write_text(json.dumps(combined, indent=2) + "\n")
        print(f"Wrote {len(combined)} entries to {idx_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
