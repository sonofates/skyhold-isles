"""Bake windblown snow and ice glints for the first three Frostveil islands."""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

from gen_water_mask import build_common_exclusions, write_fixture

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / 'design/art-2d/v2/biomes/frostveil'
ART = ROOT / 'public/art2d'

# Reflected ice beneath the schooner, around the fishing hole and below the trestle.
ICE = {
    'i28': [[(1284, 147), (1441, 179), (1728, 238), (1680, 285), (1420, 229)],
            [(521, 798), (964, 748), (1225, 785), (1005, 850), (470, 850)]],
    'i29': [[(741, 800), (1187, 712), (1436, 674), (1610, 590), (1730, 603),
             (1760, 713), (1398, 830), (781, 850)]],
    'i30': [[(42, 770), (261, 783), (492, 810), (740, 850), (369, 851), (114, 820)],
            [(878, 111), (1090, 90), (1251, 124), (1104, 156), (852, 149)]],
}


def bake(island, recipe):
    layout = json.loads((ROOT / f'src/data/levels2d/{island}.json').read_text())
    size = tuple(layout['imageSize'])
    roads, solid, *_ = build_common_exclusions(island, layout, recipe, *size, KIT)
    clear = ImageChops.darker(roads, ImageChops.invert(solid))
    plate = Image.open(KIT / f'terrain-{island}.webp').convert('RGB')
    baked = Image.open(ART / f'{layout["image"]}@1x.webp').convert('RGB')
    blur = ImageFilter.GaussianBlur(2)
    difference = ImageChops.difference(plate.filter(blur), baked.filter(blur))
    # Reject the extra scenery and silhouettes which the compositor placed over the plate.
    clear = ImageChops.darker(clear, Image.fromarray(np.uint8(np.asarray(difference).max(axis=2) < 39) * 255))
    r, g, b = np.asarray(plate, dtype=np.int16).transpose(2, 0, 1)
    land = Image.open(KIT / recipe['dressingMask']).convert('L')
    ice = Image.new('L', size)
    for region in ICE[island]:
        ImageDraw.Draw(ice).polygon(region, fill=255)
    for name, region, painted in [
        ('ice', ice, (b > r + 5) & (b > 90)),
        ('snow', ImageChops.subtract(land, ice), (b > 150) & (g > 135) & (b >= r - 12)),
    ]:
        mask = ImageChops.darker(clear, ImageChops.darker(region, Image.fromarray(painted.astype('uint8') * 255)))
        mask = mask.filter(ImageFilter.MinFilter(5))
        mask = ImageChops.darker(mask, mask.filter(ImageFilter.GaussianBlur(3)))
        path = ART / f'life/{island}-{name}.webp'
        mask.resize((size[0] // 2, size[1] // 2), Image.Resampling.BOX).save(path, lossless=True, method=6)
        write_fixture(island, name, path)


if __name__ == '__main__':
    campaign = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())
    for island in ICE:
        bake(island, campaign[island])
