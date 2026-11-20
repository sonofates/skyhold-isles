"""Build annotated close-ups from the lossless Playwright frames. Requires Pillow and numpy."""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


def screen_rect(element, case, pad=0):
    x, y, w, h = element["rect"]
    fit = case.get("captureFit", case["fit"])
    scale = fit["scale"]
    dpr = case["dpr"]
    return tuple(
        v * dpr
        for v in (
            fit["offsetX"] + (x - pad) * scale,
            fit["offsetY"] + (y - pad) * scale,
            fit["offsetX"] + (x + w + pad) * scale,
            fit["offsetY"] + (y + h + pad) * scale,
        )
    )


def coverage(atlas, elements, case, size):
    mask = Image.new("L", size)
    for e in elements:
        x, y, w, h = e["cell"]
        cell = atlas.crop((x, y, x + w, y + h))
        l, t, r, b = screen_rect(e, case)
        # Allow two device pixels for bilinear filtering and subpixel rounding at the edge.
        cell = cell.resize((round(r) - round(l), round(b) - round(t)), Image.Resampling.BILINEAR)
        box = (round(l), round(t), round(r), round(b))
        mask.paste(ImageChops.lighter(cell, mask.crop(box)), box)
    return np.asarray(mask.filter(ImageFilter.MaxFilter(5))) > 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("island", nargs="?", default="i02")
    args = parser.parse_args()
    meta = json.loads((args.out / "measurements.json").read_text())
    cases = {c["name"]: c for c in meta["cases"]}
    data = json.loads((Path("src/data/mapAnim") / (args.island + ".json")).read_text())
    directory = args.out / "closeups"
    directory.mkdir(exist_ok=True)
    specs = [
        ("desktop", ["static", "2", "4", "last"], ["Static", "2.00 s", "4.00 s", "Final frame"]),
        ("phone", ["static", "2", "4", "last"], ["Static", "2.00 s", "4.00 s", "Final frame"]),
        (
            "swap",
            ["static", "2x", "static3x", "3x"],
            ["2× static", "2× at 3.00 s", "3× static", "3× at 3.00 s"],
        ),
    ]
    survey = args.island != "i02"
    if survey:
        specs = specs[:2]
        if "full-map" in cases:
            specs.append(("full-map", ["0", "2", "4", "last"], ["Frame zero", "2.00 s", "4.00 s", "Final frame"]))
        # All six full-viewport captures remain available at their original CSS dimensions.
        # WebP delta frames keep the evidence small enough to ship with the handoff.
        for name in ("desktop", "phone"):
            sequence = [Image.open(args.work / f"{name}-seq-{i}.jpg") for i in range(6)]
            # Identify the sought time even where the HUD hides the moving paint. Distinct
            # timecodes also preserve all six samples when the encoder sees duplicate images.
            font = ImageFont.truetype("DejaVuSans.ttf", 13)
            for frame, time in zip(sequence, meta["sequenceTimes"], strict=True):
                draw = ImageDraw.Draw(frame)
                x, y = frame.width - 68, frame.height - 23
                draw.rectangle((x, y, frame.width - 3, frame.height - 3), fill="#203036")
                draw.text((x + 5, y + 2), f"{time:.3f} s", font=font, fill="#ffffff")
            sequence[0].save(
                args.out / (name + ".webp"),
                save_all=True,
                append_images=sequence[1:],
                duration=[1500, 1500, 1500, 1500, 1958, 42],
                loop=0,
                quality=78,
                minimize_size=True,
                method=5,
            )
    images = {
        name: {f: Image.open(args.work / f"{name}-{f}.png").convert("RGB") for f in files} for name, files, _ in specs
    }
    checks = []
    for name in ("desktop", "phone", "full-map"):
        if name not in cases:
            continue
        first = Image.open(args.work / f"{name}-0.png").convert("RGB")
        last = images[name]["last"]
        active = images[name]["4"]
        track = data.get("compact", data) if cases[name]["map"] <= 1 else data
        atlas = Image.open(Path("public/art2d") / track["mask"]).convert("L")
        atlas = atlas.resize((data["width"], data["height"]), Image.Resampling.BILINEAR)
        allowed = coverage(atlas, data["elements"], cases[name], first.size)
        start = np.asarray(first, dtype=np.int16)
        wrap = np.max(np.abs(start - np.asarray(last)), axis=2)
        motion = np.max(np.abs(start - np.asarray(active)), axis=2)
        for e in data["elements"]:
            l, t, r, b = map(round, screen_rect(e, cases[name], 5))
            crop = np.s_[max(0, t) : b, max(0, l) : r]
            leak = motion[crop][~allowed[crop]]
            result = {
                "view": name,
                "element": e["id"],
                "wrapMax": int(wrap[crop].max()),
                "outsideMax": int(leak.max(initial=0)),
                "movingPixels": int(np.sum(motion[crop] > 3)),
            }
            checks.append(result)
            print(result)
            assert result["wrapMax"] == 0
            assert result["outsideMax"] <= 3
            assert result["movingPixels"] > 0
    if survey:
        (args.out / "pixel-checks.json").write_text(json.dumps(checks, indent=2) + "\n")
    font = ImageFont.truetype("DejaVuSans.ttf", 13)
    for e in data["elements"]:
        width, height = e["rect"][2:]
        scale = min(3.5, max(1.75, 140 / (width + 18)))
        if survey:
            # Preserve detail in small features and keep wide water/wheat comparisons readable at 1:1.
            scale = min(scale, 320 / (width + 18), 240 / (height + 18))
        w, h = round((width + 18) * scale), round((height + 18) * scale)
        cell_w = max(w, 118) + 10
        sheet = Image.new("RGB", (4 * cell_w + 8, len(specs) * (h + 54) + 10), "#203036")
        draw = ImageDraw.Draw(sheet)
        for row, (name, files, labels) in enumerate(specs):
            case = cases[name]
            y = 5 + row * (h + 54)
            title = (
                f"{case['width']} × {case['height']}    ·    {case['map']:g}× map"
                if name != "swap"
                else "Live map upgrade    ·    same viewport and animation time"
            )
            if name == "full-map":
                title = f"Complete crop · HUD hidden · Medium · {case['map']:g}× map"
            draw.text((8, y), title, fill="#e3ebe7", font=font)
            box = tuple(round(v) for v in screen_rect(e, case, 9))
            for col, (f, label) in enumerate(zip(files, labels)):
                x = 8 + col * cell_w
                crop = images[name][f].crop(box).resize((w, h), Image.Resampling.LANCZOS)
                draw.text((x, y + 19), label, fill="#b0c8c2", font=font)
                sheet.paste(crop, (x, y + 39))
        sheet.save(directory / (e["id"] + ".webp"), lossless=not survey, quality=82, method=5)


if __name__ == "__main__":
    main()
