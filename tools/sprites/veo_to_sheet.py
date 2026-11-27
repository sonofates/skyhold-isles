#!/usr/bin/python3
"""Video walk cycle (character walking in place on a flat magenta background) → looping sprite sheet.

usage: /usr/bin/python3 tools/sprites/veo_to_sheet.py <clip.mp4> <out_prefix> [--fps 12] [--height 256] [--max-seconds 4]

Steps: ffmpeg frames → chroma key (magenta-ness, soft edge, despill) → per-frame feet anchor
(bottom-centre of the alpha bbox) → best loop (frames i..j with the smallest difference between
frame i and frame j, cycle length --min-seconds (0.6)–1.6 s) → align on the feet anchor → crop to the union box →
scale to --height → grid PNG + JSON {frameW, frameH, count, fps, cols, anchor:[x,y]}.
Writes <out_prefix>.png, <out_prefix>.json and <out_prefix>-preview.gif.

Opt-in extras (added for the boss clips; without them the output is unchanged). Pixel values are in
the half-resolution working frame (640 × 360); source frame indices are at 24 fps after --start.
  --start S          skip the first S seconds of the clip (e.g. a turn before a back walk)
  --range A:B        take source frames A..B-1 as they are (one-shot death, hand-picked attack swing)
                     instead of searching for a loop; --loop-from A:B limits the loop search instead
  --pick a,b,c       take exactly these source frames, in this order (a swing with its hold shortened)
  --step N           sample every N-th source frame (default 24 / --fps)
  --play-fps F       fps written to the JSON (play a swing faster than it was filmed)
  --impact K         melee contact frame (index into the output frames) → JSON "impact"
  --core K           keep only opaque (alpha > 200) shapes that survive a K px erosion (regrown inside the
                     opaque mask), plus semi-transparent edge pixels within --edge px (default 3) of
                     them: drops the clip's own cast shadow (the game draws its own) and background specks
  --glow             with --core: also keep warm, bright semi-transparent light (halo corona, light
                     rays, embers) anywhere inside the crop box, or within --glow-reach px of the
                     body; that light is despilled (magenta excess removed, warmed) so it is not pink
  --fixed-anchor     anchor every frame at the first frame's feet (one-shots: the pile must not jump)
  --clip-box l,t,r,b limit the union box to this box around the anchor; alpha fades out over the last
                     --feather px (default 24) so rays / flying shards do not end on a hard edge
  --fill F           pad the top of the frame so the median figure height is F × frameH (keeps the
                     in-game size of a sheet it replaces: the renderer maps frameH × 0.94 to `height`)
  --fig-px H         scale so the first frame's figure is H sheet px tall (death sheets share the walk
                     "down" sheet's px scale), instead of fitting the union box to --height
  --recolor lo,hi,deg,sat  turn hues lo..hi by deg (tapered at the band edges) and scale their
                     saturation by sat (the back-walk clip whose cape came out in another colour)
  --webp Q           also write <out_prefix>.webp (quality Q) for public/art2d/anim
"""
import json, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageChops

args = sys.argv[1:]
clip, prefix = Path(args[0]), Path(args[1])
opt = {'--fps': 12, '--height': 256, '--max-seconds': 4.0, '--min-seconds': 0.6, '--max-cycle': 1.6,
       '--start': 0.0, '--range': '', '--pick': '', '--loop-from': '', '--step': 0, '--play-fps': 0.0, '--impact': -1,
       '--core': 0, '--edge': 3, '--glow-reach': 0, '--clip-box': '', '--feather': 24, '--fill': 0.0, '--fig-px': 0, '--webp': 0, '--recolor': ''}
for k in opt:
    if k in args:
        opt[k] = type(opt[k])(args[args.index(k) + 1])
SRC_FPS = 24

tmp = Path(tempfile.mkdtemp())
ff = ['ffmpeg', '-loglevel', 'error', '-i', str(clip)]
if opt['--start'] > 0:
    ff += ['-ss', str(opt['--start'])]
subprocess.run(ff + ['-t', str(opt['--max-seconds']), '-vf', f'fps={SRC_FPS}', str(tmp / 'f%04d.png')], check=True)
files = sorted(tmp.glob('f*.png'))


