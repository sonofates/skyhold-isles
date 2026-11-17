#!/usr/bin/python3
"""Ships the plot + tower sprites into public/art2d and records their stone-ring measurements in
the art manifest (so the renderer can stand every tower exactly on its plot).

usage: /usr/bin/python3 tools/map-compose/tower_art.py [--src design/art-2d/v2/out] [--dry]

  plot-base.png (design/art-2d/v2/assets)  -> public/art2d/plot-base.webp, manifest `plot`
  t3-<type>-<tier>.png (--src)             -> public/art2d/tower-<simType>-t<tier>.webp,
                                              manifest towers.<simType>.tiers + .ring
  (crystal = sim tesla)

Ring measurement: see ringfit.py. Each written ring is checked against the plot sprite (IoU of the
lower ring half); the script fails when a file does not look like it stands on the shared ring.
"""
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ringfit import measure_ring, template_iou  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
args = sys.argv[1:]
SRC = ROOT / (args[args.index('--src') + 1] if '--src' in args else 'design/art-2d/v2/out')
DRY = '--dry' in args
PUB = ROOT / 'public/art2d'
MANIFEST = PUB / 'manifest.json'
SIM_TYPE = {'crystal': 'tesla'}
MIN_IOU = 0.9


def save_webp(im, path):
    if not DRY:
        im.save(path, 'WEBP', quality=92, method=6, exact=False)


def r1(ring):
    return {k: round(v, 1) for k, v in ring.items()}


manifest = json.loads(MANIFEST.read_text())
plot_im = Image.open(ROOT / 'design/art-2d/v2/assets/plot-base.png').convert('RGBA')
plot_ring = measure_ring(plot_im)
save_webp(plot_im, PUB / 'plot-base.webp')
manifest['plot'] = {'file': 'plot-base.webp', **r1(plot_ring)}
print(f'plot-base.webp {plot_im.size} ring {r1(plot_ring)}')

bad = []
found = {}
for f in sorted(SRC.glob('t3-*-[123].png')):
    stem = f.stem[3:]
    art_type, tier = stem.rsplit('-', 1)
    found.setdefault(SIM_TYPE.get(art_type, art_type), {})[int(tier)] = f
for sim_type, tiers in sorted(found.items()):
    if sorted(tiers) != [1, 2, 3]:
        bad.append(f'{sim_type}: tiers {sorted(tiers)} (need 1, 2, 3)')
        continue
    spec = manifest['towers'].get(sim_type)
    if spec is None:
        bad.append(f'{sim_type}: not in the manifest')
        continue
    files, rings = [], []
    for t in (1, 2, 3):
        im = Image.open(tiers[t]).convert('RGBA')
        ring = measure_ring(im)
        iou = template_iou(im, ring, plot_im, plot_ring)
        name = f'tower-{sim_type}-t{t}.webp'
        save_webp(im, PUB / name)
        files.append(name)
        rings.append(r1(ring))
        print(f'{name} {im.size} ring {r1(ring)} iou {iou:.3f}')
        if iou < MIN_IOU:
            bad.append(f'{name}: ring IoU {iou:.3f} < {MIN_IOU}')
    spec['tiers'] = files
    spec['ring'] = rings

if not DRY:
    MANIFEST.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + '\n')
if bad:
    print('FAILED:\n  ' + '\n  '.join(bad))
    sys.exit(1)
