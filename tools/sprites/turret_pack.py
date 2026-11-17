#!/usr/bin/python3
"""Aimable turrets: packs a directional tower's BODY + TURRET art for the 2D renderer.

usage:
  /usr/bin/python3 tools/sprites/turret_pack.py [--raw DIR] [--out DIR] [--only cannon-1,...]
        [--mount X,Y] [--muzzle DIR=X,Y ...] [--scale N|platform] [--overrides FILE|none]
        [--placeholder] [--dry]

Per-asset fixes for what the measurements below get wrong live in tools/sprites/turret_overrides.json
({"cannon-1": {"mount": [x, y], "muzzle": {"S": [x, y]}, "scale": 1}}, raw px), so a re-pack is
reproducible; CLI flags win over it. Pass --overrides none for other art (e.g. the placeholders).

Input (per type-tier, in --raw, default design/art-2d/v2/raw):
  <type>-<tier>-body.png    1024x1024 (any size works), magenta background. The tower with an EMPTY
                            top platform, standing on the plot's stone ring (same convention as the
                            tower-*.webp sprites, so the renderer's ring fit applies unchanged).
  <type>-<tier>-turret.png  2560x512 = 5 panels of 512 px: S, SE, E, NE, N (the piece facing the
                            camera, lower-right, right, upper-right, away). W/SW/NW are drawn by
                            mirroring E/SE/NE, so paint the piece symmetric about its foot.
Output (--out, default public/art2d/turrets):
  <type>-<tier>-body.webp, <type>-<tier>-turret.webp (5 frames side by side, S SE E NE N),
  <type>-<tier>-turret.json:
    { frameW, frameH, count: 5, dirs: [S,SE,E,NE,N], pivot: [x,y] (the piece's foot, frame px),
      muzzle: [[dx,dy] x5] (barrel / arrow tip relative to the pivot, frame px),
      body: "<file>", bodyMount: [x,y] (platform centre, body px), bodyRing: {ringWidthPx,...},
      scale (turret px -> body px), placeholder? }

Measurements:
  * keying: magenta -> alpha with the same soft edge and de-spill as design/art-2d/key.py.
  * body mount (the empty platform's top centre): scanning down from the silhouette top within its
    top 35 %, the first solid row (>= 90 % opaque across its span: merlons / railings are skipped)
    that is >= 75 % as wide as the band's widest row and not narrower than any of the next 6 rows =
    the platform rim's equator; mount = the centre of that row's run.
    --mount X,Y (raw body px) overrides it (only with a single --only entry).
  * turret foot: bottom-centre of the piece's CHUNKY part: the panel mask is eroded by ~2.5 % of the
    panel (bow limbs, strings, a bolt aimed at the camera, thin barrel lips vanish; the carriage /
    stand stays); x = centre of the eroded mask's lowest 6 %, y = the silhouette bottom under it.
    All 5 panels are aligned on that foot and trimmed to one common box, symmetric about the foot
    (so mirroring about the pivot is exact).
  * muzzle (per direction): over opaque pixels (alpha > 128), seen from their centroid: the pixels
    within 35 deg of the aim direction (S=(0,1), SE=(.71,.71), E=(1,0), NE=(.71,-.71), N=(0,-1),
    screen space), the farthest along it; muzzle = mean position of those within 3 px of the
    maximum (one keying speck cannot win), stored relative to the pivot.
    --muzzle S=X,Y overrides one direction (raw panel px, i.e. 0..511 within that panel).
  * scale: turret px -> body px, default 1 (turret painted at the body's pixel density). "platform"
    = 0.9 * platform width (body, at the mount row) / widest panel; printed either way. Both
    images are resampled by the same factor (body longest side capped at 512 px, like key.py), so
    the ratio survives.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/map-compose'))
from ringfit import measure_ring  # noqa: E402

DIRS = ['S', 'SE', 'E', 'NE', 'N']
DIR_VEC = {'S': (0.0, 1.0), 'SE': (0.7071, 0.7071), 'E': (1.0, 0.0), 'NE': (0.7071, -0.7071), 'N': (0.0, -1.0)}
PANEL = 512
ALPHA = 128
BODY_MAX = 512
MARGIN = 8


def key_rgba(im):
    """Magenta chroma key (same thresholds as design/art-2d/key.py), vectorised."""
    a = np.asarray(im.convert('RGBA')).astype(np.int32).copy()
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    m = np.minimum(r, b) - g
    full = (m > 90) & (r > 120) & (b > 120)
    soft = ~full & (m > 35) & (r > 90) & (b > 90)
    spill = ~full & ~soft & (m > 15) & (r > 80) & (b > 80)
    t = np.clip((m - 35) / 55.0, 0, 1)
    out = a.copy()
    out[soft, 3] = (al * (1 - t))[soft].astype(np.int32)
    out[soft, 0] = np.minimum(r, g + ((r - g) * 0.35).astype(np.int32))[soft]
    out[soft, 2] = np.minimum(b, g + ((b - g) * 0.35).astype(np.int32))[soft]
    out[spill, 0] = np.minimum(r, g + 20)[spill]
    out[spill, 2] = np.minimum(b, g + 20)[spill]
    out[full] = 0
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def opaque(im):
    return np.asarray(im.getchannel('A')) > ALPHA


def row_runs(mask):
    """Per row: (lo, hi) of the opaque span, or None."""
    out = []
    for row in mask:
        xs = np.flatnonzero(row)
        out.append((int(xs[0]), int(xs[-1])) if xs.size else None)
    return out


def body_mount(mask):
    """(x, y, platform width) of the empty platform's centre, body px.

    Scanning down from the silhouette top (within its top 35 %), the platform rim widens to its
    equator and then gives way to the (narrower, or at least not wider) wall below: the first row
    that is at least 75 % as wide as the band's widest row and not narrower than any of the next 6
    rows is the rim's equator = the platform centre. Only solid rows count (>= 90 % opaque across
    their span), so merlons / railings above the rim are skipped.
    """
    runs = row_runs(mask)
    ys = [y for y, r in enumerate(runs) if r]
    top, bottom = ys[0], ys[-1]
    band_end = top + int((bottom - top) * 0.35)
    def solid_w(y):
        # Width of the row's span, counted only when the span is solid (a row through merlons or a
        # railing is gappy and is not the rim's equator).
        r = runs[y]
        if not r:
            return 0
        n = r[1] - r[0] + 1
        return n if mask[y, r[0]:r[1] + 1].sum() >= 0.9 * n else 0

    w = {y: solid_w(y) for y in range(top, band_end + 8)}
    wmax = max(w[y] for y in range(top, band_end + 1))
    pick = band_end
    for y in range(top, band_end + 1):
        if w[y] >= wmax * 0.75 and all(w[y] >= w[y + j] for j in range(1, 7)):
            pick = y
            break
    lo, hi = runs[pick]
    return (lo + hi + 1) / 2, float(pick), float(hi - lo + 1)


def erode(mask, k):
    """Binary erosion with a (2k+1)^2 square (integral image; no scipy needed)."""
    h, w = mask.shape
    ii = np.zeros((h + 1, w + 1), np.int32)
    ii[1:, 1:] = mask.astype(np.int32).cumsum(0).cumsum(1)
    out = np.zeros_like(mask)
    y0, y1 = k, h - k
    x0, x1 = k, w - k
    if y1 <= y0 or x1 <= x0:
        return out
    win = ii[y0 + k + 1:y1 + k + 1, x0 + k + 1:x1 + k + 1] - ii[y0 - k:y1 - k, x0 + k + 1:x1 + k + 1] \
        - ii[y0 + k + 1:y1 + k + 1, x0 - k:x1 - k] + ii[y0 - k:y1 - k, x0 - k:x1 - k]
    out[y0:y1, x0:x1] = win == (2 * k + 1) ** 2
    return out


def foot_of(mask):
    """(x, y) = the piece's foot: bottom-centre of its CHUNKY part.

    Thin parts (bow limbs, strings, a bolt or arrow pointing at the camera, a barrel lip) can hang
    below the stand in some views, so the mask is first eroded by ~2.5 % of the panel: what is left
    is the carriage / stand / body. Foot x = centre of the eroded mask's bottom band (its lowest 6 %),
    foot y = the original silhouette's bottom under that band.
    """
    if not mask.any():
        return None
    k = max(2, round(mask.shape[0] * 0.025))
    core = erode(mask, k)
    while not core.any() and k > 1:
        k //= 2
        core = erode(mask, k)
    if not core.any():
        core = mask
    ys = np.flatnonzero(core.any(axis=1))
    top, bottom = ys[0], ys[-1]
    band = core[max(top, bottom - max(2, int((bottom - top) * 0.06))):bottom + 1]
    cols = np.flatnonzero(band.any(axis=0))
    lo, hi = cols[0], cols[-1]
    x = (lo + hi + 1) / 2
    # Down from the core's bottom: the last row still at least half covered across the band.
    y = bottom
    for yy in range(bottom, min(mask.shape[0], bottom + 3 * k + 3)):
        if mask[yy, lo:hi + 1].sum() >= 0.5 * (hi - lo + 1):
            y = yy
    return float(x), float(y + 1)


def measure_muzzle(mask, pivot, d):
    """Barrel / bolt / arrow tip for aim direction d, relative to the pivot (frame px)."""
    yy, xx = np.nonzero(mask)
    yy, xx = yy + 0.5, xx + 0.5
    ox, oy = xx.mean(), yy.mean()
    vx, vy = xx - ox, yy - oy
    proj = vx * d[0] + vy * d[1]
    dist = np.hypot(vx, vy) + 1e-6
    cone = proj >= dist * math.cos(math.radians(35))
    if cone.any():
        xx, yy, proj = xx[cone], yy[cone], proj[cone]
    near = proj >= proj.max() - 3
    return [round(float(xx[near].mean() - pivot[0]), 2), round(float(yy[near].mean() - pivot[1]), 2)]


def parse_xy(s):
    x, y = s.split(',')
    return float(x), float(y)


def pack(raw, out, name, args):
    body_raw = key_rgba(Image.open(raw / f'{name}-body.png'))
    bmask = opaque(body_raw)
    ys, xs = np.nonzero(bmask)
    l, t, r, b = max(0, xs.min() - MARGIN), max(0, ys.min() - MARGIN), min(body_raw.width, xs.max() + 1 + MARGIN), min(body_raw.height, ys.max() + 1 + MARGIN)
    body = body_raw.crop((l, t, r, b))
    mx, my, platform_w = body_mount(opaque(body))
    ov = args.overrides_by_name.get(name, {})
    mount = parse_xy(args.mount) if args.mount else ov.get('mount')
    if mount:
        mx, my = mount[0] - l, mount[1] - t
    f = min(1.0, BODY_MAX / max(body.size))

    sheet = key_rgba(Image.open(raw / f'{name}-turret.png'))
    panels = [sheet.crop((i * PANEL, 0, (i + 1) * PANEL, PANEL)) for i in range(5)]
    feet, boxes = [], []
    for i, p in enumerate(panels):
        m = opaque(p)
        ft = foot_of(m)
        if ft is None:
            raise SystemExit(f'{name}: turret panel {DIRS[i]} is empty')
        feet.append(ft)
        yy, xx = np.nonzero(p.getchannel('A'))
        boxes.append((xx.min() - ft[0], yy.min() - ft[1], xx.max() + 1 - ft[0], yy.max() + 1 - ft[1]))
    half = math.ceil(max(max(-bx[0], bx[2]) for bx in boxes)) + MARGIN
    up = math.ceil(max(-bx[1] for bx in boxes)) + MARGIN
    down = math.ceil(max(0, max(bx[3] for bx in boxes))) + MARGIN
    fw0, fh0 = 2 * half, up + down
    widest = max(bx[2] - bx[0] for bx in boxes)
    fit_scale = 0.9 * platform_w / max(1.0, widest)
    sc = args.scale if args.scale is not None else str(ov.get('scale', 1))
    scale = fit_scale if sc == 'platform' else float(sc)
    scale = max(0.25, min(4.0, scale))

    fw, fh = max(1, round(fw0 * f)), max(1, round(fh0 * f))
    pivot = (fw / 2, up * f)
    frames = []
    for i, p in enumerate(panels):
        fr = Image.new('RGBA', (fw0, fh0))
        fr.alpha_composite(p, (round(half - feet[i][0]), round(up - feet[i][1])))
        if f < 1:
            fr = fr.resize((fw, fh), Image.LANCZOS)
        frames.append(fr)
    muzzle = []
    overrides = {k: tuple(v) for k, v in ov.get('muzzle', {}).items()}
    overrides.update({k: parse_xy(v) for k, v in (o.split('=', 1) for o in (args.muzzle or []))})
    for i, fr in enumerate(frames):
        d = DIRS[i]
        if d in overrides:
            ox, oy = overrides[d]
            muzzle.append([round((ox - feet[i][0]) * f, 2), round((oy - feet[i][1]) * f, 2)])
        else:
            muzzle.append(measure_muzzle(opaque(fr), pivot, DIR_VEC[d]))
    strip = Image.new('RGBA', (fw * 5, fh))
    for i, fr in enumerate(frames):
        strip.alpha_composite(fr, (i * fw, 0))

    if f < 1:
        body = body.resize((round(body.width * f), round(body.height * f)), Image.LANCZOS)
    ring = measure_ring(body)
    meta = {
        'image': f'{name}-turret.webp',
        'frameW': fw,
        'frameH': fh,
        'count': 5,
        'dirs': DIRS,
        'pivot': [round(pivot[0], 2), round(pivot[1], 2)],
        'muzzle': muzzle,
        'body': f'{name}-body.webp',
        'bodyMount': [round(mx * f, 2), round(my * f, 2)],
        'bodyRing': ring,
        'scale': round(scale, 4),
    }
    if args.placeholder:
        meta['placeholder'] = True
    print(f'{name}: body {body.size} mount {meta["bodyMount"]} ring {ring["ringWidthPx"]:.0f}@{ring["ringBottomPx"]:.0f} | '
          f'turret {fw}x{fh} pivot {meta["pivot"]} scale {meta["scale"]} (platform fit would be {fit_scale:.3f}) | muzzle {muzzle}')
    if args.dry:
        return
    out.mkdir(parents=True, exist_ok=True)
    body.save(out / f'{name}-body.webp', quality=92, method=6)
    strip.save(out / f'{name}-turret.webp', quality=92, method=6)
    (out / f'{name}-turret.json').write_text(json.dumps(meta, indent=1) + '\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--raw', default=str(ROOT / 'design/art-2d/v2/raw'))
    ap.add_argument('--out', default=str(ROOT / 'public/art2d/turrets'))
    ap.add_argument('--only', default='')
    ap.add_argument('--mount')
    ap.add_argument('--muzzle', action='append')
    ap.add_argument('--scale', default=None)
    ap.add_argument('--overrides', default=str(Path(__file__).with_name('turret_overrides.json')))
    ap.add_argument('--placeholder', action='store_true')
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()
    raw, out = Path(args.raw), Path(args.out)
    ovf = Path(args.overrides)
    args.overrides_by_name = json.loads(ovf.read_text()) if args.overrides != 'none' and ovf.exists() else {}
    args.overrides_by_name = {k: v for k, v in args.overrides_by_name.items() if not k.startswith('_')}
    names = sorted(p.name[:-len('-body.png')] for p in raw.glob('*-body.png') if (raw / p.name.replace('-body.png', '-turret.png')).exists())
    if args.only:
        want = set(args.only.split(','))
        names = [n for n in names if n in want]
    if (args.mount or args.muzzle) and len(names) != 1:
        raise SystemExit('--mount / --muzzle need exactly one --only entry')
    if not names:
        raise SystemExit(f'no <type>-<tier>-body.png + -turret.png pairs in {raw}')
    for n in names:
        pack(raw, out, n, args)


if __name__ == '__main__':
    main()
