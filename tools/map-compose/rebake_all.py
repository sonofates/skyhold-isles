#!/usr/bin/python3
"""Re-bakes every shipped island (l1c + i01..i16) in parallel with its recipe, keeping its plots,
and writes the gates back into the layout JSON. Then checks that no gameplay field of any layout
changed (only `entrances[].gate` / `goalGate` may differ from git HEAD).

usage: /usr/bin/python3 tools/map-compose/rebake_all.py [ids,comma,separated] [--jobs 6]
"""
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
args = sys.argv[1:]
jobs = int(args[args.index('--jobs') + 1]) if '--jobs' in args else 6
pos = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] != '--jobs')]
ids = pos[0].split(',') if pos else ['l1c'] + [f'i{n:02d}' for n in range(1, 17)]


def out_name(lid):
    L = json.loads((ROOT / f'src/data/levels2d/{lid}.json').read_text())
    return L['image']


def bake(lid):
    cmd = ['/usr/bin/python3', 'tools/map-compose/compose.py', f'src/data/levels2d/{lid}.json', 'design/art-2d/v2/assets',
           f'public/art2d/{out_name(lid)}.webp', '--bake', '--keep-plots', '--w', '3692', '--variants', '1,1.5', '--write-layout']
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return lid, r.returncode, r.stdout + r.stderr


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
    same = strip_gates(json.loads(head)) == strip_gates(json.loads((ROOT / p).read_text()))
    print(f'{lid}: gameplay fields {"unchanged" if same else "CHANGED"}')
    fail |= not same
sys.exit(1 if fail else 0)
