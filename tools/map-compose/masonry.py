"""Stone courses, roadside masonry and cart tracks in layout pixels."""
import math
import random

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter


def arch_bridge(ground, paint, land, layout_size, start, end, above, below, curb, scale):
    """Shear an east-west elevation along the lane, burying its piers in the two banks.

    The endpoints mark the deck centre. Above/below bound the painting vertically
    relative to that line. Only masonry below the near curb can disappear behind land.
    """
    x0, y0 = start
    x1, y1 = end
    bounds = (x0, min(y0, y1)-above, x1, max(y0, y1)+below)
    left, top, right, bottom = (round(v*scale) for v in bounds)
    size = right-left, bottom-top
    slope = (y1-y0)/(x1-x0)
    sx, sy = paint.width/((x1-x0)*scale), paint.height/((above+below)*scale)
    dx = left-x0*scale
    matrix = (sx, 0, dx*sx, -slope*sy, sy, (top-(y0-above)*scale-slope*dx)*sy)
    bridge = paint.transform(size, Image.Transform.AFFINE, matrix, Image.Resampling.BICUBIC)

    mx, my = land.width/(layout_size[0]*scale), land.height/(layout_size[1]*scale)
    bank = land.transform(size, Image.Transform.EXTENT, (left*mx, top*my, right*mx, bottom*my),
                          Image.Resampling.BILINEAR)
    yy, xx = np.ogrid[:size[1], :size[0]]
    depth = (top+yy+.5)/scale - y0 - slope*((left+xx+.5)/scale-x0)
    soil = np.asarray(bank) * np.clip(depth-curb, 0, 1)
    # Once a pier enters the bank, it cannot reappear below the projecting ledge.
    soil = np.maximum.accumulate(soil, axis=0)
    bridge.putalpha(ImageChops.multiply(bridge.getchannel('A'), Image.fromarray((255-soil).astype('uint8'))))
    ground.alpha_composite(bridge, (left, top))
    return bounds


class RoadCourse:
    """Distance along a polyline and a signed offset from its centre."""
    def __init__(self, path):
        points = np.array(path, dtype=float)
        distances = np.hypot(*np.diff(points, axis=0).T)
        self.points = points[np.r_[True, distances > 0]]
        self.stations = np.r_[0, np.cumsum(distances[distances > 0])]
        self.length = self.stations[-1]

    def centre(self, s):
        return np.array([np.interp(s, self.stations, coord) for coord in self.points.T])

    def point(self, s, offset):
        centre = self.centre(s)
        dx, dy = self.centre(s+2) - self.centre(s-2)
        length = math.hypot(dx, dy)
        return centre + np.array([-dy, dx]) * (offset / length)


class RoadArcade:
    """An exposed retaining wall under a south-facing stretch of elevated road."""
    def __init__(self, path, start, end, width, height):
        points = np.asarray(path)
        i, j = (np.argmin(np.linalg.norm(points - anchor, axis=1)) for anchor in (start, end))
        section = points[min(i, j):max(i, j)+1]
        if len(section) < 2 or height <= 0:
            raise ValueError('An arcade needs two distinct road stations and positive height')
        if section[0, 0] > section[-1, 0]:
            section = section[::-1]
        course = RoadCourse(section)
        stations = np.linspace(0, course.length, max(2, math.ceil(course.length / 3) + 1))
        edge = np.array([course.point(s, width / 2) for s in stations])
        self.x, self.rim = edge.T
        if np.any(np.diff(self.x) <= 0):
            raise ValueError('An arcade must follow a screen-facing road edge')
        self.distance = np.r_[0, np.cumsum(np.hypot(*np.diff(edge, axis=0).T))]
        self.height = height
        # At either abutment the hillside covers the lower courses first.
        run = np.minimum(self.distance, self.distance[-1] - self.distance)
        self.foot = self.rim + height * np.clip(run / (height * 2), 0, 1)

    def footprint(self):
        return list(zip(self.x, self.rim - 3)) + list(zip(self.x[::-1], self.foot[::-1] + 3))

    def paint(self, ground, material, scale):
        # Project the painted elevation vertically below the near lip. The road
        # overpaints three pixels of coping to seal its irregular gravel edge.
        left, right = math.ceil(self.x[0]*scale), math.floor(self.x[-1]*scale)
        top, bottom = math.floor((min(self.rim)-3)*scale), math.ceil((max(self.foot)+3)*scale)
        x = (np.arange(left, right) + .5) / scale
        y = (np.arange(top, bottom)[:, None] + .5) / scale
        rim, foot, distance = (np.interp(x, self.x, v) for v in (self.rim, self.foot, self.distance))
        h = max(1, round((self.height+3)*scale))
        w = max(1, round(h*1.45*material.width/material.height))
        tile = np.asarray(material.convert('RGB').resize((w, h), Image.Resampling.LANCZOS))
        u = (distance*scale).astype(int) % w
        depth = y-rim+3
        v = np.clip((depth*scale).astype(int), 0, h-1)
        face = Image.fromarray(tile[v, u])
        # Exposed slate catches the foot unevenly. Keep its painted grain in
        # the narrow contact shadow beneath the buried courses.
        bank = ground.crop((left, top, right, bottom))
        highlights = np.asarray(bank.convert('L'), dtype=float)
        foot = foot - np.clip((highlights-70)/20, 0, 3)
        contact = np.clip((foot-y+3)/3, 0, 1) * np.clip(depth*scale, 0, 1)
        ground.paste(ImageEnhance.Brightness(bank).enhance(.63), (left, top),
                     Image.fromarray(np.uint8(contact*255)))
        alpha = np.clip(foot-y+.5, 0, 1) * np.clip(depth*scale, 0, 1)
        ground.paste(face, (left, top), Image.fromarray(np.uint8(alpha*255)))


