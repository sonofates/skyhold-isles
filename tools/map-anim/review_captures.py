"""Build annotated close-ups from the lossless Playwright frames. Requires Pillow and numpy."""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


def screen_rect(element, case, pad=0):
    x, y, w, h = element["rect"]
    fit = case["fit"]
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
        mask.paste(cell, (round(l), round(t)))
    return np.asarray(mask.filter(ImageFilter.MaxFilter(5))) > 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    meta = json.loads((args.out / "measurements.json").read_text())
    cases = {c["name"]: c for c in meta["cases"]}
    data = json.loads(Path("src/data/mapAnim/i02.json").read_text())
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
    images = {
        name: {f: Image.open(args.work / f"{name}-{f}.png").convert("RGB") for f in files}
        for name, files, _ in specs
    }
    for name in ("desktop", "phone"):
        first = Image.open(args.work / f"{name}-0.png").convert("RGB")
        last = images[name]["last"]
        active = images[name]["4"]
        atlas = Image.open(Path("public/art2d") / data["mask"]).convert("L")
        allowed = coverage(atlas, data["elements"], cases[name], first.size)
        start = np.asarray(first, dtype=np.int16)
        wrap = np.max(np.abs(start - np.asarray(last)), axis=2)
        motion = np.max(np.abs(start - np.asarray(active)), axis=2)
        for e in data["elements"]:
            l, t, r, b = map(round, screen_rect(e, cases[name], 5))
            crop = np.s_[max(0, t) : b, max(0, l) : r]
            leak = motion[crop][~allowed[crop]]
            print(
                name,
                e["id"],
                "wrap max",
                wrap[crop].max(),
                "outside max",
                leak.max(),
                "moving pixels",
                np.sum(motion[crop] > 3),
            )
            assert wrap[crop].max() == 0
            assert leak.max() <= 3
            assert np.any(motion[crop] > 3)
    font = ImageFont.truetype("DejaVuSans.ttf", 13)
    for e in data["elements"]:
        width, height = e["rect"][2:]
        scale = min(3.5, max(1.75, 140 / (width + 18)))
        w, h = round((width + 18) * scale), round((height + 18) * scale)
        cell_w = max(w, 118) + 10
        sheet = Image.new("RGB", (4 * cell_w + 8, 3 * (h + 54) + 10), "#203036")
        draw = ImageDraw.Draw(sheet)
        for row, (name, files, labels) in enumerate(specs):
            case = cases[name]
            y = 5 + row * (h + 54)
            title = (
                f"{case['width']} × {case['height']}    ·    {case['map']:g}× map"
                if name != "swap"
                else "Live map upgrade    ·    same viewport and animation time"
            )
            draw.text((8, y), title, fill="#e3ebe7", font=font)
            box = tuple(round(v) for v in screen_rect(e, case, 9))
            for col, (f, label) in enumerate(zip(files, labels)):
                x = 8 + col * cell_w
                crop = images[name][f].crop(box).resize((w, h), Image.Resampling.LANCZOS)
                draw.text((x, y + 19), label, fill="#b0c8c2", font=font)
                sheet.paste(crop, (x, y + 39))
        sheet.save(directory / (e["id"] + ".webp"), lossless=True, method=5)


if __name__ == "__main__":
    main()
