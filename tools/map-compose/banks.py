"""Fit painted shelves to shore plots in layout coordinates, at any bake size."""
import math

import numpy as np
from PIL import Image, ImageChops, ImageFilter


def shore_foundation(ground, land, layout_size, islet, centre, radii, scale):
    x, y = centre
    rx, ry = radii
    iw, ih = layout_size
    # Include the narrow contact shadow outside the plot ring. Inspect the
    # interior too: a stream can pass under a ring with dry land on both sides.
    mx, my = land.width / iw, land.height / ih
    left, top = math.floor((x-rx-4)*mx), math.floor((y-ry-4)*my)
    right, bottom = math.ceil((x+rx+4)*mx), math.ceil((y+ry+4)*my)
    yy, xx = np.ogrid[top:bottom, left:right]
    ellipse = ((((xx+.5)/mx-x)/(rx+4))**2 + (((yy+.5)/my-y)/(ry+4))**2) <= 1
    if not np.any((np.asarray(land.crop((left, top, right, bottom))) < 128) & ellipse):
        return False

    width, height = 2.76*rx, 3.12*ry
    left, top = x-width/2, y-height*.43
    # Work at layout resolution so the blend has the same shape in every
    # texture. Keep the naturally painted bank on the uphill side.
    margin = 16
    box = (math.floor(left)-margin, math.floor(top)-margin,
           math.ceil(left+width)+margin, math.ceil(top+height)+margin)
    mask_rect = (box[0]*mx, box[1]*my, box[2]*mx, box[3]*my)
    bank = land.transform((box[2]-box[0], box[3]-box[1]), Image.Transform.EXTENT,
                          mask_rect, Image.Resampling.BILINEAR)
    water = ImageChops.invert(bank).filter(ImageFilter.MaxFilter(17)).filter(ImageFilter.GaussianBlur(3))
    box_px = tuple(round(v*scale) for v in (left, top, left+width, top+height))
    dims = box_px[2]-box_px[0], box_px[3]-box_px[1]
    shelf = islet.resize(dims, Image.Resampling.LANCZOS)
    if (int(x) + int(y)) % 2:
        shelf = shelf.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    extent = (left-box[0], top-box[1], left+width-box[0], top+height-box[1])
    wet = water.transform(dims, Image.Transform.EXTENT, extent, Image.Resampling.BILINEAR)
    shelf.putalpha(ImageChops.multiply(shelf.getchannel('A'), wet))
    ground.alpha_composite(shelf, box_px[:2])
    return True
