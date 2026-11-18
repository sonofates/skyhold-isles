"""Project painted castle plans onto the last road segment. Elevations always stay upright."""
import math

import numpy as np
from postern import postern
from PIL import Image, ImageChops, ImageDraw, ImageFilter

# Portal axis (y), half-width, inner lintel (x), front bastion centre (x), rear hall (x),
# in keyed plan pixels. The floor is a separate surface and never occludes a walker.
PORTALS = {
    'orchard': (194, 19, 168, 123, 416),
    'terraces': (186, 23, 203, 112, 414),
    'tidal': (190, 21, 194, 122, 425),
    'highlands': (193, 24, 205, 133, 415),
    'hollow': (185, 21, 168, 106, 409),
    'ember': (185, 24, 213, 123, 420),
}


class Keep:
    def __init__(self, directory, biome, point, along, road, height, footprint=None):
        self.theme = biome or 'orchard'
        self.plan = Image.open(directory / f'plan-{self.theme}.webp').convert('RGBA')
        self.hall = Image.open(directory / f'tower-{self.theme}.webp').convert('RGBA')
        self.axis, self.half, self.lintel, self.bastion, self.rear = PORTALS[self.theme]
        self.point, self.along, self.road = point, along, road
        self.height = height
        self.footprint = footprint or {}
        if self.footprint:
            self.arch = Image.open(directory / f'arch-{self.theme}.webp').convert('RGBA')
        # The courtyard floor and roof deck share a registration at all facings. Remove the
        # artist's square-ended approach outside the gate and blend its sill into the plaza.
        # The tidal sill includes a dark raised curb above its central paving.
        paver_top = self.axis - 5 if self.theme == 'tidal' else self.axis - self.half + 6
        self.pavers = self.plan.convert('RGB').crop((20, paver_top, 76, self.axis + self.half - 6))
        px = np.array(self.plan)
        yy, xx = np.indices(px.shape[:2])
        outside = xx < self.bastion - 48
        floor = (abs(yy - self.axis) < self.half + 7) & (xx < self.lintel)
        fade = np.clip((xx - self.bastion + 35) / 25, 0, 1)
        px[..., 3] = np.where(outside, 0, px[..., 3] * np.where(floor, fade, 1))
        self.plan = Image.fromarray(px)
        alpha = px[..., 3].copy()
        alpha[floor] = 0
        self.front = Image.fromarray(alpha)
        self.yard = self.plan.getchannel('A')
        ImageDraw.Draw(self.yard).rounded_rectangle(
            (self.bastion, self.axis - 92, self.plan.width - 34, self.axis + 92), radius=24, fill=255)

    def place(self, wings, approach, size):
        """Scale the two wall ends beyond the turrets, preserving the portal and sim endpoint."""
        if self.footprint:
            return postern(self, self.footprint, wings, size)
        # Undo vertical foreshortening before computing the plan rotation. The projected
        # longitudinal axis then agrees with the sim vector, including N/S and diagonals.
        ux, uy = self.along
        pitch = 0.76
        cos, sin = -ux, -uy / pitch
        norm = math.hypot(cos, sin)
        cos, sin = cos / norm, sin / norm
        k = self.road / 117 * size
        q = 3  # match the native high-resolution bake
        # Keep the upriver end of the lane open between bastions. Taper the outside wall
        # courses independently of the width of the passage and the central roof.
        sy = np.array([0, self.axis - 92, self.axis - self.half, self.axis + self.half,
                       self.axis + 92, self.plan.height])
        lane = self.road * 0.39
        shoulder = (17 + 13 * wings) * size
        dy = np.array([-lane - shoulder - 35 * wings, -lane - shoulder, -lane,
                       lane, lane + shoulder, lane + shoulder + 35 * wings])
        sx = [0, self.lintel, self.plan.width]
        dx = [-self.lintel * k * approach, 0, (self.plan.width - self.lintel) * k]
        inset = 12 * size
        def project(x, y):
            return cos * x - sin * y + ux * inset, (sin * x + cos * y) * pitch + uy * inset
        hx, hy = project((self.rear - self.lintel) * k, 0)
        hall_h = self.height * size
        hall_w = hall_h * self.hall.width / self.hall.height
        # An upright hall sits on the inner bailey, with its foot just inside the near parapet.
        hall_bottom = hy + hall_w * 0.27
        corners = [project(x, y) for x in (dx[0], dx[-1]) for y in (dy[0], dy[-1])]
        left = math.floor(min(hx - hall_w / 2, *(x for x, _ in corners))) - 2
        top = math.floor(min(hall_bottom - hall_h, *(y for _, y in corners)) - 10)
        right = math.ceil(max(hx + hall_w / 2, *(x for x, _ in corners))) + 2
        bottom = math.ceil(max(hall_bottom, *(y for _, y in corners))) + 2
        yy, xx = np.indices((round((bottom - top) * q), round((right - left) * q)), dtype=np.float32)
        x = left + (xx + 0.5) / q - ux * inset
        py = top + (yy + 0.5) / q
        y = (py - uy * inset) / pitch
        # Map the painted wall courses onto the projected plan.
        # Inverse-map at working resolution to leave the portal at exactly the same point.
        cross = -sin * x + cos * y
        u = np.interp(cos * x + sin * y, dx, sx, left=-2, right=-2)
        v = np.interp(cross, dy, sy, left=-2, right=-2)
        def sample(im):
            # Half-source-pixel sampling keeps oblique eaves smooth on the 3x maps.
            enlarged = im.resize((2 * im.width, 2 * im.height), Image.Resampling.BICUBIC)
            ix = np.clip((u * 2).astype(int), 0, enlarged.width - 1)
            iy = np.clip((v * 2).astype(int), 0, enlarged.height - 1)
            pixels = np.asarray(enlarged)[iy, ix].copy()
            pixels[(u < 0) | (v < 0)] = 0
            return Image.fromarray(pixels)
        ground = sample(self.plan)
        yard = sample(self.yard)
        roof = ground.copy()
        roof.putalpha(sample(self.front))
        # The masonry has a shallow vertical return on the near edge, independently of yaw.
        lift = round(8 * q)
        side = roof.point(lambda n: int(n * .71))
        side.putalpha(roof.getchannel('A'))
        for h in range(0, lift, 2):
            ground.alpha_composite(side, (0, -h))
        ground.alpha_composite(roof, (0, -lift))
        foreground = Image.new('L', ground.size)
        foreground.paste(roof.getchannel('A'), (0, -lift))
        for h in range(lift):
            raised = Image.new('L', ground.size)
            raised.paste(roof.getchannel('A'), (0, -h))
            foreground = ImageChops.lighter(foreground, raised)
        hall = self.hall.resize((round(hall_w * q), round(hall_h * q)), Image.Resampling.LANCZOS)
        xy = round((hx - hall_w / 2 - left) * q), round((hall_bottom - hall_h - top) * q)
        ground.alpha_composite(hall, xy)
        hall_mask = Image.new('L', ground.size)
        hall_mask.paste(hall.getchannel('A'), xy)
        foreground = ImageChops.lighter(foreground, hall_mask)
        bb = ground.getchannel('A').getbbox()
        ground, foreground = ground.crop(bb), foreground.crop(bb)
        left += self.point[0] + bb[0] / q
        top += self.point[1] + bb[1] / q
        return dict(im=ground, front=foreground, yard=yard.crop(bb), left=left, top=top, k=1/q,
                    rect=(left, top, left+ground.width/q, top+ground.height/q), point=self.point,
                    along=self.along, wings=wings, approach=approach, size=size, inset=inset,
                    sites=[(self.point[0]+hx, self.point[1]+hall_bottom-hall_w*.15, hall_w)])

    def apron(self, ground, gate, scale, plots, rx, ry, path):
        """Flare the road into a stone forecourt. Worn outer setts dissolve into the local dirt."""
        ux, uy = self.along
        gx, gy = self.point
        road = self.road
        last = next(p for p in reversed(path[:-1]) if tuple(p) != tuple(path[-1]))
        length = min(road * 1.6, math.dist(last, path[-1]))
        r = math.ceil(max(length + road, gx-gate['left'], gy-gate['top'], gate['rect'][2]-gx, gate['rect'][3]-gy) * scale + 8*scale)
        left, top = round(gx * scale) - r, round(gy * scale) - r
        yy, xx = np.indices((2*r, 2*r), dtype=np.float32)
        x, y = (xx + left) / scale - gx, (yy + top) / scale - gy
        d, cross = x * ux + y * uy, -x * uy + y * ux
        # Broad at the barbican and narrow at the dirt end. Slightly irregular edge stones.
        t = np.clip(d / length, 0, 1)
        width = road * (0.77 - 0.32 * t)
        row = np.floor((d + 100) / 8)
        col = np.floor((cross + 100 + 7 * (row % 2)) / 15)
        wear = np.sin(row * 23.7 + col * 75.1)
        alpha = np.clip((width - abs(cross) + wear * 2.4) / 5, 0, 1)
        alpha *= np.clip((length - d + wear * 11) / (road * .55), 0, 1)
        alpha *= np.clip((d + 12) / 8, 0, 1)
        # The yard extends underneath the whole fortress. Its gravel shoulder softens into
        # the surrounding biome, and the open space between the walls reads as a courtyard.
        fp = gate['yard']
        footprint = fp.resize((round(fp.width * gate['k'] * scale), round(fp.height * gate['k'] * scale)),
                              Image.Resampling.LANCZOS)
        yard = Image.new('L', (2*r, 2*r))
        yard.paste(footprint, (round(gate['left'] * scale) - left, round(gate['top'] * scale) - top))
        shoulder = np.asarray(yard.filter(ImageFilter.GaussianBlur(4 * scale))) / 255
        alpha = np.maximum(alpha, shoulder * .88)
        for px, py in plots:
            if abs(px-gx) < 3.5*road and abs(py-gy) < 3.5*road:
                ring = ((x + gx - px) / (rx+4))**2 + ((y + gy - py) / (ry+4))**2
                alpha *= np.clip((ring - 1) * 5, 0, 1)
        # Use the actual painted paving from this gate's approach. Mirror alternate tiles at
        # the seams so a snow-dusted sill, for example, meets the same snow-dusted setts.
        tex = np.asarray(self.pavers)
        def mirrored(a, n):
            m = np.floor(a).astype(int) % (2*n)
            return np.minimum(m, 2*n-1-m)
        color = tex[mirrored(cross * 1.7, tex.shape[0]), mirrored(d * 1.9, tex.shape[1])]
        stamp = Image.fromarray(np.dstack((color, (alpha * 245).astype('uint8'))))
        ground.alpha_composite(stamp, (left, top))
