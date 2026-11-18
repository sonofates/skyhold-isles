"""Compact painted gatehouse for the three sites with a tower envelope beside the threshold.

The foregate, returning walls and residential hall have separate foundations. This lets a wall
turn into the bailey, leaving room for the existing plots without squashing a painted turret.
"""
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

# Lintel, round bastion and curtain top, in the three keyed plan paintings.
PARTS = {
    'terraces': [(209, 73, 291, 293), (71, 75, 155, 158), (94, 5, 129, 72)],
    'tidal': [(209, 87, 263, 290), (82, 67, 157, 145), (106, 7, 133, 64)],
    'orchard': [(180, 95, 239, 170), (89, 99, 155, 166), (105, 9, 136, 86)],
}


def postern(keep, site, wings, size):
    q = 3
    width, height = 500*q, 390*q
    cx, cy = 250*q, 245*q
    ground = Image.new('RGBA', (width, height))
    yard = Image.new('L', ground.size)
    foreground = Image.new('L', ground.size)
    ux, uy = keep.along
    # d increases out onto the approach. v increases towards the near (bottom) wall.
    vx, vy = (-uy, ux) if ux > 0 else (uy, -ux)
    def pos(d, v):
        return np.array([cx + q * size * (ux*d + vx*v), cy + q * size * (uy*d + vy*v)])
    def screen(x, y):
        return np.array([cx + q*x*size, cy + q*y*size])

    lintel, roundel, curtain = [keep.plan.crop(box) for box in PARTS[keep.theme]]
    # The round towers' crown is masked at its contour; the surrounding plan includes paving.
    cut = Image.new('L', roundel.size)
    ImageDraw.Draw(cut).ellipse((1, 1, roundel.width-2, roundel.height-2), fill=255)
    roundel.putalpha(ImageChops.multiply(roundel.getchannel('A'), cut.filter(ImageFilter.GaussianBlur(.7))))
    pieces = []
    def stamp(texture, origin, u, v, rise, flanks=True, facade=False):
        """Place a roof between two ground axes. Its painted eave supplies the masonry colour."""
        corners = np.array([origin, origin+u, origin+v, origin+u+v])
        lo = np.floor(corners.min(axis=0)).astype(int)-2
        hi = np.ceil(corners.max(axis=0)).astype(int)+2
        a = np.linalg.inv(np.column_stack((u/texture.width, v/texture.height)))
        ox, oy = a @ (lo-origin)
        cap = texture.transform(tuple(hi-lo), Image.Transform.AFFINE,
                                (a[0,0], a[0,1], ox, a[1,0], a[1,1], oy), Image.Resampling.BICUBIC)
        h = round(rise*q*size)
        sprite = Image.new('RGBA', (cap.width, cap.height+h))
        if flanks:
            base = cap.point(lambda c: round(c*.67))
            base.putalpha(cap.getchannel('A'))
            mortar = cap.point(lambda c: round(c*.53))
            mortar.putalpha(cap.getchannel('A'))
            for j in range(h, 0, -1):
                sprite.alpha_composite(mortar if j % max(3,round(5*q*size)) == 0 else base, (0,j))
        sprite.alpha_composite(cap)
        anchor = (int(lo[0]), int(lo[1]-h))
        pieces.append((float(corners[:,1].mean()), sprite, anchor))
        if not facade:
            yard.paste(255, tuple(lo), cap.getchannel('A'))

    def oriented(tex, d0, d1, v0, v1, rise, flanks=True):
        # Source x increases inwards; source y runs along the wall.
        origin = pos(d1,v0)
        stamp(tex, origin, pos(d0,v0)-origin, pos(d1,v1)-origin, rise, flanks)

    def wall(start, end):
        run = end-start
        perp = np.array([-run[1],run[0]]) / max(1,np.linalg.norm(run)) * (11*q*size)
        stamp(curtain, start-perp/2, perp, run, 9)
    near_d = site.get('nearPier', -3)
    far, near = pos(0,-25), pos(near_d,13)
    # Surveyed free ends of the two return walls in layout pixels relative to the goal.
    for anchor, direction in [(far,site['far']), (near,site['near'])]:
        end = screen(*direction)
        wall(anchor, anchor+(end-anchor)*(.55+.45*wings))

    oriented(roundel, -11, 10, -36, -15, 17)
    oriented(roundel, near_d-9, near_d+9, 6, 21, 15)
    top = pos(8,-26)
    near_eave = pos(near_d+9,14)
    eaves = sorted((top,near_eave), key=lambda p: p[0])
    rise = np.array([0., 34*q*size])
    stamp(keep.arch, eaves[0]-rise, eaves[1]-eaves[0], rise, 0, flanks=False, facade=True)
    stamp(lintel, top, pos(-22,-26)-top, near_eave-top, 34, flanks=False)
    # Interior floor, visible between the piers. The shadow deepens under the roof independently
    # of the foreground towers, so a walker's feet and head disappear together at the endpoint.
    xmin, ymin = (pos(0,0) - 52*q).astype(int)
    yy, xx = np.indices((104*q,104*q),dtype=np.float32)
    dx, dy = (xx+xmin-cx)/(q*size), (yy+ymin-cy)/(q*size)
    d, v = dx*ux+dy*uy, dx*vx+dy*vy
    tunnel = np.clip((15-d)/13,0,1) * np.clip((d+24)/4,0,1)
    tunnel *= np.clip((10-v)/3,0,1) * np.clip((v+25)/3,0,1)
    stone = np.asarray(keep.pavers)
    paving = stone[(v*2).astype(int) % stone.shape[0], (d*2).astype(int) % stone.shape[1]]
    light = (.86 - .48*tunnel)[...,None]
    dark = Image.fromarray((paving*light).astype('uint8')).convert('RGBA')
    dark.putalpha(Image.fromarray((tunnel*240).astype('uint8')))
    ground.alpha_composite(dark,(xmin,ymin))
    foreground.paste(Image.fromarray((tunnel*252).astype('uint8')),(xmin,ymin))

    hx, hy = screen(*site['hall'])
    hall_h = round(keep.height*q*size)
    hall_w = round(hall_h*keep.hall.width/keep.hall.height)
    # The bailey returns to the hall on both sides. These walls share its ground line,
    # giving the gateway a continuous foundation and leaving the tunnel itself open.
    hall_centre = np.array([hx, hy-hall_w*.17])
    for pier, v in [(far,-1),(near,1)]:
        join = hall_centre + np.array([vx,vy]) * hall_w*.17*v
        wall(pier, join)
    hall = keep.hall.resize((hall_w,hall_h),Image.Resampling.LANCZOS)
    if site.get('hallFlip'):
        hall = hall.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    pieces.append((hy-hall_w*.16, hall, (round(hx-hall_w/2),round(hy-hall_h))))
    # Connect the building foundations with a stone yard, tucked between their walls.
    draw = ImageDraw.Draw(yard)
    draw.polygon([tuple(pos(-6,-25)),(hx-hall_w*.3,hy-hall_w*.2),(hx,hy),
                  tuple(pos(-8,13))],fill=255)
    for _, sprite, xy in sorted(pieces, key=lambda part: part[0]):
        ground.alpha_composite(sprite,xy)
        foreground.paste(255,xy,sprite.getchannel('A'))
    bbox = ground.getchannel('A').getbbox()
    im = ground.crop(bbox)
    left = keep.point[0] + (bbox[0]-cx)/q
    top = keep.point[1] + (bbox[1]-cy)/q
    return dict(im=im, front=foreground.crop(bbox), yard=yard.crop(bbox), k=1/q, left=left, top=top,
                rect=(left,top,left+im.width/q,top+im.height/q), point=keep.point,
                along=keep.along, wings=wings, approach=1, size=size,
                sites=[(keep.point[0]+(hx-cx)/q, keep.point[1]+(hy-cy)/q-hall_w*.15/q, hall_w/q)])
