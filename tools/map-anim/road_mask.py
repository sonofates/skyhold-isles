"""Protect stationary road and bridge paint in the packed video mask."""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/map-compose'))
from ground import ROAD_WIDTH_FRACTION, catmull, road_footprint
from masonry import RoadArcade


def animation_clearance(island):
    layout = json.loads((ROOT / f'src/data/levels2d/{island}.json').read_text())
    recipes = json.loads((ROOT / 'tools/map-compose/campaign.json').read_text())
    recipe = recipes.get(island, {})
    size = tuple(layout['imageSize'])
    width = size[1] * ROAD_WIDTH_FRACTION
    paths = [list(map(tuple, path)) for path in layout['paths']]
    splines = [catmull(path) for path in paths]
    protected = road_footprint(size, paths + splines, width).convert('L')
    draw = ImageDraw.Draw(protected)
    for _, x, y, length, breadth, angle in recipe.get('crossings', []):
        sin, cos = math.sin(math.radians(angle)), math.cos(math.radians(angle))
        draw.polygon([(x + u*breadth*cos + v*length*sin, y - u*breadth*sin + v*length*cos)
                      for u, v in [(-.5, -.5), (.5, -.5), (.5, .5), (-.5, .5)]], fill=255)
    for _, (x0, y0), (x1, y1), above, below, _ in recipe.get('archBridges', []):
        draw.polygon([(x0, y0-above), (x1, y1-above), (x1, y1+below), (x0, y0+below)], fill=255)
    for lane, start, end, height in recipe.get('arcades', []):
        wall = RoadArcade(splines[lane], start, end, width, height)
        draw.polygon(wall.footprint(), fill=255)

    # Include the ragged road rim and a texel for bilinear video-mask sampling.
    # Keep the inner edge hard black and put the feather entirely on the terrain side.
    clear = ImageChops.invert(protected.filter(ImageFilter.MaxFilter(11)))
    feather = clear.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.GaussianBlur(2))
    return ImageChops.darker(clear, feather)


def clip_atlas(matte, clearance, elements, master_size):
    """Project each world rect into its UV cell, including half texels on the compact tier."""
    sx, sy = matte.width / master_size[0], matte.height / master_size[1]
    for element in elements:
        x, y, w, h = element['rect']
        cx, cy, cw, ch = element['cell']
        left, top = math.floor(cx*sx), math.floor(cy*sy)
        right, bottom = math.ceil((cx+cw)*sx), math.ceil((cy+ch)*sy)
        dx, dy = w/(cw*sx), h/(ch*sy)
        bounds = (left, top, right, bottom)
        area = matte.crop(bounds)
        clip = clearance.transform(area.size, Image.Transform.AFFINE,
                                   (dx, 0, x+(left-cx*sx)*dx, 0, dy, y+(top-cy*sy)*dy),
                                   Image.Resampling.BILINEAR)
        matte.paste(ImageChops.darker(area, clip), bounds)
    return matte
