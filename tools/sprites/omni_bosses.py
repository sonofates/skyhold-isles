#!/usr/bin/python3
"""Cut the Glacier Warden and Eclipse Sovereign Omni clips into the game's walk / attack / death sheets.

usage: python3 tools/sprites/omni_bosses.py <clip_dir> [job ...]
  <clip_dir>  the eight Omni 1.2 Flash clips (gw-walk-front.mp4 ... es-death.mp4, see
              docs/handoff-omni-bosses.md); they are not in git (8 × ~4 MB)
  job         gw-down gw-up gw-attack gw-death es-down es-up es-attack es-death (default: all)

Writes public/art2d/anim/<id>-{walk-down,walk-up,attack,death}.{webp,json}; the PNG and preview GIF of
each cut stay in a temp folder (printed). Every flag is documented in tools/sprites/veo_to_sheet.py.

- --fill: the walk sheets keep the old painted strips' figure-to-frame ratio, so the manifest
  `height` (frameH × 0.94 = height) still gives the boss its old on-screen size.
- death sheets use --fig-px = the walk "down" figure height: the renderer draws a death with the
  walk sprite's px scale (EnemyLayer.playDeath), so the death clip must share it.
- attack sheets: the long hold of each swing is shortened with --pick so one blow plays in
  ~1.33 s (both bosses swing every 1 / 0.75 s); `impact` is the frame the blow lands on.
"""
import json, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / 'tools/sprites/veo_to_sheet.py'
ANIM = ROOT / 'public/art2d/anim'
GW, ES = 'glacier_warden', 'eclipse_sovereign'

# name: (output id-clip, source clip, flags); FIG:<job> = figureH of that job's sheet
JOBS = {
    'gw-down': (f'{GW}-walk-down', 'gw-walk-front.mp4', ['--unmix', '--core', '3', '--fill', '0.804']),
    'gw-up': (f'{GW}-walk-up', 'gw-walk-back.mp4', ['--unmix', '--core', '3', '--fill', '0.821']),
    'gw-attack': (f'{GW}-attack', 'gw-attack.mp4', ['--unmix', '--core', '3', '--fixed-anchor',
                  '--pick', '2,8,13,18,22,36,40,42,43,44,48,58,67,72,76,80', '--play-fps', '12', '--impact', '9']),
    'gw-death': (f'{GW}-death', 'gw-death.mp4', ['--max-seconds', '5', '--unmix', '--core', '1', '--fixed-anchor',
                 '--clip-box', '-240,-280,240,24', '--pick', '20,26,32,38,44,50,56,62,66,69,71,73,75,77,79,81,83,85,87,90,93,96,100',
                 '--play-fps', '12', '--fig-px', 'FIG:gw-down']),
    'es-down': (f'{ES}-walk-down', 'es-walk-2.mp4', ['--unmix', '--core', '3', '--glow', '--glow-reach', '12', '--fill', '0.875',
                '--max-seconds', '8', '--loop-from', '0:150']),
    # es-walk-1 starts on the front view and turns away; the back-view walk from 2.5 s on. Its cape
    # came out navy, the front clip's is plum: --recolor turns the blue-violet band to plum.
    'es-up': (f'{ES}-walk-up', 'es-walk-1.mp4', ['--start', '2.5', '--unmix', '--core', '3', '--glow', '--glow-reach', '12',
              '--fill', '0.842', '--recolor', '235,325,55,1.35']),
    'es-attack': (f'{ES}-attack', 'es-attack.mp4', ['--max-seconds', '5', '--unmix', '--core', '3', '--glow', '--glow-reach', '140',
                  '--fixed-anchor', '--pick', '96,10,16,22,27,31,34,36,38,42,58,72,76,80,85,90', '--play-fps', '12', '--impact', '8']),
    # 102 / 106 dropped: the body fades into the magenta there and unmixes pink; 98 -> 110 reads as
    # bursting into embers
    'es-death': (f'{ES}-death', 'es-death.mp4', ['--max-seconds', '5.5', '--unmix', '--core', '1', '--glow', '--fixed-anchor',
                 '--clip-box', '-190,-300,190,16',
                 '--pick', '19,24,28,32,38,45,50,52,54,56,58,61,64,67,70,74,78,82,86,90,94,98,110,114,118,124',
                 '--play-fps', '12', '--fig-px', 'FIG:es-down']),
}

clips = Path(sys.argv[1])
which = sys.argv[2:] or list(JOBS)
tmp = Path(tempfile.mkdtemp(prefix='omni-bosses-'))
for name in which:
    out, clip, flags = JOBS[name]
    flags = list(flags)
    for i, f in enumerate(flags):
        if f.startswith('FIG:'):
            flags[i] = str(json.loads((ANIM / f'{JOBS[f[4:]][0]}.json').read_text())['figureH'])
    subprocess.run(['python3', str(TOOL), str(clips / clip), str(tmp / out), *flags, '--webp', '90'], check=True,
                   stdout=subprocess.DEVNULL)
    meta = json.loads((tmp / f'{out}.json').read_text())
    if '--pick' in flags:  # hand-picked frames: record them instead of the (meaningless) loop window
        meta.pop('loop', None); meta.pop('loopScore', None)
        meta['frames'] = [int(v) for v in flags[flags.index('--pick') + 1].split(',')]
    meta['image'] = f'{out}.webp'
    (ANIM / f'{out}.webp').write_bytes((tmp / f'{out}.webp').read_bytes())
    (ANIM / f'{out}.json').write_text(json.dumps(meta, indent=1) + '\n')
    print(name, json.dumps({k: meta[k] for k in ('frameW', 'frameH', 'count', 'fps', 'anchor') }),
          (ANIM / f'{out}.webp').stat().st_size, 'bytes', flush=True)
print('pngs + preview gifs:', tmp)
