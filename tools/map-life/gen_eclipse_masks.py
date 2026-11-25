"""Bake the Eclipse Skies wind masks and their decoded test fixtures."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageFilter

from gen_water_mask import build_common_exclusions, write_fixture

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / 'design/art-2d/v2/biomes/eclipse'
ART = ROOT / 'public/art2d'


def bake(island, recipe):
    layout = json.loads((ROOT / f'src/data/levels2d/{island}.json').read_text())
    w, h = layout['imageSize']
    roads, solids, *_ = build_common_exclusions(island, layout, recipe, w, h, KIT)
    r, g, b = np.asarray(Image.open(KIT / f'terrain-{island}.webp').convert('RGB'), dtype=np.int16).transpose(2, 0, 1)
    y, x = np.ogrid[:h, :w]
    if island == 'i37':
        # Reflected violet cloud light below the chain quay, between the pilings.
        paint = (y > 728) & (b > r + 8) & (b > g + 22) & (r > 55)
    elif island == 'i38':
        # Only the fog down in the two fissures, including the gaps beneath the spans.
        rifts = ((x > 400) & (x < 680)) | ((x > 1120) & (x < 1390))
        paint = rifts & (b > r + 13) & (b > g + 28) & (r > 45)
    elif island == 'i39':
        # Two black-leaf crowns to either side of the chapel and the dark moss at their roots.
        crowns = ((x > 170) & (x < 625)) | ((x > 1160) & (x < 1610))
        paint = crowns & (y < 166) & (r < 91) & (g < 87) & (b > g - 6)
    elif island == 'i40':
        # Heat escaping through the orange seams around the embedded meteor.
        paint = (x > 520) & (x < 1180) & (y < 245) & (r > 92) & (r > g + 31) & (g > b + 15)
    elif island == 'i41':
        # Violet cloud banks below the ruined west and east parapets.
        paint = ((x < 390) | (x > 1480)) & (y > 615) & (b > r + 15) & (b > g + 22) & (r > 65)
    else:
        # The heated bed of the chain trough between the two lower counterweight houses.
        paint = (x > 625) & (x < 1230) & (y > 645) & (y < 760) & (r > 91) & (r > g + 34) & (g > b + 12)
    mask = ImageChops.darker(roads, ImageChops.invert(solids))
    mask = ImageChops.darker(mask, Image.fromarray(np.uint8(paint) * 255))
    mask = ImageChops.darker(mask, mask.filter(ImageFilter.GaussianBlur(2)))
    stem = 'haze' if island in ('i40', 'i42') else 'sway'
    path = ART / f'life/{island}-{stem}.webp'
    mask.resize((w // 2, h // 2), Image.Resampling.BOX).save(path, lossless=True, method=6)
    write_fixture(island, stem, path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('islands', nargs='+', choices=['i37', 'i38', 'i39', 'i40', 'i41', 'i42'])
    recipes = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())
    for island in parser.parse_args().islands:
        bake(island, recipes[island])