def cart_tracks(surface, path, road_width, scale, seed):
    """Press two shallow, broken wheel tracks into the painted earth along a cart route."""
    course = RoadCourse(path)
    rand = random.Random(seed)
    worn = Image.new('L', surface.size)
    pen = ImageDraw.Draw(worn)
    start = road_width
    while start < course.length - road_width:
        end = min(start + rand.uniform(50, 160), course.length - road_width)
        bend = rand.uniform(-1.9, 1.9)
        for side in (-1, 1):
            finish = end - rand.uniform(0, 10)
            points = np.arange(start + rand.uniform(0, 6), finish, 2)
            if len(points) < 2:
                continue
            outer, inner = [], []
            for station in points:
                phase = (station - start) / (end - start)
                offset = side * road_width * .235 + bend * math.sin(phase * math.pi)
                radius = road_width * .043 * math.sin(phase * math.pi) ** .55
                outer.append(tuple(course.point(station, offset + radius) * scale))
                inner.append(tuple(course.point(station, offset - radius) * scale))
            pen.polygon(outer + inner[::-1], fill=rand.randint(92, 157))
        start = end + rand.uniform(14, 53)
    # Keep the earth's grain in each groove and soften the edges into the undisturbed soil.
    grooves = ImageEnhance.Brightness(surface).enhance(.70)
    surface.paste(grooves, mask=worn.filter(ImageFilter.GaussianBlur(.94 * scale)))


