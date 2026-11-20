"""Pack Omni start/mask/place/loop folders into a H.264 texture and lossless mask atlas.

Run from the repository root with numpy, opencv-python-headless and ffmpeg.
"""

import argparse
import json
import math
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory

import cv2
import numpy as np

FPS = 24
GUTTER = 4


def register(reference, gray, anchors):
    """Robust similarity transform from static landmarks (at half start resolution)."""
    points, valid, _ = cv2.calcOpticalFlowPyrLK(reference, gray, anchors, None)
    ok = valid.ravel().astype(bool)
    if ok.sum() < 8:
        raise ValueError("Too few static landmarks")
    matrix, inliers = cv2.estimateAffinePartial2D(
        anchors[ok], points[ok], method=cv2.RANSAC, ransacReprojThreshold=0.9
    )
    if matrix is None or inliers.sum() < 8:
        raise ValueError("Registration failed")
    return matrix


def extract(folder, scratch, frames, style):
    depth = style.get("depth", 0)
    scale = style.get("scale", 2)
    opacity = style.get("opacity", 1)
    feather = style.get("feather", 2)
    place = json.loads((folder / "place.json").read_text())
    l, t, r, b = place["maskBBoxStartPxLTRB"]
    s = place["startPxPerLayoutPx"]
    origin = place["cropLayoutPx"]
    rect = [origin["x"] + l / s, origin["y"] + t / s, (r - l) / s, (b - t) / s]
    w, h = [math.ceil(v * scale) for v in rect[2:]]
    start = cv2.imread(str(folder / "start.png"))
    mask = cv2.imread(str(folder / "mask.png"), cv2.IMREAD_GRAYSCALE)
    # Additional inward taper lets a broad generated wake or plume dissipate at the boundary.
    distance = cv2.distanceTransform((mask > 0).astype(np.uint8), cv2.DIST_L2, 5)
    alpha = np.minimum(mask / 255, np.clip(distance / (s * feather), 0, 1))
    alpha = cv2.resize(alpha[t:b, l:r], (w, h), interpolation=cv2.INTER_AREA).astype(np.float32)
    small = cv2.pyrDown(start)
    ref = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    outside = cv2.resize(mask, ref.shape[::-1]) == 0
    anchors = cv2.goodFeaturesToTrack(ref, 320, 0.008, 7, mask=outside.astype("uint8"))
    rgb = np.lib.format.open_memmap(scratch / (folder.name + ".npy"), "w+", np.uint8, (frames, h, w, 3))
    stats = []
    cap = cv2.VideoCapture(str(folder / "loop.mp4"))
    for i in range(frames):
        success, frame = cap.read()
        if not success:
            raise ValueError(f"{folder}: missing frame {i}")
        reduced = cv2.pyrDown(frame)
        m = register(ref, cv2.cvtColor(reduced, cv2.COLOR_BGR2GRAY), anchors)
        aligned = cv2.warpAffine(
            reduced,
            m,
            ref.shape[::-1],
            flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
            borderMode=cv2.BORDER_REPLICATE,
        )
        diff = (small[::4, ::4].astype(np.int16) - aligned[::4, ::4])[outside[::4, ::4]]
        shift = np.median(diff, axis=0)
        m[:, 2] *= 2
        # Transform the bounding box, then area-downsample its contents to shipping resolution.
        m[:, 2] += m[:, :2] @ [l, t]
        crop = cv2.warpAffine(
            frame,
            m,
            (r - l, b - t),
            flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
            borderMode=cv2.BORDER_REPLICATE,
        )
        tile = cv2.resize(crop, (w, h), interpolation=cv2.INTER_AREA)
        rgb[i] = np.clip(tile.astype(np.int16) + shift, 0, 255)
        stats.append([m[0, 2] - l, m[1, 2] - t, *shift])
    cap.release()
    opening = cv2.resize(start[t:b, l:r], (w, h), interpolation=cv2.INTER_AREA)

    def step(a, b):
        return (np.abs(a.astype(np.float32) - b) * alpha[:, :, None]).sum() / (3 * alpha.sum())

    steps = np.array([step(rgb[i], rgb[i - 1]) for i in range(1, frames)])
    wrap = step(rgb[-1], rgb[0])
    # Also repair a bad penultimate→endpoint jump hidden by a duplicated start frame.
    fade = max(wrap, steps[-3:].max()) > max(0.8, 1.5 * np.percentile(steps, 95))
    if fade:
        for i in range(frames - FPS // 2, frames):
            weight = (i - (frames - FPS // 2) + 1) / (FPS // 2 + 1)
            rgb[i] = np.round(rgb[i] * (1 - weight) + rgb[0] * weight)
    first = rgb[0].astype(np.float32)
    bias = opening - first
    for i in range(frames):
        rgb[i] = np.clip(rgb[i] + bias, 0, 255)
    cv2.imwrite(str(scratch / (folder.name + ".png")), np.rint(255 * opacity * alpha).astype(np.uint8))
    print(
        f"{folder.name:22} drift XY / color BGR max {np.max(np.abs(stats), axis=0).round(2)}; "
        f"raw wrap {wrap:.2f}, p95 step {np.percentile(steps, 95):.2f}, fade {fade}",
        flush=True,
    )
    return dict(id=folder.name, rect=[round(v, 5) for v in rect], depth=depth, size=[w, h])


def pack(tiles):
    # Shelf packing. Align rows and atlas sides for 4:2:0 and the video decoder.
    widest = max(tile["size"][0] + 2 * GUTTER for tile in tiles)
    width = max(832, math.ceil(widest / 16) * 16)
    x = y = row_height = 0
    for tile in sorted(tiles, key=lambda e: -e["size"][1]):
        w, h = tile.pop("size")
        cw, ch = ((v + 2 * GUTTER + 3) // 4 * 4 for v in (w, h))
        if x + cw > width:
            x, y, row_height = 0, y + row_height, 0
        tile["cell"] = [x + GUTTER, y + GUTTER, w, h]
        x += cw
        row_height = max(row_height, ch)
    return width, math.ceil((y + row_height) / 16) * 16


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("island")
    args = parser.parse_args()
    name = args.island
    src = Path("design/art-2d/anim") / name
    dst = Path("public/art2d/ambient") / name
    dst.mkdir(parents=True, exist_ok=True)
    styles = json.loads((src / "pack.json").read_text()) if (src / "pack.json").exists() else {}
    cv2.setNumThreads(1)
    frames = 8 * FPS
    with TemporaryDirectory() as temp:
        scratch = Path(temp)
        tiles = [
            extract(p.parent, scratch, frames, styles.get(p.parent.name, {}))
            for p in sorted(src.glob("*/loop.mp4"))
        ]
        width, height = pack(tiles)
        packed = np.zeros((height, width, 3), np.uint8)
        mask = np.zeros((height, width), np.uint8)
        sources = [
            (
                t["cell"],
                np.load(scratch / (t["id"] + ".npy"), mmap_mode="r"),
                cv2.imread(str(scratch / (t["id"] + ".png")), cv2.IMREAD_GRAYSCALE),
            )
            for t in tiles
        ]
        for (x, y, w, h), _, ref in sources:
            mask[y : y + h, x : x + w] = ref
        filename = "loops.mp4"
        # Explicit BT.709 conversion AND matching bitstream tags for browser video-to-RGB.
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pixel_format",
            "bgr24",
            "-video_size",
            f"{width}x{height}",
            "-framerate",
            str(FPS),
            "-i",
            "-",
            "-vf",
            "scale=out_color_matrix=bt709",
            "-c:v",
            "libx264",
            "-preset",
            "slow",
            "-threads",
            "4",
            "-crf",
            "16",
            "-pix_fmt",
            "yuv420p",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-g",
            str(FPS),
            "-movflags",
            "+faststart",
            str(dst / filename),
        ]
        with subprocess.Popen(cmd, stdin=subprocess.PIPE) as proc:
            for i in range(frames):
                for (x, y, w, h), rgb, _ in sources:
                    # Replicate the outside texels into the codec/filter gutter.
                    pad = GUTTER
                    packed[y - pad : y + h + pad, x - pad : x + w + pad] = cv2.copyMakeBorder(
                        rgb[i], pad, pad, pad, pad, cv2.BORDER_REPLICATE
                    )
                proc.stdin.write(packed.tobytes())
            proc.stdin.close()
            if proc.wait():
                raise RuntimeError("ffmpeg encoding failed")
        # 1x map clients need a quarter of the video texels. The same normalized UVs
        # address both streams. Pick even frames so seeks coincide with the 24 Hz master.
        compact = "loops-1x.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(dst / filename),
                "-vf",
                "select=not(mod(n\\,2)),scale=iw/2:ih/2:flags=lanczos",
                "-r",
                str(FPS // 2),
                "-c:v",
                "libx264",
                "-threads",
                "4",
                "-preset",
                "slow",
                "-crf",
                "16",
                "-g",
                str(FPS // 2),
                "-movflags",
                "+faststart",
                str(dst / compact),
            ],
            check=True,
        )
        for image, w, h in [
            ("mask.webp", width, height),
            ("mask-1x.webp", width // 2, height // 2),
        ]:
            matte = cv2.resize(mask, (w, h), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(dst / image), matte, [cv2.IMWRITE_WEBP_QUALITY, 101])
        data = dict(
            file=f"ambient/{name}/{filename}",
            mask=f"ambient/{name}/mask.webp",
            compact=dict(
                file=f"ambient/{name}/{compact}",
                mask=f"ambient/{name}/mask-1x.webp",
                width=width // 2,
                height=height // 2,
                fps=FPS // 2,
            ),
            width=width,
            height=height,
            fps=FPS,
            elements=sorted(tiles, key=lambda t: t["depth"]),
        )
        target = Path("src/data/mapAnim") / (name + ".json")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, indent=2) + "\n")


if __name__ == "__main__":
    main()
