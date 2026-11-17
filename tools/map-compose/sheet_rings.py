#!/usr/bin/python3
"""Measures the stone ring in every tower attack sheet and writes it into the sheet JSON: `ringW`
(ring width, frame px) and, when the given anchor is off, `anchor` = the ring bottom-centre. The
renderer then scales sheet frames exactly like the static sprite (ring width = plot ring width) and
places them by the ring bottom-centre, so the tower does not jump when the sheet starts or ends.

usage: /usr/bin/python3 tools/map-compose/sheet_rings.py [--dry]

Measurement (per frame, median over all frames; the tower body is static in these clips):
  * ring width = the widest opaque run (alpha > 128, the same threshold as ringfit.py uses for the
    static sprites) that is CONNECTED to the anchor column, within ~45 px above the anchor row.
    Connected-only skips sparks, smoke puffs and glow that float beside the ring; widest-overall
    (ringfit.py) would pick those up, because frame 0 already carries FX in many clips.
  * ring centre x = the middle of that run; ring bottom = the lowest row whose connected run is
    still at least a quarter of the ring width (a stray spark under the ring does not count).
The given anchor is kept unless the measured ring bottom-centre is more than 2 px away.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SHEETS = ROOT / 'public/art2d/anim-towers'
DRY = '--dry' in sys.argv
ALPHA = 128
BAND = 45


def run_at(row, x):
    if x < 0 or x >= len(row) or not row[x]:
        return None
    left = x
    while left > 0 and row[left - 1]:
        left -= 1
    right = x
    while right < len(row) - 1 and row[right + 1]:
        right += 1
    return left, right


def measure(a, ax, ay):
    """(width, centre x, bottom) of the ring in one frame's alpha mask, or None."""
    h = a.shape[0]
    best = None
    for y in range(max(0, int(ay) - BAND), min(h, int(ay) + 6)):
        r = run_at(a[y], int(round(ax)))
        if r and (best is None or r[1] - r[0] > best[1] - best[0]):
            best = r
    if best is None:
        return None
    width = best[1] - best[0] + 1
    cx = (best[0] + best[1] + 1) / 2
    bottom = None
    for y in range(min(h - 1, int(ay) + 12), max(0, int(ay) - BAND), -1):
        r = run_at(a[y], int(round(cx)))
        if r and r[1] - r[0] + 1 >= width * 0.25:
            bottom = y + 1
            break
    return width, cx, bottom if bottom is not None else ay


def main():
    for jf in sorted(SHEETS.glob('t3-*-attack.json')):
        d = json.loads(jf.read_text())
        sheet = Image.open(jf.parent / d['image']).convert('RGBA')
        alpha = np.asarray(sheet.getchannel('A')) > ALPHA
        cols = d.get('cols') or d['count']
        fw, fh = d['frameW'], d['frameH']
        ax, ay = d['anchor']
        ms = []
        for i in range(d['count']):
            x0, y0 = (i % cols) * fw, (i // cols) * fh
            m = measure(alpha[y0:y0 + fh, x0:x0 + fw], ax, ay)
            if m:
                ms.append(m)
        if not ms:
            print(f'{jf.name}: NO RING FOUND at anchor {d["anchor"]}')
            continue
        width = float(np.median([m[0] for m in ms]))
        cx = float(np.median([m[1] for m in ms]))
        bottom = float(np.median([m[2] for m in ms]))
        spread = max(m[0] for m in ms) - min(m[0] for m in ms)
        d['ringW'] = round(width, 1)
        note = ''
        if abs(cx - ax) > 2 or abs(bottom - ay) > 2:
            note = f'anchor {d["anchor"]} -> {[round(cx, 1), round(bottom, 1)]}'
            d['anchor'] = [round(cx, 1), round(bottom, 1)]
        if not DRY:
            jf.write_text(json.dumps(d, indent=1) + '\n')
        print(f'{jf.name}: {fw}x{fh} ringW {d["ringW"]} (spread {spread} px over {len(ms)} frames) {note}')


main()