UNMIX = '--unmix' in args
STATIC = '--static' in args
GLOW = '--glow' in args
FIXED = '--fixed-anchor' in args
RANGE = tuple(int(v) for v in opt['--range'].split(':')) if opt['--range'] else None
PICK = [int(v) for v in opt['--pick'].split(',')] if opt['--pick'] else None
if PICK:
    RANGE = (PICK[0], max(PICK) + 1)
if RANGE:
    files = files[:RANGE[1]]  # later frames are never used


def key_unmix(im):
    """Magenta un-mixing for semi-transparent FX (smoke, glow, mist) that keeps the art opaque.

    "Magenta-ness" m = min(R,B) - G. Art (stone, wood, crystal, leaves) has m <= ~25 and stays fully
    opaque with its own colour. Pixels between art and the backdrop are treated as F over M:
    alpha = 1 - m / m_M (m_M measured from the frame border, since video shifts the backdrop),
    colour F = (P - (1-a)·M) / a. Pure backdrop becomes fully transparent.
    """
    im = im.convert('RGB')
    w, h = im.size
    src = im.load()
    border = [src[x, 0] for x in range(0, w, 7)] + [src[x, h - 1] for x in range(0, w, 7)] + [src[0, y] for y in range(0, h, 7)] + [src[w - 1, y] for y in range(0, h, 7)]
    M = [sorted(c[i] for c in border)[len(border) // 2] for i in range(3)]
    mM = max(60, min(M[0], M[2]) - M[1])
    out = Image.new('RGBA', (w, h))
    px = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            m = min(r, b) - g
            if m <= 25:
                px[x, y] = (r, g, b, 255)
                continue
            a = 1.0 - (m - 25) / max(1, mM - 25)
            if a < 0.06:
                px[x, y] = (0, 0, 0, 0)
                continue
            a = min(1.0, a)
            F = [(r - (1 - a) * M[0]) / a, (g - (1 - a) * M[1]) / a, (b - (1 - a) * M[2]) / a]
            if a < 0.55:  # faint smoke/glow: residual backdrop error shows as pink, pull toward grey
                lum = 0.3 * F[0] + 0.59 * F[1] + 0.11 * F[2]
                k = min(1.0, (0.55 - a) * 2.2)
                F = [f + (lum - f) * k for f in F]
            px[x, y] = (int(max(0, min(255, F[0]))), int(max(0, min(255, F[1]))), int(max(0, min(255, F[2]))), int(a * 255))
    return out


def key(im):
    if UNMIX:
        return key_unmix(im)
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            m = min(r, b) - g
            if m > 80 and r > 110 and b > 110:
                px[x, y] = (0, 0, 0, 0)
            elif m > 30 and r > 80 and b > 80:
                t = (m - 30) / 50.0
                px[x, y] = (min(r, g + int((r - g) * 0.35)), g, min(b, g + int((b - g) * 0.35)), int(a * (1 - t)))
            elif m > 12 and r > 70 and b > 70:
                px[x, y] = (min(r, g + 20), g, min(b, g + 20), a)
    return im


def _shift_max(a, out=None):
    """3 × 3 max filter (one dilation step) on a 2-D numpy array."""
    import numpy as np
    o = a.copy()
    o[1:, :] = np.maximum(o[1:, :], a[:-1, :]); o[:-1, :] = np.maximum(o[:-1, :], a[1:, :])
    p = o.copy()
    p[:, 1:] = np.maximum(p[:, 1:], o[:, :-1]); p[:, :-1] = np.maximum(p[:, :-1], o[:, 1:])
    return p


def core_mask(im, src=None):
    """--core: alpha of the figure only (cast shadow, specks and far debris removed), see the docstring."""
    import numpy as np
    arr = np.array(im)
    alpha = arr[:, :, 3].astype(int)
    lightsrc = np.zeros(alpha.shape, bool)
    if GLOW and src is not None:
        # Glow / light rays are pale gold light blended over the magenta: G rises and B falls, so
        # min(R,B) - G drops to "art" level and the unmix keys them as opaque salmon-pink paint.
        # Model them instead as light colour F over the backdrop M with alpha from the green rise
        # (F_G ~ 235), solve F per pixel, and call it light when F comes out as a bright warm colour
        # while the backdrop still shows through (B > 100: gold armour never has that much blue).
        s = np.array(src).astype(float)
        h, w = alpha.shape
        border = np.concatenate([s[0, ::7], s[h - 1, ::7], s[::7, 0], s[::7, w - 1]])
        M = np.median(border, axis=0)
        sr, sg, sb = s[:, :, 0], s[:, :, 1], s[:, :, 2]
        la = np.clip((sg - M[1]) / max(1.0, 235 - M[1]), 0, 1)
        safe = np.maximum(la, 0.05)
        Fr = (sr - (1 - la) * M[0]) / safe
        Fb = (sb - (1 - la) * M[2]) / safe
        lightsrc = (sg > M[1] + 14) & (la < 0.9) & (sr > 180) & (sb > 100) & (Fr > 180) & (Fb > -160) & (Fb < 235)
    solid = ((alpha > 200) & ~lightsrc).astype(np.uint8)
    # morphological reconstruction: erode the solid mask by --core px (specks and thin debris
    # vanish), then regrow the survivors inside the solid mask (thin parts attached to the body,
    # like fingers or a crown rim, come back; isolated specks do not)
    seed = solid.copy()
    for _ in range(opt['--core']):
        seed = 1 - _shift_max(1 - seed)
    for _ in range(64):
        nxt = _shift_max(seed) & solid
        if np.array_equal(nxt, seed):
            break
        seed = nxt
    body = seed
    grown = body
    for _ in range(opt['--edge']):
        grown = _shift_max(grown)
    ok = grown > 0
    if GLOW and src is not None:
        # highlights inside the body that looked like light (small holes) belong to the body
        closed = body
        for _ in range(4):
            closed = _shift_max(closed)
        for _ in range(4):
            closed = 1 - _shift_max(1 - closed)
        inside = closed > 0
        ok = inside | (ok & ~lightsrc)
        r, g, b = (arr[:, :, i].astype(int) for i in range(3))
        near = np.ones_like(ok)
        if opt['--glow-reach'] > 0:
            n8 = grown.copy()
            for _ in range(opt['--glow-reach']):
                n8 = _shift_max(n8)
            near = n8 > 0
        # opaque warm bits off the body (embers, corona flames): kept as they are
        ember = (alpha >= 200) & (r > 150) & (r - b > 45) & (g > 70) & near & ~ok & ~lightsrc
        light = lightsrc & near & ~inside
        # 1 px opening: single-pixel backdrop sparkle is not light
        lo = light.astype(np.uint8)
        lo = _shift_max(1 - _shift_max(1 - lo))
        light &= lo > 0
        # the solved colour is a yellow that reads green over dark ground; the clip shows it as
        # warm white over the backdrop, so paint it on a gold -> warm white ramp by strength
        arr[:, :, 0] = np.where(light, 255, arr[:, :, 0])
        arr[:, :, 1] = np.where(light, (200 + 40 * la).astype(int), arr[:, :, 1])
        arr[:, :, 2] = np.where(light, (110 + 90 * la).astype(int), arr[:, :, 2])
        alpha = np.where(light, (la * 255).astype(int), alpha)
        # leftover backdrop haze (semi-transparent, still magenta after unmixing) off the body
        haze = (alpha < 200) & (r - g > 70) & (b - g > 50) & ~inside & ~light
        ok = (ok | ember | light) & ~haze
        # ember glow edges: orange-red light over magenta unmixes to crimson; turn it orange
        crimson = ok & ~inside & ~light & (alpha < 230) & (r > 150) & (r - g > 90) & (b > g)
        arr[:, :, 1] = np.where(crimson, np.maximum(g, (r * 0.55).astype(int)), arr[:, :, 1])
        arr[:, :, 2] = np.where(crimson, np.minimum(b, g), arr[:, :, 2])
    arr[:, :, 3] = np.where(ok, alpha, 0)
    arr[~ok] = 0
    return Image.fromarray(arr, 'RGBA')


# work at half resolution for speed (640x360), the sprite ends up ~256 px tall anyway
step = opt['--step'] or max(1, round(SRC_FPS / opt['--fps']))
# one-shots / picks only key the frames they use (the core mask is slow on 100+ frames)
need = set(PICK) if PICK else set(range(RANGE[0], RANGE[1], step)) if RANGE else None
EMPTY = Image.new('RGBA', (640, 360), (0, 0, 0, 0))
frames = []
for n, f in enumerate(files):
    if need is not None and n not in need:
        frames.append(EMPTY)
        continue
    im = Image.open(f).convert('RGB').resize((640, 360), Image.LANCZOS)
    k = key(im)
    frames.append(core_mask(k, im) if opt['--core'] > 0 else k)

alphas = [f.getchannel('A') for f in frames]
boxes = [a.getbbox() for a in alphas]
anch = [((b[0] + b[2]) / 2, b[3]) if b else (320, 300) for b in boxes]
if STATIC:
    # towers don't move: anchor every frame at the same point (median of the opaque core's bottom),
    # so FX spilling below the base (mist, glow rings) cannot make the tower jitter
    cores = [f.getchannel('A').point(lambda v: 255 if v > 230 else 0).getbbox() for f in frames]
    cores = [c for c in cores if c]
    xs = sorted((c[0] + c[2]) / 2 for c in cores); ys = sorted(c[3] for c in cores)
    fixed = (xs[len(xs) // 2], ys[len(ys) // 2])
    anch = [fixed] * len(frames)

if RANGE:
    score, i0, j0 = 0.0, RANGE[0], RANGE[1]
    if FIXED:
        c0 = frames[i0].getchannel('A').point(lambda v: 255 if v > 200 else 0).getbbox() or boxes[i0]
        anch = [((c0[0] + c0[2]) / 2, c0[3])] * len(frames)
else:
    # loop search on small alpha+gray thumbnails, aligned on the feet anchor
    def thumb(i):
        ax, ay = anch[i]
        c = frames[i].crop((int(ax - 120), int(ay - 220), int(ax + 120), int(ay + 10))).resize((60, 58))
        return c

    th = [thumb(i) for i in range(len(frames))]
    def diff(i, j):
        d = ImageChops.difference(th[i], th[j])
        return sum(sum(p) for p in d.getdata()) / (60 * 58 * 4)

    best = None
    lo, hi = int(opt['--min-seconds'] * SRC_FPS), int(opt['--max-cycle'] * SRC_FPS)
    first, last = (0, min(len(frames) - lo, SRC_FPS)) if not opt['--loop-from'] else tuple(int(v) for v in opt['--loop-from'].split(':'))
    for i in range(first, min(last, len(frames) - lo)):
        for j in range(i + lo, min(len(frames), i + hi + 1)):
            s = diff(i, j)
            if best is None or s < best[0]:
                best = (s, i, j)
    score, i0, j0 = best
idx = PICK or list(range(i0, j0, step))
fps_out = opt['--play-fps'] or SRC_FPS / step

# union box around the anchor so frames stay aligned on the feet
L = T = 1e9; R = B = -1e9
for i in idx:
    b = boxes[i]; ax, ay = anch[i]
    if not b:
        continue
    L = min(L, b[0] - ax); R = max(R, b[2] - ax); T = min(T, b[1] - ay); B = max(B, b[3] - ay)
pad = 6
L, T, R, B = int(L - pad), int(T - pad), int(R + pad), int(B + pad)
if opt['--clip-box']:
    cl, ct, cr, cb = (int(v) for v in opt['--clip-box'].split(','))
    L, T, R, B = max(L, cl), max(T, ct), min(R, cr), min(B, cb)
# figure heights (alpha > 128 bbox) in working px, for --fill / --fig-px
fig_h = []
for i in idx:
    fb = alphas[i].point(lambda v: 255 if v > 128 else 0).getbbox()
    if fb:
        fig_h.append(fb[3] - fb[1])
fig_med = sorted(fig_h)[len(fig_h) // 2] if fig_h else 1
if opt['--fill'] > 0 and fig_med / (B - T) > opt['--fill']:
    T = int(B - fig_med / opt['--fill'])
cw, ch = R - L, B - T
if opt['--fig-px'] > 0:
    scale = opt['--fig-px'] / (fig_h[0] if fig_h else ch)
    fh = round(ch * scale)
else:
    scale = opt['--height'] / ch
    fh = opt['--height']
fw = round(cw * scale)


def feathered(c):
    """--clip-box: fade the alpha over the last --feather px at the box sides the figure was cut on."""
    import numpy as np
    arr = np.array(c).astype(np.float32)
    h, w = arr.shape[:2]
    f = max(1.0, opt['--feather'] * scale)
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.minimum.reduce([xx + 0.5, w - xx - 0.5, yy + 0.5, np.full((h, w), 1e9, np.float32)])  # bottom stays hard (ground)
    arr[:, :, 3] *= np.clip(d / f, 0, 1)
    return Image.fromarray(arr.round().astype(np.uint8), 'RGBA')


def recolor(c):
    """--recolor lo,hi,deg,sat: turn hues lo..hi (degrees) by deg, tapering to 0 at the band edges,
    and scale their saturation (a clip whose cloth came out in another colour than its pair)."""
    import numpy as np
    lo, hi, deg, sat = (float(v) for v in opt['--recolor'].split(','))
    a = np.array(c)
    hsv = np.array(c.convert('RGB').convert('HSV')).astype(float)
    h = hsv[:, :, 0] * 360 / 255
    mid, half = (lo + hi) / 2, (hi - lo) / 2
    w = np.clip(1 - np.abs(h - mid) / half, 0, 1) * 2  # 0 at the edges, full over the middle half
    w = np.clip(w, 0, 1)
    hsv[:, :, 0] = ((h + deg * w) % 360) * 255 / 360
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * (1 + (sat - 1) * w), 0, 255)
    rgb = np.array(Image.fromarray(hsv.round().astype(np.uint8), 'HSV').convert('RGB'))
    a[:, :, :3] = rgb
    return Image.fromarray(a, 'RGBA')


cells = []
for i in idx:
    ax, ay = anch[i]
    c = frames[i].crop((int(ax + L), int(ay + T), int(ax + L) + cw, int(ay + T) + ch)).resize((fw, fh), Image.LANCZOS)
    c = feathered(c) if opt['--clip-box'] else c
    cells.append(recolor(c) if opt['--recolor'] else c)

cols = min(8, len(cells)); rows = (len(cells) + cols - 1) // cols
sheet = Image.new('RGBA', (cols * fw, rows * fh), (0, 0, 0, 0))
for k, c in enumerate(cells):
    sheet.paste(c, ((k % cols) * fw, (k // cols) * fh))
prefix.parent.mkdir(parents=True, exist_ok=True)
sheet.save(f'{prefix}.png', optimize=True)
if opt['--webp']:
    sheet.save(f'{prefix}.webp', quality=opt['--webp'], method=6)
release = None
if STATIC and cells:
    base_small = cells[0].resize((48, 48))
    diffs = [sum(sum(px) for px in ImageChops.difference(c.resize((48, 48)), base_small).getdata()) for c in cells]
    release = max(range(len(diffs)), key=lambda i: diffs[i])
meta = {'frameW': fw, 'frameH': fh, 'count': len(cells), 'cols': cols, 'fps': round(fps_out, 2),
        'anchor': [round(-L * scale), round(-T * scale)], 'source': clip.name, 'loop': [i0, j0], 'loopScore': round(score, 2)}
if opt['--start'] > 0:
    meta['start'] = opt['--start']
if release is not None:
    meta['release'] = release
if opt['--impact'] >= 0:
    meta['impact'] = opt['--impact']
if fig_h and (opt['--core'] or opt['--fill'] or opt['--fig-px']):
    meta['figureH'] = round(fig_med * scale)
Path(f'{prefix}.json').write_text(json.dumps(meta, indent=1))
bg = [Image.alpha_composite(Image.new('RGBA', (fw, fh), (120, 170, 90, 255)), c).convert('P') for c in cells]
bg[0].save(f'{prefix}-preview.gif', save_all=True, append_images=bg[1:] * 3, duration=int(1000 / fps_out), loop=0)
print(json.dumps(meta))
