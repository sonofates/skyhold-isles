#!/usr/bin/python3
"""Video walk cycle (character walking in place on a flat magenta background) → looping sprite sheet.

usage: /usr/bin/python3 tools/sprites/veo_to_sheet.py <clip.mp4> <out_prefix> [--fps 12] [--height 256] [--max-seconds 4]

Steps: ffmpeg frames → chroma key (magenta-ness, soft edge, despill) → per-frame feet anchor
(bottom-centre of the alpha bbox) → best loop (frames i..j with the smallest difference between
frame i and frame j, cycle length 0.35–1.5 s) → align on the feet anchor → crop to the union box →
scale to --height → grid PNG + JSON {frameW, frameH, count, fps, cols, anchor:[x,y]}.
Writes <out_prefix>.png, <out_prefix>.json and <out_prefix>-preview.gif.
"""
import json, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageChops

args = sys.argv[1:]
clip, prefix = Path(args[0]), Path(args[1])
opt = {'--fps': 12, '--height': 256, '--max-seconds': 4.0}
for k in opt:
    if k in args:
        opt[k] = type(opt[k])(args[args.index(k) + 1])
SRC_FPS = 24

tmp = Path(tempfile.mkdtemp())
subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(clip), '-t', str(opt['--max-seconds']),
                '-vf', f'fps={SRC_FPS}', str(tmp / 'f%04d.png')], check=True)
files = sorted(tmp.glob('f*.png'))


def key(im):
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


# work at half resolution for speed (640x360), the sprite ends up ~256 px tall anyway
frames = []
for f in files:
    im = Image.open(f).convert('RGB').resize((640, 360), Image.LANCZOS)
    frames.append(key(im))

alphas = [f.getchannel('A') for f in frames]
boxes = [a.getbbox() for a in alphas]
anch = [((b[0] + b[2]) / 2, b[3]) if b else (320, 300) for b in boxes]

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
lo, hi = int(0.35 * SRC_FPS), int(1.5 * SRC_FPS)
for i in range(0, min(len(frames) - lo, SRC_FPS)):
    for j in range(i + lo, min(len(frames), i + hi + 1)):
        s = diff(i, j)
        if best is None or s < best[0]:
            best = (s, i, j)
score, i0, j0 = best
step = max(1, round(SRC_FPS / opt['--fps']))
idx = list(range(i0, j0, step))
fps_out = SRC_FPS / step

# union box around the anchor so frames stay aligned on the feet
L = T = 1e9; R = B = -1e9
for i in idx:
    b = boxes[i]; ax, ay = anch[i]
    if not b:
        continue
    L = min(L, b[0] - ax); R = max(R, b[2] - ax); T = min(T, b[1] - ay); B = max(B, b[3] - ay)
pad = 6
L, T, R, B = int(L - pad), int(T - pad), int(R + pad), int(B + pad)
cw, ch = R - L, B - T
scale = opt['--height'] / ch
fw, fh = round(cw * scale), opt['--height']
cells = []
for i in idx:
    ax, ay = anch[i]
    c = frames[i].crop((int(ax + L), int(ay + T), int(ax + L) + cw, int(ay + T) + ch)).resize((fw, fh), Image.LANCZOS)
    cells.append(c)

cols = min(8, len(cells)); rows = (len(cells) + cols - 1) // cols
sheet = Image.new('RGBA', (cols * fw, rows * fh), (0, 0, 0, 0))
for k, c in enumerate(cells):
    sheet.paste(c, ((k % cols) * fw, (k // cols) * fh))
prefix.parent.mkdir(parents=True, exist_ok=True)
sheet.save(f'{prefix}.png', optimize=True)
meta = {'frameW': fw, 'frameH': fh, 'count': len(cells), 'cols': cols, 'fps': round(fps_out, 2),
        'anchor': [round(-L * scale), round(-T * scale)], 'source': clip.name, 'loop': [i0, j0], 'loopScore': round(score, 2)}
Path(f'{prefix}.json').write_text(json.dumps(meta, indent=1))
bg = [Image.alpha_composite(Image.new('RGBA', (fw, fh), (120, 170, 90, 255)), c).convert('P') for c in cells]
bg[0].save(f'{prefix}-preview.gif', save_all=True, append_images=bg[1:] * 3, duration=int(1000 / fps_out), loop=0)
print(json.dumps(meta))
