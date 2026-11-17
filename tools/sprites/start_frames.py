#!/usr/bin/python3
"""Keyed sprites → 1280x720 flat-magenta start frames for Flow (Omni/Veo image-to-video).

usage: /usr/bin/python3 tools/sprites/start_frames.py <out_dir> <sprite.png>[:height] ...
Each sprite is scaled to `height` px (default 560; use smaller for wide subjects like balloons),
centred slightly low, and saved as <out_dir>/<name>-start.jpg (q92).
"""
import sys
from pathlib import Path
from PIL import Image

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
for arg in sys.argv[2:]:
    path, _, h = arg.partition(':')
    h = int(h or 560)
    im = Image.open(path).convert('RGBA')
    s = h / im.height
    if im.width * s > 1100:  # keep wide subjects inside the frame
        s = 1100 / im.width
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    bg = Image.new('RGB', (1280, 720), (255, 0, 255))
    bg.paste(im, ((1280 - im.width) // 2, (720 - im.height) // 2 + 20), im)
    name = Path(path).stem
    bg.save(out / f'{name}-start.jpg', quality=92)
    print(out / f'{name}-start.jpg', im.size)
