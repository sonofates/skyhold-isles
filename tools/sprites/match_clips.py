#!/usr/bin/python3
"""Match downloaded Flow clips to their start frames, rename them, and build walk sheets.

usage: /usr/bin/python3 tools/sprites/match_clips.py <clips_dir> <start_frames_dir> <anim_out_dir> [--no-sheets]

Each clip's first frame is compared with every <name>-start.jpg (64x36, mean abs diff). Clips are
renamed to <name>.mp4 (e.g. enemy-runner-back.mp4). Then each is turned into a looping sheet:
  enemy-<type>.mp4       -> <anim_out>/<type>-walk-down.png/.json
  enemy-<type>-back.mp4  -> <anim_out>/<type>-walk-up.png/.json
  unit-soldier[-back]    -> <anim_out>/soldier-walk-down/up
"""
import subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageChops

clips, starts, anim = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
make_sheets = '--no-sheets' not in sys.argv
tool = Path(__file__).with_name('veo_to_sheet.py')


def small(im):
    return im.convert('RGB').resize((64, 36), Image.BILINEAR)


refs = {p.name[:-len('-start.jpg')]: small(Image.open(p)) for p in starts.glob('*-start.jpg')}
tmp = Path(tempfile.mkdtemp())
scores = []
for c in sorted(clips.glob('*.mp4')):
    f = tmp / (c.stem + '.png')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(c), '-frames:v', '1', str(f)], check=True)
    fr = small(Image.open(f))
    for name, ref in refs.items():
        d = ImageChops.difference(fr, ref)
        scores.append((sum(sum(px) for px in d.getdata()) / (64 * 36 * 3), c, name))

scores.sort(key=lambda s: s[0])
used_c, used_n, plan = set(), set(), []
for s, c, name in scores:
    if c in used_c or name in used_n:
        continue
    used_c.add(c); used_n.add(name); plan.append((s, c, name))
for s, c, name in sorted(plan, key=lambda x: x[2]):
    flag = '' if s < 25 else '  <-- WEAK MATCH, check by eye'
    print(f'{name:28s} <- {c.name}  diff={s:.1f}{flag}')
    target = clips / f'{name}.mp4'
    if c != target:
        c.rename(target)
missing = sorted(set(refs) - used_n)
if missing:
    print('NO CLIP FOR:', ', '.join(missing))

if make_sheets:
    anim.mkdir(parents=True, exist_ok=True)
    for name in sorted(used_n):
        base = name.replace('enemy-', '').replace('unit-', '')
        back = base.endswith('-back')
        base = base[:-5] if back else base
        out = anim / f'{base}-walk-{"up" if back else "down"}'
        r = subprocess.run(['/usr/bin/python3', str(tool), str(clips / f'{name}.mp4'), str(out), '--max-seconds', '8'],
                           capture_output=True, text=True)
        print(out.name, (r.stdout.strip().splitlines() or [r.stderr.strip()[-200:]])[-1][:160])
