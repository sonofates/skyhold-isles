#!/usr/bin/python3
"""Cut the 20 Omni clips of the chapter-4/5 regular foes into the game's walk / attack / death sheets.

usage: python3 tools/sprites/omni_units.py <clip_dir> [job ...]
  <clip_dir>  the twenty Omni 1.2 Flash clips (rb-walk-front.mp4 ... es5-death.mp4, see
              docs/handoff-omni-units.md); they are not in git (20 × ~4 MB)
  job         <unit>-{down,up,attack,death} for unit rb sg dh vc es5 (default: all, walks first)

Same pattern as tools/sprites/omni_bosses.py. Writes public/art2d/anim/<id>-{walk-down,walk-up,attack,death}
.{webp,json}; the PNG and preview GIF of each cut stay in a temp folder (printed). Every flag is
documented in tools/sprites/veo_to_sheet.py.

- --fill: the walk sheets keep the old painted strips' figure-to-frame ratio, so the manifest
  `height` (frameH × 0.94 = height) still gives the foe its old on-screen size.
- death sheets use --fig-px = the walk "down" figure height: the renderer draws a death with the
  walk sprite's px scale (EnemyLayer.playDeath), so the death clip must share it.
- attack sheets: --pick shortens each swing so one blow plays within the foe's ENEMY_MELEE interval
  (beetle 1.0 s, sledge 1.33 s, hound 0.87 s, caster and Shadow Half 1.25 s); `impact` is the
  frame the blow lands on.
"""
import json, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / 'tools/sprites/veo_to_sheet.py'
ANIM = ROOT / 'public/art2d/anim'
UNITS = {'rb': 'rimebeetle', 'sg': 'sledguard', 'dh': 'duskhound', 'vc': 'veilcaster', 'es5': 'eclipse_shade'}

# old painted strips' median figure fill (figure height / frameH), walk down / up
FILL = {'rb': ('0.848', '0.837'), 'sg': ('0.880', '0.832'), 'dh': ('0.853', '0.902'),
        'vc': ('0.837', '0.842'), 'es5': ('0.848', '0.821')}
WALK = ['--unmix', '--core', '3']
# per-unit extra keying flags for every job of that unit
KEY = {'rb': [], 'sg': [], 'dh': [], 'vc': [], 'es5': []}

# name: (output id-clip, source clip, flags); FIG:<job> = figureH of that job's sheet
# Walk loop windows. The default search (a 0.6-1.6 s cycle starting in the first second) found
# half cycles (one step) on some clips: the same leg would lead every loop. A lag scan of each clip
# (mean thumbnail difference vs lag) gives the full two-step cycle; --min-seconds / --max-cycle
# hold the search to it, --loop-from widens the start search where the first second loops badly.
LOOP = {
    'rb-up': ['--min-seconds', '1.55', '--max-cycle', '1.8'],  # full cycle 41 src frames (half: 20)
    'sg-up': ['--min-seconds', '1.3', '--max-cycle', '1.7'],  # full 36 (half: 21)
    'vc-down': ['--max-seconds', '8', '--loop-from', '0:150', '--min-seconds', '1.45', '--max-cycle', '1.8'],  # full 40
    'vc-up': ['--max-seconds', '8', '--loop-from', '0:150', '--min-seconds', '1.55', '--max-cycle', '1.9'],  # full 42 (half: 22)
    'es5-down': ['--max-seconds', '8', '--loop-from', '0:150', '--min-seconds', '1.4', '--max-cycle', '1.7'],  # full 38 (half: 16)
}

JOBS = {}
for u, uid in UNITS.items():
    JOBS[f'{u}-down'] = (f'{uid}-walk-down', f'{u}-walk-front.mp4', WALK + KEY[u] + ['--fill', FILL[u][0]] + LOOP.get(f'{u}-down', []))
    JOBS[f'{u}-up'] = (f'{uid}-walk-up', f'{u}-walk-back.mp4', WALK + KEY[u] + ['--fill', FILL[u][1]] + LOOP.get(f'{u}-up', []))

