"""Gate props for map-compose: raider caves (entrances) and the castle gate (goal).

A gate's MOUTH faces along the road (same rule as src/data/levels2d/gates.ts):
  entrance → direction of its path's first segment, goal → back along the last segment;
  quantised to E / S / W / N, ties (exact diagonals) go to the horizontal facing.

Each gate sprite (assets/gate-<prop>.png, keyed Codex art) has a dark mouth. `measure_mouth`
finds it (the big near-black region), its exit line (the edge of the opening along the facing)
and the ground anchor at the middle of the exit. The compositor places the sprite so that the
path end sits INSET px inside the mouth, bakes the whole gate into the map, then cuts the FRONT
layer out of the final composite: every gate pixel on the inner side of the exit line except the
mouth (rock lip, arch, frame), plus a dark gradient over the mouth (opaque deep inside → clear at
the exit). The renderer draws it above the actors, so walkers appear out of the darkness.
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FACING_VEC = {'E': (1.0, 0.0), 'W': (-1.0, 0.0), 'S': (0.0, 1.0), 'N': (0.0, -1.0)}
MIRROR = {'E': 'W', 'W': 'E', 'S': 'S', 'N': 'N'}


def facing_from_dir(dx, dy):
    if abs(dx) >= abs(dy):
        return 'E' if dx >= 0 else 'W'
    return 'S' if dy > 0 else 'N'


def _first_step(path, frm, step):
    x0, y0 = path[frm]
    i = frm + step
    while 0 <= i < len(path):
        dx, dy = path[i][0] - x0, path[i][1] - y0
        if dx or dy:
            return dx, dy
        i += step
    raise ValueError('path has no non-zero segment')


def _unit(dx, dy):
    n = math.hypot(dx, dy) or 1.0
    return dx / n, dy / n


def entrance_dir(path):
    """Unit direction of the road leaving an entrance (its first segment)."""
    return _unit(*_first_step(path, 0, 1))


def goal_dir(path):
    """Unit direction from the goal back along the road (its last segment, reversed)."""
    return _unit(*_first_step(path, len(path) - 1, -1))


def entrance_facing(path):
    return facing_from_dir(*_first_step(path, 0, 1))


def goal_facing(path):
    return facing_from_dir(*_first_step(path, len(path) - 1, -1))


def resolve_prop(kind, facing, asset_file):
    """(file name, flip) of the gate art for `kind` (cave / castle) facing `facing`.
    Uses the mirrored art for E <-> W when only one exists; else the nearest available facing."""
    if asset_file(f'gate-{kind}-{facing.lower()}.png').exists():
        return f'{kind}-{facing.lower()}', f'gate-{kind}-{facing.lower()}.png', False
    m = MIRROR[facing]
    if m != facing and asset_file(f'gate-{kind}-{m.lower()}.png').exists():
        return f'{kind}-{facing.lower()}', f'gate-{kind}-{m.lower()}.png', True
    for f in ('S', 'E', 'W', 'N'):
        if asset_file(f'gate-{kind}-{f.lower()}.png').exists():
            print(f'  warning: no {kind} art facing {facing}, using {f}')
            return f'{kind}-{f.lower()}', f'gate-{kind}-{f.lower()}.png', False
    raise FileNotFoundError(f'no directional art for {kind}')


def measure_mouth(im: Image.Image, facing: str, dark=58):
    """Mouth of a gate sprite (sprite px): mask (L image), exit projection, anchor (x, y).

    The mouth is the largest connected near-black region (thin dark outlines are opened away
    first). `exit` = 96th percentile of the mouth's projection on the facing vector; the anchor is
    the ground point in the middle of the exit: for E/W the bottom of the mouth near the exit, for S
    the bottom centre, for N the middle of the mouth."""
    a = np.asarray(im.convert('RGBA')).astype(np.int32)
    lum = (a[..., 0] * 3 + a[..., 1] * 6 + a[..., 2]) // 10
    dark_m = ((lum < dark) & (a[..., 3] > 200)).astype(np.uint8) * 255
    m = Image.fromarray(dark_m, 'L').filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    arr = np.asarray(m) > 0
    ys, xs = np.nonzero(arr)
    if len(xs) == 0:
        raise ValueError('no dark mouth found')
    # largest component: flood from the pixel nearest the centroid of the dark pixels, then keep it
    work = m.copy()
    best, best_n = None, 0
    seen = np.zeros_like(arr)
    for _ in range(12):
        cand = np.argwhere(arr & ~seen)
        if len(cand) == 0:
            break
        sy, sx = cand[len(cand) // 2]
        probe = work.copy()
        ImageDraw.floodfill(probe, (int(sx), int(sy)), 128)
        comp = np.asarray(probe) == 128
        seen |= comp
        n = int(comp.sum())
        if n > best_n:
            best, best_n = comp, n
    mask = Image.fromarray(best.astype(np.uint8) * 255, 'L').filter(ImageFilter.MaxFilter(5))
    marr = np.asarray(mask) > 0
    ys, xs = np.nonzero(marr)
    vx, vy = FACING_VEC[facing]
    proj = xs * vx + ys * vy
    exit_p = float(np.percentile(proj, 96))
    lo = float(np.percentile(proj, 2))
    band = proj >= exit_p - 0.25 * (exit_p - lo)
    if facing in ('E', 'W'):
        ax = float(np.mean(xs[band]))
        ay = float(np.percentile(ys[band], 92))
    elif facing == 'S':
        ax = float(np.mean(xs))
        ay = float(np.percentile(ys, 97))
    else:
        ax = float(np.mean(xs))
        ay = float(np.mean(ys))
    # top of the opening at the exit (E/W): the lintel above it spans the walker's head as it steps out
    top_exit = float(np.percentile(ys[band], 4)) if facing in ('E', 'W') else None
    return {'mask': mask, 'exit': exit_p, 'depth': exit_p - lo, 'anchor': (ax, ay), 'bbox': mask.getbbox(),
            'top_exit': top_exit}


def mouth_threshold(mouth, facing):
    """Threshold of a side-facing (E / W) gate opening, sprite px: the floor line of the dark mouth
    (the lowest mouth pixel of each column) from its near post to its far post, and its midpoint.

    The side gates are painted in 3/4 view: the opening's floor runs diagonally from the front post's
    foot to the back post's foot. A road seen entering the gate crosses that line; centring it on the
    line's midpoint makes it run straight into the darkness (owner feedback 2026-11-18). Returns
    dict(mid=(x, y), a=(x, y), b=(x, y)) or None for S / N (their floor is already level)."""
    if facing not in ('E', 'W'):
        return None
    arr = np.asarray(mouth['mask']) > 0
    ys, xs = np.nonzero(arr)
    x0, x1 = float(np.percentile(xs, 4)), float(np.percentile(xs, 96))
    floor = {}
    for x in range(int(x0), int(x1) + 1):
        col = np.nonzero(arr[:, x])[0]
        if len(col):
            floor[x] = float(np.percentile(col, 97))

    def floor_at(x):
        win = [floor[c] for c in range(int(x) - 3, int(x) + 4) if c in floor]
        return float(np.median(win)) if win else float(np.percentile(ys, 97))

    xm = (x0 + x1) / 2
    return {'mid': (xm, floor_at(xm)), 'a': (x0, floor_at(x0 + 3)), 'b': (x1, floor_at(x1 - 3))}


def seat_point(mouth, facing, seat):
    """Sprite point of the opening the road centreline is aimed through (see place_gate), or None
    to keep the legacy exit anchor."""
    if seat == 'exit' or facing not in ('E', 'W'):
        return None
    if seat == 'threshold':
        return mouth_threshold(mouth, facing)['mid']
    if seat == 'centre':
        # middle of the opening's cross-section at the exit: between the lintel and the floor
        th = mouth_threshold(mouth, facing)
        floor_exit = th['b'][1] if facing == 'E' else th['a'][1]
        ax = mouth['anchor'][0]
        return ax, (mouth['top_exit'] + floor_exit) / 2
    if seat.startswith('mix'):
        # mix<f>: f of the way from the threshold midpoint to the exit centre
        f = float(seat[3:])
        a = seat_point(mouth, facing, 'threshold')
        b = seat_point(mouth, facing, 'centre')
        return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
    raise ValueError(f'unknown gate seat {seat}')


def spawn_depth(mouth, sx, sy, ux, uy, cap):
    """Sprite px to step back from (sx, sy) against the road direction (ux, uy) so the path end sits
    well inside the dark (the middle of the first run of eroded-mouth pixels on that line, at most
    `cap`). None when the line never enters the opening."""
    inside = np.asarray(mouth['mask'].filter(ImageFilter.MinFilter(9))) > 0
    h, w = inside.shape
    run = []
    for t in np.arange(0.0, 4.0 * max(8.0, mouth['depth']), 1.0):
        x, y = round(sx - ux * t), round(sy - uy * t)
        ok = 0 <= x < w and 0 <= y < h and inside[y, x]
        if ok:
            run.append(t)
        elif run:
            break
    if not run:
        return None
    return min((run[0] + run[-1]) / 2, max(run[0], cap))


def place_gate(im_src: Image.Image, flip: bool, point, facing, height_layout, inset_layout, along=None, fit_opening=False,
               seat='exit'):
    """Flip / measure a gate and compute where it goes (layout px).

    Returns dict(im (source px), k (source px -> layout px), left, top, rect, mouth, facing, seat).

    seat='exit' (legacy): the path end `point` ends up `inset_layout` px inside the mouth's exit,
    measured along `along` (the unit direction of the road leaving the gate: the walkers' own line),
    else along the facing; the exit anchor is the bottom of the mouth at its far edge.
    seat='threshold' / 'centre' / 'mix<f>' (side gates, E / W): the road centreline is aimed
    through that point of the opening (seat_point), and the path end sits inside the dark on the
    same line (spawn_depth). S / N gates always use the exit anchor (their floor is level)."""
    im = im_src.transpose(Image.FLIP_LEFT_RIGHT) if flip else im_src
    mouth = measure_mouth(im, facing)
    k = height_layout / im.height  # sprite px -> layout px
    vx, vy = FACING_VEC[facing]
    ax, ay = mouth['anchor']
    # anchor (exit middle, layout px) = point + facing * inset
    ux, uy = along if along is not None else (vx, vy)
    tx, ty = point[0] + ux * inset_layout, point[1] + uy * inset_layout
    left = tx - ax * k
    top = ty - ay * k
    seated = None
    # A road arriving from above the floor line (e.g. down onto a west castle's door) cannot cross
    # the threshold from outside: fall back toward the middle of the opening.
    ladder = [seat, 'mix0.5', 'centre'] if seat == 'threshold' else [seat]
    for s_ in ladder:
        sp = seat_point(mouth, facing, s_)
        if sp is None:
            break
        t = spawn_depth(mouth, sp[0], sp[1], ux, uy, inset_layout / k)
        if t is not None:
            seated = sp
            left = point[0] - (sp[0] - ux * t) * k
            top = point[1] - (sp[1] - uy * t) * k
            break
    if fit_opening:
        # A diagonal approach can put the intended inset below an oblique painted sill.
        # Move the artwork just enough to seat the fixed endpoint inside the open aperture.
        x, y = (point[0] - left) / k, (point[1] - top) / k
        inside = mouth['mask'].filter(ImageFilter.MinFilter(9))
        if not (0 <= round(x) < im.width and 0 <= round(y) < im.height and inside.getpixel((round(x), round(y)))):
            ys, xs = np.nonzero(np.asarray(inside))
            if not len(xs):
                raise ValueError('gate opening is too narrow to seat the path endpoint')
            nearest = np.argmin((xs - x) ** 2 + (ys - y) ** 2)
            left, top = point[0] - xs[nearest] * k, point[1] - ys[nearest] * k
    return {'im': im, 'k': k, 'left': left, 'top': top, 'mouth': mouth, 'facing': facing, 'seat': seated, 'along': (ux, uy),
            'point': tuple(point), 'threshold': mouth_threshold(mouth, facing) if seated else None,
            'rect': (left, top, left + im.width * k, top + im.height * k)}


def blend_placement(g_from, g_to, f):
    """Placement f of the way from `g_from` to `g_to` (same sprite, translation only); keeps the
    seat / threshold of `g_to` (they are sprite px, so the road clip follows the art)."""
    left = g_from['left'] + (g_to['left'] - g_from['left']) * f
    top = g_from['top'] + (g_to['top'] - g_from['top']) * f
    w, h = g_to['im'].width * g_to['k'], g_to['im'].height * g_to['k']
    return {**g_to, 'left': left, 'top': top, 'rect': (left, top, left + w, top + h), 'blend': f}


def point_in_opening(g, point, erode=9):
    """True when a layout point lies inside the (eroded) dark opening of a placed gate."""
    x, y = (point[0] - g['left']) / g['k'], (point[1] - g['top']) / g['k']
    inside = g['mouth']['mask'].filter(ImageFilter.MinFilter(erode))
    xi, yi = round(x), round(y)
    return 0 <= xi < inside.width and 0 <= yi < inside.height and inside.getpixel((xi, yi)) > 0


def seat_layout(g):
    """Seat point of a placed gate in layout px (None for the legacy exit anchor)."""
    if g.get('seat') is None:
        return None
    return g['left'] + g['seat'][0] * g['k'], g['top'] + g['seat'][1] * g['k']


def clip_road_at_gate(road: Image.Image, g, S: float, rw: float):
    """Ends the painted road at a seated gate's threshold (in place, output px). Removed: road
    pixels on the inner side of the threshold line (the side of the path end), and any deeper along
    the road than the threshold's deepest end (the round end cap). Within 1.3 road widths of the
    seat point only. The spline still runs on to the path end inside the gate; this only stops road
    peeking out under the gate's transparent base corners, so the road ends flush with the door's
    floor line (owner feedback 2026-11-18: castle road ended below the door)."""
    m = seat_layout(g)
    th = g.get('threshold')
    if m is None or th is None:
        return
    k = g['k']

    def lay(p):
        return (g['left'] + p[0] * k) * S, (g['top'] + p[1] * k) * S

    mx, my = lay(g['seat'])
    (axp, ayp), (bxp, byp) = lay(th['a']), lay(th['b'])
    px, py = g['point'][0] * S, g['point'][1] * S
    ux, uy = g['along']
    r = rw * 1.3
    x0, y0 = max(0, int(mx - r - 2)), max(0, int(my - r - 2))
    x1, y1 = min(road.width, int(mx + r + 3)), min(road.height, int(my + r + 3))
    if x1 <= x0 or y1 <= y0:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    # signed distance to the threshold line, positive on the path end's (inner) side
    ex, ey = bxp - axp, byp - ayp
    n = math.hypot(ex, ey) or 1.0
    side = 1.0 if (ex * (py - ayp) - ey * (px - axp)) >= 0 else -1.0
    inner = side * (ex * (yy - ayp) - ey * (xx - axp)) / n
    # ...only across the threshold's own span (the line extended would cut the approach road)
    along_t = ((xx - axp) * ex + (yy - ayp) * ey) / n
    inner = np.where((along_t >= -2) & (along_t <= n + 2), inner, -1e9)
    # depth along the road beyond the deepest threshold end
    deepest = min((axp - mx) * ux + (ayp - my) * uy, (bxp - mx) * ux + (byp - my) * uy)
    beyond = deepest - ((xx - mx) * ux + (yy - my) * uy)
    cut = np.maximum(inner, beyond)
    keep = np.clip(0.5 - cut / 1.5, 0, 1)  # ~1.5 px soft edge
    near = (xx - mx) ** 2 + (yy - my) ** 2 <= r * r
    keep = np.where(near, keep, 1.0)
    win = np.asarray(road.crop((x0, y0, x1, y1))).astype(np.float32)
    road.paste(Image.fromarray((win * keep).astype(np.uint8), 'L'), (x0, y0))


def draw_threshold_road(draw, path, gate, scale, width, exit_blend=0):
    """Ease both edges of a new lane out of the measured doorway into the full road.

    The sill in a nearly front-facing painting can run almost parallel to the road.
    Starting a full-width stroke there leaves a square corner below the near jamb.
    """
    sill = gate['threshold']
    start = path[0]
    join = next((i for i, point in enumerate(path[:-1]) if math.dist(start, point) >= width * 1.6), None)
    if join is None or sill is None:
        return False
    x, y = path[join]
    tx, ty = _unit(x - path[join - 1][0], y - path[join - 1][1])
    nx, ny = -ty, tx
    # A threshold may have a painted floor between the dark interior and the turf.
    # Extend the road under its ground edge, including the near jamb.
    alpha = np.asarray(gate['im'].getchannel('A'))
    posts = []
    for px, py in (sill['a'], sill['b']):
        ground = np.flatnonzero(alpha[:, round(px)] > 128)
        if ground.size:
            py = max(py, ground[-1] - 3)
        posts.append(((gate['left'] + px * gate['k']) * scale, (gate['top'] + py * gate['k']) * scale))
    # The first brush strokes lead out of the opening before bending along the lane.
    dx, dy = posts[1][0] - posts[0][0], posts[1][1] - posts[0][1]
    ux, uy = _unit(-dy, dx)
    if uy < 0:
        ux, uy = -ux, -uy
    posts.sort(key=lambda point: -point[0] * uy + point[1] * ux)
    # Overlap the curved underside of the painting. A straight chord between
    # the two lowest posts alone can leave a crescent of grass in the doorway.
    under = [(px - ux * width * .22, py - uy * width * .22) for px, py in posts]
    draw.polygon(posts + under[::-1], fill=255)
    if exit_blend:
        # An oblique opening can lead straight onto the lane. Turn the
        # approach toward that lane while keeping both jambs in place.
        ux, uy = _unit(ux*(1-exit_blend) + tx*exit_blend, uy*(1-exit_blend) + ty*exit_blend)
    edges = []
    for sign, (sx, sy) in zip((-1, 1), posts):
        ex, ey = x + sign * nx * width / 2, y + sign * ny * width / 2
        # A cubic starts along the emerging lane and finishes tangent to the spline.
        reach = math.dist((sx, sy), (ex, ey)) / 3
        controls = np.array([(sx, sy), (sx + ux * reach, sy + uy * reach),
                             (ex - tx * reach, ey - ty * reach), (ex, ey)])
        edge = []
        for t in np.linspace(0, 1, 13):
            a = 1 - t
            weights = [a**3, 3 * a**2 * t, 3 * a * t**2, t**3]
            edge.append(tuple(weights @ controls))
        edges.append(edge)
    draw.polygon(edges[0] + edges[1][::-1], fill=255)
    draw.line(path[join:], fill=255, width=round(width), joint='curve')
    return True


def gate_alpha_hit(g, rect, pad=0.0, thresh=40):
    """True when any painted pixel (alpha > thresh) of a placed gate lies inside rect (layout px, +pad)."""
    k = g['k']
    x0 = max(0, math.floor((rect[0] - pad - g['left']) / k))
    y0 = max(0, math.floor((rect[1] - pad - g['top']) / k))
    x1 = min(g['im'].width, math.ceil((rect[2] + pad - g['left']) / k))
    y1 = min(g['im'].height, math.ceil((rect[3] + pad - g['top']) / k))
    if x1 <= x0 or y1 <= y0:
        return False
    return g['im'].getchannel('A').crop((x0, y0, x1, y1)).point(lambda v: 255 if v > thresh else 0).getbbox() is not None


def output_box(g, S: float):
    """Integer output-px box (x0, y0, w, h) of a placed gate (the bake and the front cut share it)."""
    k = g['k'] * S
    return round(g['left'] * S), round(g['top'] * S), round(g['im'].width * k), round(g['im'].height * k)


def output_sprite(g, S: float, finish=None) -> Image.Image:
    _, _, w, h = output_box(g, S)
    art = g['im']
    if finish is not None:
        # The finish is registered to the facing seen in play. Take only its
        # colour, preserving the measured silhouette and the open passage.
        if finish.size != art.size:
            raise ValueError(f'gate finish {finish.size} does not fit {art.size}')
        opacity = finish.getchannel('A')
        opacity.paste(0, mask=g['mouth']['mask'])
        art = Image.composite(finish, art, opacity)
        art.putalpha(g['im'].getchannel('A'))
    return art.resize((w, h), Image.LANCZOS)


def contact_shadow(g, S: float, rw: float):
    """Ground contact shadow of a placed gate (output px): its own silhouette, nudged down / right
    (light from the upper left) and softened, strongest along the base. Returns (L image, (x0, y0)).
    Replaces the generic ellipse, so the castle and caves sit on the ground instead of floating."""
    x0, y0, w, h = output_box(g, S)
    a = g['im'].getchannel('A').resize((w, h), Image.LANCZOS)
    pad = round(rw * 0.5)
    canvas = Image.new('L', (w + 2 * pad, h + 2 * pad))
    canvas.paste(a, (pad + round(rw * 0.06), pad + round(rw * 0.10)))
    soft = canvas.filter(ImageFilter.GaussianBlur(rw * 0.09))
    # weight toward the base: the lower part of the silhouette casts, the top does not
    ramp = np.clip((np.arange(h + 2 * pad, dtype=np.float32) - pad - h * 0.55) / (h * 0.35), 0, 1)
    arr = np.asarray(soft).astype(np.float32) * ramp[:, None]
    # a tighter, darker occlusion line right at the foot
    tight = np.asarray(canvas.filter(ImageFilter.GaussianBlur(rw * 0.03))).astype(np.float32) * (ramp[:, None] ** 3)
    out = np.maximum(arr * 0.75, tight)
    return Image.fromarray(out.clip(0, 255).astype(np.uint8), 'L'), (x0 - pad, y0 - pad)


def light_interior(sprite: Image.Image, g, floor_rgb=(118, 82, 48)):
    """Tint the dark passage gradually with reflected light from its approach material."""
    w, h = sprite.size
    mo = np.asarray(g['mouth']['mask'].resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    if mo.max() <= 0:
        return sprite
    ys = np.nonzero(mo > 0.5)[0]
    top, bot = float(ys.min()), float(ys.max())
    yy = np.arange(h, dtype=np.float32)[:, None]
    t = np.clip((yy - top) / max(1.0, bot - top), 0, 1)  # 0 at the lintel, 1 at the floor
    back = np.array((26, 17, 12), np.float32)
    fl = np.array(floor_rgb, np.float32) * 0.62
    tint = back + (fl - back) * (t ** 2.2)[..., None]
    rgba = np.asarray(sprite).astype(np.float32)
    k = (mo * 0.85)[..., None]
    rgba[..., :3] = rgba[..., :3] * (1 - k) + np.maximum(rgba[..., :3], tint) * k
    return Image.fromarray(rgba.clip(0, 255).astype(np.uint8), 'RGBA')


def cut_front(canvas: Image.Image, g, S: float, exit_cut=True, shade_max=0.93, feather=1.2):
    """Front layer of a placed gate from the final composite (output px). Returns (RGBA image,
    (x0, y0) output px of its top-left).

    exit_cut: keep only the inner side of the exit line (caves: the far door post / lintel end
    beyond the exit stand behind a walker stepping out). Off for castles, whose towers beside the
    gate are in front of the approach road."""
    x0, y0, w, h = output_box(g, S)
    k = w / g['im'].width
    alpha = g['im'].getchannel('A').resize((w, h), Image.LANCZOS)
    mouth = g['mouth']['mask'].resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(feather))
    vx, vy = FACING_VEC[g['facing']]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    proj = (xx * vx + yy * vy) / k  # sprite px along the facing
    exit_p, depth = g['mouth']['exit'], max(1.0, g['mouth']['depth'])
    # keep the inner side of the exit line (soft over ~3 output px)
    soft = 3.0 / k
    keep = np.clip((exit_p + soft - proj) / (2 * soft), 0, 1) if exit_cut else np.ones_like(proj)
    te = g['mouth'].get('top_exit')
    if exit_cut and te is not None:
        # the lintel / rock above the opening stays in front beyond the exit line too (a walker
        # stepping out passes under it); only the door post below it stands behind the walker
        above = np.clip((te - yy / k) / (2 * soft) + 0.5, 0, 1)
        keep = np.maximum(keep, above)
    a = np.asarray(alpha).astype(np.float32) / 255
    mo = np.asarray(mouth).astype(np.float32) / 255
    rock = a * (1 - mo) * keep
    # shading over the mouth: dark deep inside, clear at the exit
    t = np.clip((exit_p - proj) / (0.55 * depth), 0, 1)
    shade = mo * a * shade_max * (t ** 0.7)
    fa = np.maximum(rock, shade)
    crop = canvas.crop((x0, y0, x0 + w, y0 + h)).convert('RGB')
    rgb = np.asarray(crop).astype(np.float32)
    # the mouth part darkens toward the inside (the baked interior is already near black)
    dim = 1 - 0.35 * (mo * t)[..., None]
    rgb = rgb * dim
    out = np.dstack([rgb, fa[..., None] * 255]).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(out, 'RGBA')
    bb = img.getchannel('A').point(lambda v: 255 if v > 2 else 0).getbbox()
    if bb is None:
        return None, (x0, y0)
    img = img.crop(bb)
    return img, (x0 + bb[0], y0 + bb[1])
