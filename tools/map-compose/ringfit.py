"""Stone-ring measurement for plot / tower sprites (shared by compose.py and tower_art.py).

Every tower stands on the same round stone ring as the empty plot (plot-base.png), but each file
draws that ring at its own pixel size, and parts of a tower (ballista arms, mortar barrels,
banners) can stick out wider than the ring. So the ring is measured from the sprite itself:

  * the ring is the bottom of the silhouette; below its equator the silhouette IS the ring (the
    tower body is narrower), so the ring width is the widest alpha run within the bottom half of
    the ring's own height. The ring height is not known up front (it is width * aspect), so this
    iterates: start with the bottom 22 %, re-measure within half the estimated ring height.
  * the ring bottom is the lowest opaque row; the ring centre x is the centre of the widest run.

`template_iou` checks a measurement against the plot sprite: plot-base scaled to the measured
width and bottom-centre aligned must cover the lower ring of the tower (IoU of the lower half).
"""
from PIL import Image

ALPHA = 128
RING_ASPECT = 0.666  # plot-base ring height / width (incl. the stone thickness)


def _runs(a, w, y):
    xs = [x for x in range(w) if a[y * w + x] > ALPHA]
    return (xs[0], xs[-1]) if xs else None


def measure_ring(im):
    """{ringWidthPx, ringBottomPx, ringCenterXPx} in the image's own px (floats)."""
    im = im.convert('RGBA')
    w, h = im.size
    a = list(im.getchannel('A').getdata())
    bottom = max(y for y in range(h) if any(a[y * w + x] > ALPHA for x in range(w)))
    band = h * 0.22
    best = None
    for _ in range(6):
        best = None
        for y in range(max(0, int(bottom - band)), bottom + 1):
            r = _runs(a, w, y)
            if r and (best is None or r[1] - r[0] > best[1] - best[0]):
                best = (r[0], r[1], y)
        width = best[1] - best[0] + 1
        nb = width * RING_ASPECT * 0.5
        if abs(nb - band) < 1:
            break
        band = nb
    return {
        'ringWidthPx': float(best[1] - best[0] + 1),
        'ringBottomPx': float(bottom + 1),
        'ringCenterXPx': (best[0] + best[1] + 1) / 2,
    }


def template_iou(im, ring, plot_im, plot_ring):
    """IoU of the lower ring half: tower alpha vs plot-base scaled onto the measured ring."""
    im = im.convert('RGBA')
    s = ring['ringWidthPx'] / plot_ring['ringWidthPx']
    pw, ph = round(plot_im.width * s), round(plot_im.height * s)
    p = plot_im.convert('RGBA').resize((pw, ph), Image.LANCZOS)
    ox = round(ring['ringCenterXPx'] - plot_ring['ringCenterXPx'] * s)
    oy = round(ring['ringBottomPx'] - plot_ring['ringBottomPx'] * s)
    canvas = Image.new('RGBA', im.size)
    canvas.alpha_composite(p, (max(0, ox), max(0, oy)), (max(0, -ox), max(0, -oy)))
    ta, pa = im.getchannel('A'), canvas.getchannel('A')
    w = im.width
    y0 = int(ring['ringBottomPx'] - ring['ringWidthPx'] * RING_ASPECT * 0.5)
    inter = union = 0
    for y in range(max(0, y0), min(im.height, int(ring['ringBottomPx']))):
        for x in range(w):
            t = ta.getpixel((x, y)) > ALPHA
            q = pa.getpixel((x, y)) > ALPHA
            inter += t and q
            union += t or q
    return inter / union if union else 0.0
