#!/usr/bin/python3
"""Re-bakes every authored island (l1c and numbered layouts) in parallel with its recipe, keeping its plots,
and writes the gates back into the layout JSON. Then checks that no gameplay field of any layout
changed (only `entrances[].gate` / `goalGate` may differ from git HEAD).

Use --only-3x to add native high-resolution art to an existing set of bakes and layouts.

usage: /usr/bin/python3 tools/map-compose/rebake_all.py [ids,comma,separated] [--jobs 2] [--only-3x]
"""
import json
import filecmp
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
args = sys.argv[1:]
jobs = int(args[args.index('--jobs') + 1]) if '--jobs' in args else 2
pos = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] != '--jobs')]
layouts = ROOT / 'src/data/levels2d'
ids = pos[0].split(',') if pos else ['l1c', *(p.stem for p in sorted(layouts.glob('i[0-9][0-9].json')))]
starting_layouts = {lid: json.loads((layouts / f'{lid}.json').read_text()) for lid in ids}


def bake(lid):
    layout = ROOT / 'src/data/levels2d' / f'{lid}.json'
    original = json.loads(layout.read_text())
    art = ROOT / 'public/art2d'
    stem = original['image']
    # Encoding a native WebP takes long enough for an interrupted run to
    # truncate a live game texture. Publish only after both passes decode.
    with TemporaryDirectory(prefix=f'.bake-{lid}-', dir=ROOT / 'tools/map-compose') as scratch:
        stage = Path(scratch)
        staged_layout = stage / layout.name
        shutil.copyfile(layout, staged_layout)
        # The compositor preserves the shipped encoding for pixel-identical fronts.
        for front in art.glob(f'{stem}-gate-*.webp'):
            shutil.copyfile(front, stage / front.name)
        cmd = ['/usr/bin/python3', '-B', 'tools/map-compose/compose.py', str(staged_layout),
               'design/art-2d/v2/assets', str(stage / f'{stem}.webp'), '--bake', '--keep-plots']
        passes = [] if '--only-3x' in args else [['--w', '3692', '--variants', '1,1.5', '--write-layout']]
        for options in [*passes, ['--3x']]:
            r = subprocess.run(cmd + options, cwd=ROOT, capture_output=True, text=True)
            if r.returncode:
                return lid, r.returncode, r.stdout + r.stderr
        updated = json.loads(staged_layout.read_text())
        if strip_gates(original) != strip_gates(updated):
            return lid, 1, 'Staged bake changed gameplay geometry'
        files = list(stage.glob('*.webp'))
        for file in files:
            with Image.open(file) as image:
                image.load()
        for file in files:
            dest = art / file.name
            if not dest.exists() or not filecmp.cmp(file, dest, shallow=False):
                file.replace(dest)
        if updated != original:
            staged_layout.replace(layout)
        return lid, 0, r.stdout + r.stderr


def strip_gates(L):
    L = json.loads(json.dumps(L))
    for e in L.get('entrances', []):
        e.pop('gate', None)
    L.pop('goalGate', None)
    return L


fail = False
with ThreadPoolExecutor(jobs) as ex:
    for lid, rc, log in ex.map(bake, ids):
        gates = [ln.strip() for ln in log.splitlines() if ln.strip().startswith('gate ')]
        print(f'{lid}: {"OK" if rc == 0 else f"EXIT {rc}"}')
        for g in gates:
            print('   ', g)
        if rc:
            fail = True
            print(log[-1500:])
for lid in ids:
    p = f'src/data/levels2d/{lid}.json'
    head = subprocess.run(['git', 'show', f'HEAD:{p}'], cwd=ROOT, capture_output=True, text=True).stdout
    # A new island can be rebaked in its author's working tree before its first commit.
    before = json.loads(head) if head else starting_layouts[lid]
    after = json.loads((ROOT / p).read_text())
    same = before == after if '--only-3x' in args else strip_gates(before) == strip_gates(after)
    print(f'{lid}: gameplay fields {"unchanged" if same else "CHANGED"}')
    fail |= not same
sys.exit(1 if fail else 0)
