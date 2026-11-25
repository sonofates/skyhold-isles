"""Bake Frostveil snow and ice masks. Pass island IDs to regenerate a single batch."""
import argparse
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
    # Ice walls between spans, auroral reflections on the court, hanging ice at the plunge pool.
    'i31': [[(940, 0), (1095, 0), (1081, 200), (1090, 431), (1140, 651),
             (1200, 786), (1040, 837), (862, 782), (985, 586), (990, 279)]],
    'i32': [[(1035, 221), (1316, 131), (1351, 184), (1165, 281), (967, 325)],
            [(1198, 532), (1430, 434), (1516, 445), (1448, 514), (1240, 557)]],
    'i33': [[(0, 488), (240, 529), (442, 608), (625, 656), (753, 768),
             (723, 851), (0, 851)]],
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('islands', nargs='*', metavar='ID')
    islands = parser.parse_args().islands or ICE
    campaign = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())
    for island in islands:
        if island not in ICE:
            parser.error(f'unknown Frostveil island {island}')
        bake(island, campaign[island])
