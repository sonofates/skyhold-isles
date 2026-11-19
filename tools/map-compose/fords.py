"""Paint shallow crossings using the river already present in the terrain plate."""
import math
import random

import numpy as np
from PIL import Image, ImageChops, ImageFilter


def prepare(ground, land, layout_size, sites, scale):
    """Keep just the local river paint before the dirt layer covers the water."""
    if not sites:
        return []
    iw, ih = layout_size
    result = []
    water = ImageChops.invert(land)
    for cx, cy, radius in sites:
        rect = (cx - radius, cy - radius, cx + radius, cy + radius)
        box = tuple(round(v * scale) for v in rect)
        left, top, right, bottom = rect
        rect_mask = (left * land.width / iw, top * land.height / ih,
                     right * land.width / iw, bottom * land.height / ih)
        river = ground.crop(box)
        wet = water.transform((2 * radius, 2 * radius), Image.Transform.EXTENT,
                              rect_mask, Image.Resampling.BILINEAR)
        wet = wet.filter(ImageFilter.GaussianBlur(1.75))
        result.append((rect, box, river, wet))
    return result


def paint(ground, prepared, roads, road_width, stones, paths, scale, seed):
    """Carry the stream through the track and expose small river stones on its bed."""
    # The material sheet contains one isolated river stone per square frame.
    frame = stones.height
    pieces = []
    for start in range(0, stones.width, frame):
        piece = stones.crop((start, 0, start + frame, frame))
        pieces.append(piece.crop(piece.getbbox()))
    for index, (rect, box, river, wet) in enumerate(prepared):
        left, top, right, _ = rect
        radius = (right - left) / 2
        cx, cy = left + radius, top + radius
        yy, xx = np.ogrid[:river.height, :river.width]
        edge = np.hypot((xx + box[0]) / scale - cx, (yy + box[1]) / scale - cy)
        fade = np.clip((radius - edge) / (road_width * .38), 0, 1)
        # The uninterrupted banks remain in the terrain. Over the submerged
        # track, leave a little of the lighter road material visible below.
        road = np.asarray(roads.crop(box)) / 255
        shore = wet.resize(river.size, Image.Resampling.BILINEAR)
        opacity = np.uint8(np.asarray(shore) * fade * (1 - .34 * road))
        ground.paste(river, box, Image.fromarray(opacity))

        rnd = random.Random(seed + index)
        painted = []
        for path in paths:
            for i in range(1, len(path) - 1):
                x, y = path[i]
                if math.hypot(x - cx, y - cy) > radius - 12:
                    continue
                ax, ay = path[i - 1]
                bx, by = path[i + 1]
                length = math.hypot(bx - ax, by - ay) or 1
                off = rnd.uniform(-.28, .28) * road_width
                x -= (by - ay) / length * off
                y += (bx - ax) / length * off
                u, v = round(x - left), round(y - top)
                if not (0 <= u < wet.width and 0 <= v < wet.height):
                    continue
                if wet.getpixel((u, v)) < 175 or any(math.dist((x, y), p) < 14 for p in painted):
                    continue
                stone = rnd.choice(pieces)
                width = rnd.uniform(7, 16) * scale
                im = stone.resize((max(1, round(width)), max(1, round(width * stone.height / stone.width))),
                                  Image.Resampling.LANCZOS)
                if rnd.getrandbits(1):
                    im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                ground.alpha_composite(im, (round(x * scale - im.width / 2), round(y * scale - im.height / 2)))
                painted.append((x, y))
