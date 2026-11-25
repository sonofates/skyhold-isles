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
        # Cloud visible behind the moored skiff, through the crane, and below the deck.
        skiff = (x < 302) & (y > 110) & (y < 680)
        crane = (x > 702) & (x < 1000) & (y < 147)
        under_deck = (y > 737) & ((x < 1370) | (y > 821))
        cloud = (r > g + 19) & (b > r + 19) & (b > g + 49)
        paint = (skiff | crane | under_deck) & cloud
    elif island == 'i38':
        # Only the fog down in the two fissures, including the gaps beneath the spans.
        rifts = ((x > 400) & (x < 680)) | ((x > 1120) & (x < 1390))
        paint = rifts & (b > r + 13) & (b > g + 28) & (r > 45)
    else:
        # Two black-leaf crowns to either side of the chapel and the dark moss at their roots.
        crowns = ((x > 170) & (x < 625)) | ((x > 1160) & (x < 1610))
        paint = crowns & (y < 166) & (r < 91) & (g < 87) & (b > g - 6)
    mask = ImageChops.darker(roads, ImageChops.invert(solids))
    mask = ImageChops.darker(mask, Image.fromarray(np.uint8(paint) * 255))
    mask = ImageChops.darker(mask, mask.filter(ImageFilter.GaussianBlur(2)))
    path = ART / f'life/{island}-sway.webp'
    mask.resize((w // 2, h // 2), Image.Resampling.BOX).save(path, lossless=True, method=6)
    write_fixture(island, 'sway', path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('islands', nargs='+', choices=['i37', 'i38', 'i39'])
    recipes = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())
    for island in parser.parse_args().islands:
        bake(island, recipes[island])
