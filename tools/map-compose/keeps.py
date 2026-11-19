"""Fit one painted gatehouse to a fixed road endpoint and lay its threshold into the road."""
import math

import numpy as np
from PIL import Image, ImageDraw

from gates import facing_from_dir


# Fractional positions on the keyed turnarounds. The sill is at ground level.
# The outer paving is a material swatch. Only the threshold inside the jambs
# stays in the painting; the compositor lays the wider apron on island terrain.
VIEWS = {
    'W': ((-1, 0), (0.235, 0.572), (0.015, 0.506, 0.145, 0.636)),
    'S': ((0, 1), (0.5, 0.814), (0.399, 0.876, 0.603, 0.99)),
    'N': ((0, -1), (0.5, 0.307), (0.39, 0.012, 0.61, 0.15)),
    'sw': ((-0.728, 0.686), (0.334, 0.765), None),
    'nw': ((-0.821, -0.571), (0.27, 0.488), None),
    'compact': ((-1, 0), (0.173, 0.933), None),
}


def source_coordinates(source, xx, yy, anchor, c, s, flip):
    """Inverse map the rotated silhouette back into the registered painting."""
    ax, ay = anchor
    h, w = xx.shape
    if source == 'compact':
        # This elevation has a very shallow ground footprint. Its painted porch
        # turns with the road, while the back stone courses stay over the footing.
        # Taper the floor displacement to zero at the eaves to keep the roof level.
        sign = 1 if flip else -1

        def floor_offset(delta):
            return s * sign * np.clip(sign * delta, -w * 0.10, w * 0.43)

        dx, dy = xx - ax, yy - ay
        weight = np.clip((yy / h - 0.48) / 0.34, 0, 1)
        projected_y = dy + weight * floor_offset(dx)
        left, top = math.floor((dx * c).min()) - 1, math.floor(projected_y.min()) - 1
        width = math.ceil((dx * c).max()) - left + 2
        high = math.ceil(projected_y.max()) - top + 2
        y, x = np.indices((high, width), dtype=np.float32)
        ix = ax + (x + left) / c
        iy = ay + y + top
        for _ in range(6):
            weight = np.clip((iy / h - 0.48) / 0.34, 0, 1)
            iy = ay + y + top - weight * floor_offset(ix - ax)
        return ix, iy, left, top

    def elevation(x, y):
        # Interpolate the depth breaks at front turret cap, masonry and near eaves.
        if source != 'W':
            return np.clip((h * 0.86 - y) * 0.29, 0, h * 0.17)
        side = (w - 1 - x if flip else x) / w
        turret = np.interp(y / h, (0, 0.17, 0.47, 0.57, 0.71, 1), (0.24, 0.17, 0, 0.23, 0.16, 0))
        roof = np.interp(y / h, (0, 0.16, 0.34, 0.66, 0.90, 1), (0.19, 0.18, 0.29, 0.19, 0, 0))
        t = np.clip((side - 0.35) / 0.13, 0, 1)
        # The open throat, including its floor, stays on the ground plane.
        portal = np.clip((abs(y / h - 0.572) - 0.043) / 0.055, 0, 1)
        portal = np.maximum(portal, np.clip((side - 0.33) / 0.07, 0, 1))
        return h * (turret * (1 - t) + roof * t) * portal

    # Give the passage extra room across its opening, preserving adjacent stone
    # courses. The floor axis and both ends of the arch remain registered.
    x_knots = np.array([0, 0.16, 0.37, 1]) * w
    y_knots = np.array([0, 0.41, 0.64, 1]) * h
    if flip:
        x_knots = w - x_knots[::-1]
    x_draw = x_knots + np.array([0, 0, 0.075, 0.075]) * w
    y_draw = y_knots + np.array([0, 0, 0.095, 0.095]) * h
    if source != 'W':
        x_draw, y_draw = x_knots, y_knots

    def project(x, y):
        lift = elevation(x, y)
        dx = np.interp(x, x_knots, x_draw) - np.interp(ax, x_knots, x_draw)
        dy = np.interp(y, y_knots, y_draw) - np.interp(ay, y_knots, y_draw)
        return c * dx - s * (dy + lift), s * dx + c * (dy + lift) - lift

    gx, gy = project(xx, yy)
    left, top = math.floor(gx.min()) - 1, math.floor(gy.min()) - 1
    width, high = math.ceil(gx.max()) - left + 2, math.ceil(gy.max()) - top + 2
    y, x = np.indices((high, width), dtype=np.float32)
    x, y = x + left, y + top
    x0 = np.interp(ax, x_knots, x_draw) + c * x + s * y
    y0 = np.interp(ay, y_knots, y_draw) - s * x + c * y

    # Extrapolate outside the source so the transparent border stays clear.
    def unwarp(value, dest, src):
        if dest is src:
            # Only the lateral elevation widens the portal. The other views
            # already use source coordinates across the full transparent apron.
            return np.asarray(value, dtype=np.float64)
        return np.interp(value, dest, src) + np.minimum(value - dest[0], 0) + np.maximum(value - dest[-1], 0)

    ix, iy = unwarp(x0, x_draw, x_knots), unwarp(y0, y_draw, y_knots)
    for _ in range(6):
        lift = elevation(ix, iy)
        ix = unwarp(x0 + s * lift, x_draw, x_knots)
        iy = unwarp(y0 + (c - 1) * lift, y_draw, y_knots)
    return ix, iy, left, top