def stone_quad(img, corners, paint, scale):
    """Fit one face of a painted block to its four corners. Adjacent blocks share an edge."""
    points = np.asarray(corners) * scale
    left, top = np.floor(points.min(axis=0)).astype(int)
    right, bottom = np.ceil(points.max(axis=0)).astype(int)
    size = right-left+1, bottom-top+1
    local = points - (left, top)
    # Orthographic ground projection. Fit the texture through the middle of all
    # four edges so even a tapered stone keeps its brushwork at a bend.
    x0, y0 = local.mean(axis=0)
    ux, uy = (local[1]+local[2]-local[0]-local[3])*.5
    vx, vy = (local[2]+local[3]-local[0]-local[1])*.5
    det = ux*vy-uy*vx
    if abs(det) < .05:
        return
    w, h = paint.size
    a, b = (w-1)*vy/det, -(w-1)*vx/det
    d, e = -(h-1)*uy/det, (h-1)*ux/det
    matrix = (a, b, w/2-a*x0-b*y0, d, e, h/2-d*x0-e*y0)
    tile = paint.transform(size, Image.Transform.AFFINE, matrix, Image.Resampling.BILINEAR,
                           fillcolor=paint.getpixel((w//2, h//2)))
    clip = Image.new('L', size)
    pts = [tuple(p) for p in local]
    ImageDraw.Draw(clip).polygon(pts, fill=255)
    img.paste(tile, (left, top), clip)


def brick_spur(surface, path, paint, width, scale):
    """Lay firebrick courses along a branch, ending in a transverse row before the junction."""
    course = RoadCourse(path)
    end = course.length - width
    if end <= 0:
        return
    density = 3
    half = width * .62
    # The centre six courses of the painting fill the lane. Extend the strip
    # past its painted end to support bilinear sampling at the final joint.
    height = math.ceil(2 * half * density) + 1
    strip = Image.new('RGB', (math.ceil(end * density) + 2, height))
    period = round(2 * width * density)
    tile = paint.convert('RGB').resize((period, period), Image.Resampling.LANCZOS)
    row = tile.crop((0, (period-height)//2, period, (period-height)//2 + height))
    for offset in range(0, strip.width, period):
        strip.paste(row, (offset, 0))
    # Cut the transverse end course from the middle of a painted row.
    header = tile.transpose(Image.Transpose.ROTATE_90)
    cap = min(strip.width, max(1, round(width * .19 * density)))
    strip.paste(header.crop((period//2, 0, period//2 + cap, height)), (strip.width-cap, 0))
    project_strip(surface, strip, course, half, scale, density, end=end)


def marble_road(size, paint, path, width, scale, seed):
    # The source has a mirrored centre medallion. Cut individual uninterrupted
    # veined slabs, including their top bevels, from elsewhere in that painting.
    cuts = [(14, 51, 103, 149), (104, 89, 195, 185), (225, 89, 313, 185),
            (69, 187, 157, 249), (263, 187, 350, 250), (226, 251, 312, 347)]
    slabs = [paint.crop(c).convert('RGB') for c in cuts]
    rnd = random.Random(seed)
    course = RoadCourse(path)
    # Build the courses straight at native 3x density, then sample them by
    # distance along and across the centreline. The joints stay continuous
    # even at the inner radius of a tight turn.
    density = 3
    half = width*.62
    strip = Image.new('RGB', (math.ceil(course.length*density)+1, math.ceil(2*half*density)+1))
    draw = ImageDraw.Draw(strip)
    offsets = np.array([-.62, -.43, -.17, .15, .42, .62])*width
    for row, (near, far) in enumerate(zip(offsets, offsets[1:])):
        s = 0
        top, bottom = round((near+half)*density), round((far+half)*density)
        while s < course.length:
            end = min(s+rnd.uniform(14, 27), course.length)
            slab = rnd.choice(slabs)
            if rnd.getrandbits(1):
                slab = slab.transpose(Image.Transpose.ROTATE_90)
            left, right = round(s*density), round(end*density)
            face = ImageEnhance.Brightness(slab).enhance(rnd.uniform(.961, 1.018))
            strip.paste(face.resize((right-left+1, bottom-top+1), Image.Resampling.LANCZOS), (left, top))
            shade = rnd.choice([(179, 162, 137), (194, 177, 151), (185, 171, 148)])
            draw.line((left, top, left, bottom), fill=shade, width=2)
            draw.line((left, top, right, top), fill=shade, width=2 if row in (1, 4) else 1)
            if rnd.random() < .08:
                draw.polygon([(left,top),(left+5,top),(left,top+3)], fill=shade)
            s = end

    result = Image.new('RGBA', size, (210, 192, 164, 255))
    project_strip(result, strip, course, half, scale, density)
    return result


def paved_road(size, paint, path, width, scale):
    """Unroll a painted strip from entrance to keep, preserving each course on bends."""
    course = RoadCourse(path)
    half = width * .62
    density = (paint.height - 1) / (2 * half)
    strip = paint.convert('RGB').resize((max(2, math.ceil(course.length * density) + 1), paint.height),
                                        Image.Resampling.LANCZOS)
    surface = Image.new('RGBA', size, strip.getpixel((0, strip.height // 2)) + (255,))
    project_strip(surface, strip, course, half, scale, density)
    return surface


def timber_approach(surface, path, paint, width, length, scale):
    """Lay the painted crossboards from the threshold, leaving the lane junction clear."""
    course = RoadCourse(path)
    end = min(length, course.length - width)
    if end <= 0:
        return
    half = width * .62
    density = 3
    # The artist paints the sleepers horizontally. Map their long grain
    # across the road while the station axis follows the entrance bend.
    strip = paint.convert('RGB').transpose(Image.Transpose.ROTATE_90).resize(
        (math.ceil(end * density) + 2, math.ceil(2 * half * density) + 2), Image.Resampling.LANCZOS)
    project_strip(surface, strip, course, half, scale, density, end=end)


def project_strip(surface, strip, course, half, scale, density, end=None, repeat=False):
    """Sample a continuous course of paving along the road's local tangent."""
    size = surface.size
    texture = np.asarray(strip)
    # Project small image tiles onto nearby segments; peak memory stays
    # independent of island size. Short chords follow the original spline.
    stations = np.r_[np.arange(0, course.length, 5), course.length]
    centres = course.centre(stations).T
    start, delta = centres[:-1], np.diff(centres, axis=0)
    low = np.minimum(start, centres[1:])-half-2
    high = np.maximum(start, centres[1:])+half+2
    step = round(72*scale)
    for y0 in range(0, size[1], step):
        for x0 in range(0, size[0], step):
            x1, y1 = min(size[0], x0+step), min(size[1], y0+step)
            nearby = ((low[:,0] < x1/scale) & (high[:,0] >= x0/scale)
                      & (low[:,1] < y1/scale) & (high[:,1] >= y0/scale))
            if not np.any(nearby):
                continue
            yy, xx = np.ogrid[y0:y1, x0:x1]
            xx, yy = (xx+.5)/scale, (yy+.5)/scale
            best = np.full((y1-y0,x1-x0), np.inf)
            along, across = np.zeros_like(best), np.zeros_like(best)
            for i in np.flatnonzero(nearby):
                dx, dy = delta[i]
                ax, ay = xx-start[i,0], yy-start[i,1]
                t = np.clip((ax*dx+ay*dy)/(dx*dx+dy*dy), 0, 1)
                sq = (ax-t*dx)**2 + (ay-t*dy)**2
                closer = sq < best
                best = np.minimum(best, sq)
                along = np.where(closer, stations[i]+t*(stations[i+1]-stations[i]), along)
                across = np.where(closer, np.copysign(np.sqrt(sq), dx*ay-dy*ax), across)
            u = (along*density) % (strip.width-1) if repeat else np.clip(along*density, 0, strip.width-1.001)
            v = np.clip((across+half)*density, 0, strip.height-1.001)
            ix, iy = u.astype(int), v.astype(int)
            fx, fy = (u-ix)[:,:,None], (v-iy)[:,:,None]
            upper = texture[iy,ix]*(1-fx) + texture[iy,ix+1]*fx
            lower = texture[iy+1,ix]*(1-fx) + texture[iy+1,ix+1]*fx
            tile = Image.fromarray(np.uint8(upper*(1-fy)+lower*fy))
            mask = None
            if end is not None:
                mask = Image.fromarray(np.uint8((along < end) & (best <= half**2)) * 255)
            surface.paste(tile, (x0,y0), mask)


def moat_wall(ground, land, layout_size, path, width, scale, bridge_paint, seed):
    """Expose the retaining face and coping of the causeway where it enters the moat."""
    course = RoadCourse(path)
    iw, ih = layout_size
    # Everything sits below the final road paint. Dry approaches conceal the
    # back of the masonry as the stones sink into the natural embankment.
    # Use the actual stone bridge's deck stones for a continuous material.
    cuts = [(49, 27, 91, 44), (52, 55, 108, 77), (69, 119, 127, 146),
            (50, 164, 107, 183), (66, 283, 123, 302), (75, 340, 124, 361)]
    blocks = [bridge_paint.crop(c).convert('RGB') for c in cuts]
    layer = ground.copy()
    rnd = random.Random(seed)
    for side in (-1, 1):
        for course_row in (2, 1, 0):
            s = 0
            while s < course.length:
                end = min(s+rnd.uniform(12, 22), course.length)
                a = course.point(s, side*(width/2+2))
                b = course.point(end, side*(width/2+2))
                cx, cy = (a+b)*.5
                # Skip inland stretches; the final water mask handles the exact edge.
                mx, my = int(cx*land.width/iw), int(cy*land.height/ih)
                if land.crop((mx-4,my-4,mx+5,my+5)).getextrema()[0] < 128:
                    if course_row:
                        top = np.array([0, 2+(course_row-1)*5])
                        bottom = top+np.array([0, 5.8])
                        corners = [a+top,b+top,b+bottom,a+bottom]
                        brightness = (.69 if course_row == 1 else .52)*rnd.uniform(.94, 1.06)
                    else:
                        corners = [course.point(s, side*(width/2-2)),
                                   course.point(end, side*(width/2-2)), b+[0,2], a+[0,2]]
                        brightness = rnd.uniform(.88, 1)
                    block = ImageEnhance.Brightness(rnd.choice(blocks)).enhance(brightness)
                    stone_quad(layer, corners, block, scale)
                    draw = ImageDraw.Draw(layer)
                    draw.line([tuple(corners[0]*scale),tuple(corners[3]*scale)], fill=(95,83,60),
                              width=max(1,round(.8*scale)))
                    draw.line([tuple(corners[2]*scale),tuple(corners[3]*scale)],
                              fill=(95,84,61) if course_row else (147,133,100),
                              width=max(1,round(.65*scale)))
                s = end
    wet = ImageChops.invert(land).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    ground.paste(layer, (0, 0), wet.resize(ground.size, Image.Resampling.BILINEAR))
