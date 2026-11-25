"""Bake the Eclipse Skies surface masks and their decoded test fixtures."""
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
    elif island == 'i39':
        # Two black-leaf crowns to either side of the chapel and the dark moss at their roots.
        crowns = ((x > 170) & (x < 625)) | ((x > 1160) & (x < 1610))
        paint = crowns & (y < 166) & (r < 91) & (g < 87) & (b > g - 6)
    elif island == 'i43':
        # Incandescent metal in the rim channels and on the face of the anvil.
        rim = (x < 285) | (x > 1560) | (y < 157) | (y > 685)
        paint = rim & (r > 159) & (r > g + 47) & (g > b + 17)
    elif island == 'i44':
        # The violet cloud below the library's cutaway vaults.
        paint = (y > 745) & (b > r + 16) & (b > g + 28)
    else:
        # Cloud banks beneath the throne terrace, between the surviving piers.
        paint = (y > 744) & (b > r + 11) & (b > g + 18)
    mask = ImageChops.darker(roads, ImageChops.invert(solids))
    mask = ImageChops.darker(mask, Image.fromarray(np.uint8(paint) * 255))
    mask = ImageChops.darker(mask, mask.filter(ImageFilter.GaussianBlur(2)))
    kind = 'haze' if island == 'i43' else 'sway'
    path = ART / f'life/{island}-{kind}.webp'
    mask.resize((w // 2, h // 2), Image.Resampling.BOX).save(path, lossless=True, method=6)
    write_fixture(island, kind, path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('islands', nargs='+', choices=['i37', 'i38', 'i39', 'i43', 'i44', 'i45'])
    recipes = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())
    for island in parser.parse_args().islands:
        bake(island, recipes[island])