# Sample premultiplied colour and the occlusion mask with the same transform.
def sample(data, ix, iy):
    h, w = data.shape[:2]
    # A transparent border supplies out-of-painting samples. Work in strips so
    # the four interpolation arrays fit in cache on the largest keep paintings.
    padded = np.pad(data, ((1, 1), (1, 1), (0, 0)))
    result = np.empty((*ix.shape, data.shape[2]), dtype=np.uint8)
    for first in range(0, ix.shape[0], 64):
        rows = slice(first, first+64)
        x, y = ix[rows], iy[rows]
        xa, ya = np.floor(x).astype(int), np.floor(y).astype(int)
        u, v = x-xa, y-ya
        left, right = (xa+1).clip(0, w+1), (xa+2).clip(0, w+1)
        top, bottom = (ya+1).clip(0, h+1), (ya+2).clip(0, h+1)
        block = np.zeros((*x.shape, data.shape[2]), dtype=np.float32)
        for py, px, weight in ((top, left, (1-u)*(1-v)), (top, right, u*(1-v)),
                               (bottom, left, (1-u)*v), (bottom, right, u*v)):
            block += padded[py, px] * weight[..., None]
        result[rows] = block.clip(0, 255).round()
    return result


class Keep:
    def __init__(self, directory, biome, point, along, road, height, view=None):
        self.theme = biome or 'orchard'
        self.point, self.along, self.road = point, along, road
        facing = facing_from_dir(*along)
        # Use the painted yaw nearest the road. All eight compass directions have
        # an elevation, with the east-side views mirrored from their western pair.
        bearing = math.degrees(math.atan2(along[1], abs(along[0])))
        if view == 'compact' and facing in ('E', 'W'):
            source = view
        elif 22.5 <= abs(bearing) < 67.5:
            source = 'sw' if bearing > 0 else 'nw'
        else:
            source = 'W' if facing == 'E' else facing
        flip = along[0] > 0 and source not in ('S', 'N')
        direction, sill, swatch = VIEWS[source]
        im = Image.open(directory / f'{self.theme}-{source.lower()}.webp').convert('RGBA')
        w, h = im.size

        pixels = np.array(im)
        yy, xx = np.indices((h, w), dtype=np.float32)
        ax, ay = sill[0] * w, sill[1] * h
        ux, uy = direction
        outside = (xx - ax) * ux + (yy - ay) * uy
        across = -(xx - ax) * uy + (yy - ay) * ux
        # Cut the rectangular outer tab only within the painted paving band.
        if source == 'nw':
            floor = (xx < w * 0.243) & (yy > h * 0.31) & (yy < h * 0.56)
            opening = (xx > w * 0.247) & (xx < w * 0.405) & (yy > h * 0.387) & (yy < h * 0.564)
        elif source == 'sw':
            floor = (xx < w * 0.44) & (yy > h * 0.766)
            opening = (xx > w * 0.25) & (xx < w * 0.44) & (yy > h * 0.60) & (yy < h * 0.82)
        elif source == 'compact':
            floor = (yy > h * 0.883) & (xx < w * 0.26)
            opening = (yy > h * 0.648) & (xx < w * 0.272)
        elif source == 'W':
            floor = (yy > h * 0.475) & (yy < h * 0.668)
            floor &= (xx < w * 0.169) | ((yy > h * 0.519) & (yy < h * 0.609))
            opening = (yy > h * 0.429) & (yy < h * 0.637) & (xx < w * 0.365)
        elif source == 'S':
            floor = (abs(xx - ax) < w * 0.126) & (yy > h * 0.767)
            opening = (abs(across) < w * 0.116) & (yy > h * 0.685)
        else:
            floor = (abs(xx - ax) < w * 0.132) & (yy < h * 0.184)
            opening = (abs(across) < w * 0.118) & (yy > h * 0.238) & (yy < h * 0.39)
        fade = np.clip((w * 0.085 - outside) / (w * 0.065), 0, 1)
        pixels[..., 3] = np.where(floor, pixels[..., 3] * fade, pixels[..., 3])
        depth = np.clip((-outside + w * 0.009) / (w * 0.075), 0, 1)
        front = (pixels[..., 3] * np.where(floor | opening, depth, 1)).astype('uint8')

        if flip:
            pixels, front = pixels[:, ::-1], front[:, ::-1]
            ax, ux = w - 1 - ax, -ux
        # Rotate the floor about the surveyed sill, through the exact terminal tangent.
        # Raise the painted roofs back along screen vertical. A height field registered
        # to the eaves keeps the turrets upright on oblique approaches.
        rot = math.atan2(along[1], along[0]) - math.atan2(uy, ux)
        c, s = math.cos(rot), math.sin(rot)
        ix, iy, left, top = source_coordinates(source, xx, yy, (ax, ay), c, s, flip)
        rgba = np.asarray(Image.fromarray(pixels).convert('RGBa'))
        warped = sample(np.dstack((rgba, front)), ix, iy)
        painted = Image.fromarray(warped[:, :, :4], 'RGBa').convert('RGBA')
        box = painted.getchannel('A').getbbox()
        self.im = painted.crop(box)
        self.front = Image.fromarray(warped[:, :, 4]).crop(box)
        self.anchor = -left - box[0], -top - box[1]
        paving = im
        if swatch is None:
            # Short oblique sills contain less than one full course of paving.
            paving = Image.open(directory / f'{self.theme}-w.webp')
            swatch = VIEWS['W'][2]
        box = tuple(round(n * v) for n, v in zip(swatch, (*paving.size, *paving.size)))
        self.pavers = np.asarray(paving.convert('RGB').crop(box))
        self.compact = source == 'compact'
        if self.compact:
            # The short sill has enough paint to match its hue, while the broad
            # lateral swatch provides full stone courses for the whole forecourt.
            stone = im.convert('RGB').crop((round(w*0.035), round(h*0.914),
                                            round(w*0.12), round(h*0.953)))
            tone = np.median(np.asarray(stone), axis=(0, 1))
            original = np.maximum(1, np.median(self.pavers, axis=(0, 1)))
            self.pavers = np.clip(self.pavers * (tone / original), 0, 255).astype('uint8')
        self.k = height * 1.15 / h
        self.deep = w * (0.12 if source == 'W' else 0.088) * self.k

    def place(self, size):
        k = self.k * size
        ux, uy = self.along
        # The endpoint remains inside the tunnel as the entire building shrinks.
        inset = self.deep * size
        x, y = self.point
        left = x + ux * inset - self.anchor[0] * k
        top = y + uy * inset - self.anchor[1] * k
        return dict(im=self.im, front=self.front, k=k, left=left, top=top,
                    rect=(left, top, left + self.im.width * k, top + self.im.height * k),
                    point=self.point, along=self.along, size=size, inset=inset)

    def trim_road(self, mask, scale, paths):
        """Round the terminal dirt shoulder under the shallow gatehouses' short sills."""
        if not self.compact:
            return
        gx, gy = self.point
        ux, uy = self.along
        radius = self.road * 1.25
        left, top = max(0, round((gx-radius)*scale)), max(0, round((gy-radius)*scale))
        right = min(mask.width, round((gx+radius)*scale))
        bottom = min(mask.height, round((gy+radius)*scale))
        yy, xx = np.indices((bottom-top, right-left), dtype=np.float32)
        x, y = (xx+left)/scale-gx, (yy+top)/scale-gy
        along, cross = x*ux+y*uy, -x*uy+y*ux
        # The road's square line cap can project past the gate base on the downhill
        # side. Pull just the edges back, under the stone apron.
        setback = 0.48*self.road*(cross/(self.road*0.53))**2-5
        keep = np.where(abs(cross) < self.road*0.68, np.clip((along-setback)/3, 0, 1), 1)
        # A loop may have passed beside the sill earlier in the same lane.
        # Only the final visit to this neighbourhood leads into the doorway.
        previous = Image.new('L', (right-left, bottom-top))
        draw = ImageDraw.Draw(previous)
        for path in paths:
            outside = next((i for i in range(len(path)-1, -1, -1)
                            if max(abs(path[i][0]-gx), abs(path[i][1]-gy)) > radius+self.road), 0)
            if outside > 0:
                draw.line([(px*scale-left, py*scale-top) for px, py in path[:outside+1]],
                          fill=255, width=round(self.road*scale), joint='curve')
        keep = np.maximum(keep, np.asarray(previous)/255)
        dirt = np.asarray(mask.crop((left, top, right, bottom)))
        mask.paste(Image.fromarray((dirt*keep).astype('uint8')), (left, top))

    def apron(self, ground, gate, scale, plots, rx, ry, path):
        """Setts flare from the existing dirt width to the foot of the two piers."""
        ux, uy = self.along
        gx, gy = self.point
        last = next(p for p in reversed(path[:-1]) if tuple(p) != tuple(path[-1]))
        length = min(self.road * 1.32, math.dist(last, path[-1]))
        r = math.ceil((length + self.road) * scale)
        left, top = round(gx * scale) - r, round(gy * scale) - r
        yy, xx = np.indices((2 * r, 2 * r), dtype=np.float32)
        x, y = (xx + left) / scale - gx, (yy + top) / scale - gy
        d, cross = x * ux + y * uy, -x * uy + y * ux
        t = np.clip((d - gate['inset']) / max(1, length - gate['inset']), 0, 1)
        half = self.road * (0.66 - 0.22 * t)
        row = np.floor((d + 90) / 8)
        col = np.floor((cross + 100 + 6 * (row % 2)) / 13)
        wear = np.sin(row * 23.7 + col * 75.1)
        alpha = np.clip((half - abs(cross) + wear * 1.5) / 3.5, 0, 1)
        alpha *= np.clip((length - d + wear * 6) / (self.road * 0.38), 0, 1)
        if self.compact:
            # The south jamb on these shallow sites is nearly flush with the
            # building's foot. Round the unused corners back into the road verge.
            nose = self.road * 0.50 * (cross / half)**2
            alpha *= np.clip((d + 4 - nose + wear * 2) / 9, 0, 1)
        else:
            alpha *= np.clip((d + 5) / 6, 0, 1)
        for px, py in plots:
            if abs(px - gx) < 3 * self.road and abs(py - gy) < 3 * self.road:
                ellipse = ((x + gx - px) / (rx + 4))**2 + ((y + gy - py) / (ry + 4))**2
                alpha *= np.clip((ellipse - 1) * 5, 0, 1)

        def mirror(a, n):
            value = np.floor(a).astype(int) % (2 * n)
            return np.minimum(value, 2 * n - 1 - value)

        tex = self.pavers
        color = tex[mirror(cross * 3.0, tex.shape[0]), mirror(d * 3.0, tex.shape[1])]
        ground.alpha_composite(Image.fromarray(np.dstack((color, (alpha * 245).astype('uint8')))), (left, top))
