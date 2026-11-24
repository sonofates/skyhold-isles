"""Bake heat shimmer on the Cinderlift yard and tidal ripples along the Wickweavers' Strand."""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageFilter

from gen_sway_mask import rgb_to_hsv_np
from gen_water_mask import build_common_exclusions


ROOT = Path(__file__).resolve().parents[2]


def bake(island, kind):
    layout = json.loads((ROOT / f'src/data/levels2d/{island}.json').read_text())
    recipe = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())[island]
    kit = ROOT / 'design/art-2d/v2/biomes' / recipe['biome']
    size = tuple(layout['imageSize'])
    roads, solid, *_ = build_common_exclusions(island, layout, recipe, *size, kit)
    plate = np.asarray(Image.open(kit / f'terrain-{island}.webp').convert('RGB'), dtype=np.float32)
    baked = np.asarray(Image.open(ROOT / f'public/art2d/{layout["image"]}@1x.webp').convert('RGB'), dtype=np.float32)
    hue, sat, val = rgb_to_hsv_np(plate)
    land = Image.open(kit / recipe['dressingMask']).convert('L')
    if kind == 'water':
        region = ImageChops.invert(land)
        # The coastal vignette darkens the water on the finished map. Use the hue
        # of both paintings here so a brightness difference doesn't erase the tide.
        baked_hue, _, _ = rgb_to_hsv_np(baked)
        surface = (hue >= 147) & (hue <= 205) & (sat > 0.25) & (baked_hue >= 138) & (baked_hue <= 215)
    else:
        region = land
        same_paint = np.abs(plate - baked).sum(axis=2) < 47
        surface = (hue >= 25) & (hue <= 47) & (sat > 0.42) & (val > 0.48) & same_paint

    mask = Image.fromarray((surface * 255).astype(np.uint8))
    for clearance in (region, roads, ImageChops.invert(solid)):
        mask = ImageChops.darker(mask, clearance)
    mask = mask.filter(ImageFilter.MinFilter(9))
    mask = ImageChops.darker(mask, mask.filter(ImageFilter.GaussianBlur(4)))
    mask.resize((size[0] // 2, size[1] // 2), Image.Resampling.BOX).save(
        ROOT / f'public/art2d/life/{island}-{kind}.webp', lossless=True, method=6)


if __name__ == '__main__':
    bake('i26', 'haze')
    bake('i27', 'water')