# attack / death cuts: hand-picked source frames (24 fps), played at 12 fps.
# attack: frame 0 is a stance close to the walk pose (the renderer scales attack frame 0 to the walk
# figure height, figScale); count / 12 <= the foe's blow interval; impact = index of the contact frame.
ATK = ['--max-seconds', '5', '--core', '3', '--fixed-anchor', '--play-fps', '12']
DTH = ['--max-seconds', '5', '--core', '1', '--fixed-anchor', '--play-fps', '12']
CUTS = {
    # rears, bites (mandibles out at src 40), drops back: 12 frames = 1.0 s (blow every 1.0 s)
    'rb-attack': ATK + ['--pick', '24,27,30,32,34,36,38,40,42,45,48,52', '--impact', '7'],
    # pulls the shield in, bashes (shield fully out at src 38), holds, recovers: 16 = 1.33 s (every 1.33 s)
    'sg-attack': ATK + ['--pick', '15,20,24,27,30,32,34,36,38,40,44,56,68,76,84,90', '--impact', '8'],
    # the clip coils small (src 12-27) and lunges toward the camera, ending bigger: the coil is
    # skipped (it popped to half size) and the cut starts on the big standing pose from the end
    # (src 92, 96) so figScale matches the lunge. 10 = 0.83 s (every 0.87 s)
    'dh-attack': ATK + ['--pick', '92,96,30,33,36,39,42,60,78,88', '--impact', '5'],
    # src 13-31 face the camera straight (staff raised): skipped, the cast stays three-quarter.
    # staff thrust + veil flare at src 40. 15 = 1.25 s (every 1.25 s)
    'vc-attack': ATK + ['--pick', '3,7,10,12,33,34,36,38,40,42,46,52,60,70,80', '--impact', '8'],
    # wind-up, punch with a gold swirl (fist out at src 52), recover. --core drops the dark specks;
    # --glow keeps the swirl as warm light instead of pink paint. 15 = 1.25 s (every 1.25 s)
    'es5-attack': ATK + ['--glow', '--glow-reach', '40', '--pick', '22,28,34,38,42,46,49,52,55,58,62,68,76,86,96', '--impact', '7'],
    # legs curl, slumps to a frozen heap (settled from src ~84)
    'rb-death': DTH + ['--pick', '40,46,50,53,56,58,60,62,64,66,68,70,73,76,80,84,88', '--fig-px', 'FIG:rb-down'],
    # drops to a knee, the shield falls, slumps over the sled (settled from ~80)
    'sg-death': DTH + ['--pick', '22,27,31,35,38,41,44,47,51,55,59,62,65,68,71,74,78,84', '--fig-px', 'FIG:sg-down'],
    # howls (tail fire flares), collapses on its side, the tail fire dims out (settled from ~90)
    'dh-death': DTH + ['--glow', '--glow-reach', '30', '--pick', '8,14,20,30,40,46,50,53,56,59,62,65,68,72,76,80,86,94',
                       '--fig-px', 'FIG:dh-down'],
    # the staff drops, kneels, crumples into the robes (settled from ~104)
    'vc-death': DTH + ['--pick', '24,34,40,45,50,54,57,60,63,66,72,80,88,92,95,98,101,104,110', '--fig-px', 'FIG:vc-down'],
    # straightens (halo flares), kneels, the armour cracks and collapses into a heap (settled ~93)
    'es5-death': DTH + ['--glow', '--glow-reach', '30', '--pick', '3,9,15,21,27,33,39,48,57,62,65,68,71,74,77,80,83,86,89,93,98',
                        '--fig-px', 'FIG:es5-down'],
}
for name, flags in CUTS.items():
    u, kind = name.rsplit('-', 1)
    uid = UNITS[u]
    JOBS[name] = (f'{uid}-{kind}', f'{u}-{kind}.mp4', ['--unmix'] + KEY[u] + flags)


def main():
    clips = Path(sys.argv[1])
    which = sys.argv[2:] or list(JOBS)
    tmp = Path(tempfile.mkdtemp(prefix='omni-units-'))
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
        print(name, json.dumps({k: meta.get(k) for k in ('frameW', 'frameH', 'count', 'fps', 'anchor', 'loop', 'loopScore', 'figureH')}),
              (ANIM / f'{out}.webp').stat().st_size, 'bytes', flush=True)
    print('pngs + preview gifs:', tmp)


if __name__ == '__main__':
    main()
