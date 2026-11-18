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
from pathlib import Path

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


def entrance_facing(path):
    return facing_from_dir(*_first_step(path, 0, 1))


def goal_facing(path):
    return facing_from_dir(*_first_step(path, len(path) - 1, -1))


def resolve_prop(kind, facing, assets: Path):
    """(file name, flip) of the gate art for `kind` (cave / castle) facing `facing`.
    Uses the mirrored art for E <-> W when only one exists; else the nearest available facing."""
    if (assets / f'gate-{kind}-{facing.lower()}.png').exists():
        return f'{kind}-{facing.lower()}', f'gate-{kind}-{facing.lower()}.png', False
    m = MIRROR[facing]
    if m != facing and (assets / f'gate-{kind}-{m.lower()}.png').exists():
        return f'{kind}-{facing.lower()}', f'gate-{kind}-{m.lower()}.png', True
    for f in ('S', 'E', 'W', 'N'):
        if (assets / f'gate-{kind}-{f.lower()}.png').exists():
            print(f'  warning: no {kind} art facing {facing}, using {f}')
            return f'{kind}-{f.lower()}', f'gate-{kind}-{f.lower()}.png', False
    raise FileNotFoundError(f'no gate-{kind}-*.png in {assets}')


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


def place_gate(im_src: Image.Image, flip: bool, point, facing, height_layout, inset_layout):
    """Flip / measure a gate and compute where it goes (layout px).

    Returns dict(im (source px), k (source px -> layout px), left, top, rect, mouth, facing). The
    path end `point` ends up `inset_layout` px inside the mouth's exit."""
    im = im_src.transpose(Image.FLIP_LEFT_RIGHT) if flip else im_src
    mouth = measure_mouth(im, facing)
    k = height_layout / im.height  # sprite px -> layout px
    vx, vy = FACING_VEC[facing]
    ax, ay = mouth['anchor']
    # anchor (exit middle, layout px) = point + facing * inset
    tx, ty = point[0] + vx * inset_layout, point[1] + vy * inset_layout
    left = tx - ax * k
    top = ty - ay * k
    return {'im': im, 'k': k, 'left': left, 'top': top, 'mouth': mouth, 'facing': facing,
            'rect': (left, top, left + im.width * k, top + im.height * k)}


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


def output_sprite(g, S: float) -> Image.Image:
    _, _, w, h = output_box(g, S)
    return g['im'].resize((w, h), Image.LANCZOS)


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
