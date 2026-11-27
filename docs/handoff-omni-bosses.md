# Omni video animation for the two chapter bosses

Branch `hermes/sky-omni-boss` (base `art-2d`, `479f3295`). The Glacier Warden (`glacier_warden`, chapter-4 boss) and the Eclipse Sovereign (`eclipse_sovereign`, final boss) now walk, swing and die from sheets cut out of the eight Omni 1.2 Flash clips (720p, 8 s, magenta), like the first 15 foes. The 6-frame image-generator strips are replaced for all eight clips.

## What changed

| Path | Change |
| --- | --- |
| `public/art2d/anim/<id>-{walk-down,walk-up,attack,death}.{webp,json}` | New Omni sheets, same paths (overwritten), for both ids |
| `public/art2d/anim/<id>-walk-side.{webp,json}` | Deleted (see "Old strips") |
| `public/art2d/manifest.json` | Both bosses: `sheet.side` removed (down/up mirrored, like every Omni foe), `stride` 1.8 → 1.5 (Warden) and 1.9 → 1.35 (Sovereign). `height`, `anchor`, `shadow`, `facing`, `facingUp` unchanged |
| `src/render2d/game2d.ts` | One render-only line: the Sovereign's death clip plays on `sovereignSplit` (see below) |
| `tools/sprites/veo_to_sheet.py` | Opt-in flags for these clips. With none of them set, the output is byte-identical to the base version (checked: plain and `--unmix --static` on `gw-walk-front.mp4`, PNG + JSON md5) |
| `tools/sprites/omni_bosses.py` | The cut table: `python3 tools/sprites/omni_bosses.py <clip_dir> [job ...]` rebuilds all eight sheets |
| `tests/render/omniBosses.test.ts` | New: wiring, grid fits the WebP, walk frame fill (= in-game size), attack contact frame + swing ≤ blow interval, death at the walk px scale |
| `tests/sim/chapterFourEnemies.test.ts`, `chapterFiveEnemies.test.ts` | `sheet.side` expectation: still required for the regular ch4/ch5 foes, absent for the two bosses |
| `qa/omnibosses.mjs`, `qa/omnibossgif.py`, `qa/omnibosscompare.py` | One-Chromium zoo check, death GIF, old-vs-new contact sheet |
| `docs/omni-boss-shots/` | Shots (below) |

The clips stay out of git (8 × 3–5 MB). They are in `/home/claude/work/ref/skyhold-p4-clips/` on hermes.

### Keying (new `veo_to_sheet.py` flags)

- `--core K`: keeps only the opaque body (a K px erosion, regrown inside the opaque mask) plus a 3 px soft edge. It drops the clip's own grey cast shadow, which the old keyer kept. The game draws its own shadow, and the clip's shadow had pushed the Warden's frame to 447 px wide. It also drops the pink specks of the backdrop and the slam dust.
- `--glow`: the halo corona, the punch rays and the death flash/embers are pale gold light over magenta. Green rises and blue falls, so `--unmix` keyed them as opaque salmon-pink paint. These pixels are now classified from the source pixel: still showing the backdrop's blue, red high, green risen. They are rebuilt as gold → warm-white light with alpha from the green rise. Highlights inside the body are protected by a morphological close. Leftover magenta haze is dropped, and crimson ember edges are turned orange.
- `--pick`, `--fixed-anchor`, `--clip-box` (feathered), `--fill`, `--fig-px`, `--recolor`, `--webp`, `--start`, `--loop-from`, `--play-fps`, `--impact`: see the tool's docstring.

### Size, anchor and timing

- **Size.** The renderer maps walk `frameH × 0.94` to the manifest `height`. The walk sheets are padded so that the median figure fills the frame like the old strips did: Warden 0.804 down / 0.821 up, Sovereign 0.875 / 0.842. With `height` unchanged, the on-screen size stays the same. The test checks this to ±0.05.
- **Hitboxes** are sim-side and untouched.
- **Death scale.** Death clips are drawn with the walk sprite's px scale (`EnemyLayer.playDeath`). Their first frame is therefore cut to the walk "down" figure height (`--fig-px`).
- **Attack scale.** Attack frames are auto-matched by `figScale`.
- **Feet anchor** is the bottom-centre of the body in every sheet. Attack and death sheets use a fixed anchor from their first frame, so the pile and the lunge do not slide.
- **Stride.** Strides were set from the filmed loop and the boss speed: Warden 0.95 u/s × 1.58 s, Sovereign 0.9 u/s × 1.5 s. The feet stay planted, and the loop plays at about its filmed rate. The old 1.8 / 1.9 strides on a 19-frame loop would have played the walk in slow motion.
- **Attack timing.** Both bosses swing every 1 / 0.75 = 1.33 s (`ENEMY_MELEE`). Each attack sheet is 16 hand-picked frames: 1.33 s at 12 fps with the long held pose shortened. Recovery therefore never has to be hurried.

## Per clip

Loop score = mean thumbnail difference between the loop's first and last frame; lower is better. For scale, the shipped Omni foes are `golem` 23.7 and `boss` ~19.

| Clip | Source | Frames / fps | Loop score | Keyed OK? | Old vs new at game scale | Kept / replaced | Regenerate? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Warden walk-down | `gw-walk-front`, src 21–59 (1.58 s) | 19 @ 12, 244×256 | **5.27** | Yes: clean edges, cast shadow + specks gone | New clearly better: a real two-step gait vs 6 poses. A little warmer/browner than the grey strip, matching the Omni start plate | **Replaced** | No |
| Warden walk-up | `gw-walk-back`, src 15–53 | 19 @ 12, 218×256 | 17.65 | Yes | New better | **Replaced** | No |
| Warden attack | `gw-attack`, picked 2…80, contact = src 44 (fists hit the ground) | 16 @ 12 (lead 0.75 s, dur 1.33 s), `impact` 9 | — (one swing) | Yes. Dust puff at the slam is dropped (it was a grey smear) | New better: raise, slam, crouch, rise. Old: 6 choppy poses | **Replaced** | No |
| Warden death | `gw-death`, picked 20…100 | 23 @ 12 (1.9 s), 337×230, ends on the settled pile | — (one-shot) | Yes. Some 1–2 px pebbles of the pile are lost | New better motion: cracks glow, it turns, crumbles, settles. The old strip ended on a bluer, icier mound | **Replaced** | No |
| Sovereign walk-down | `es-walk-2`, src 140–175 (loop searched over the whole clip; the best start in the first second scored 31.4) | 18 @ 12, 221×256 | 14.85 | Yes: corona glow rebuilt as light, no pink fringe | New clearly better | **Replaced** | Optional: a slightly cleaner loop exists only late in the clip; it is fine as is |
| Sovereign walk-up | `es-walk-1` from 2.5 s (the back-view part, after its turn), src 9–44 | 18 @ 12, 183×256 | **3.62** | Yes. **Cape recoloured**: it came out navy/indigo (hue ~288°) where the front clip's is plum (330–360°). `--recolor 235,325,55,1.35` brings it to 334° | Same character (halo, gold pauldrons, starry cape). Much smoother than the old strip, but a **slimmer silhouette**: the old painted back had a wide cape fan. Motion better, silhouette read slightly weaker | **Replaced** (used, per the brief) | **Worth regenerating**: a dedicated back-walk clip from `eclipse_sovereign-back-start.jpg` (walking up-right from the first frame) would avoid both the recolour and the turn |
| Sovereign attack | `es-attack`, picked 96,10…90, contact = src 38 (arm fully extended) | 16 @ 12 (lead 0.67 s, dur 1.33 s), `impact` 8, 396×256 (cape sweep) | — | Yes: the strike's light rays are warm light, not pink | New better: wind-up, punch with a cape sweep and corona flare | **Replaced** | No |
| Sovereign death | `es-death`, picked 19…124 without 102/106 | 26 @ 12 (2.2 s), 303×252, ends on a fading ember swirl | — | Yes, after the light rebuild. The flash rays fill the clip box and fade at its feathered edge. Source frames 102/106 were dropped: the body fades into the magenta there and could only key pink | New far more dramatic: halo cracks, ray flash, shards, embers. Old: 6-frame slump into a cinder pile | **Replaced** | Optional: dissolve shots key badly on magenta. A re-render of just the dissolve on a non-magenta key colour would allow a smooth body→embers fade |

No clip turned out worse than its old strip, so none of the old strips was kept.

## The Sovereign's death clip now plays (render-only)

The Sovereign never dies in the sim. `EnemySystem.updateSovereign`: "Even a hit that would kill it outright makes it split". So no `enemyKilled` fires for it, and neither the old strip nor the new clip was ever shown in battle. The new clip shows exactly a split (halo cracks, flash, dissolve), so `game2d.ts` now calls `playDeath(parentUid)` on `sovereignSplit`: the Shadow Halves step out of the flash. This is one line, render-only, with no sim change. If the owner prefers the old split look (existing flash/shards only), delete that line; the art stays wired.

## Old strips

The old `walk-down/up`, `attack` and `death` files were overwritten in place, because the manifest references those paths. The two `walk-side` strips were deleted: nothing references them any more, and a 6-frame painted side walk between two 19-frame video walks would jar. They are not needed as a runtime fallback: a missing sheet already falls back to the front sprite / tinted placeholder. The old strips remain:

- in git at `479f3295:public/art2d/anim/<id>-*.{webp,json}` (`qa/omnibosscompare.py` reads them from there);
- repackable from the source atlases `design/art-2d/chapter4/glacier_warden.webp` and `design/art-2d/chapter5/eclipse_sovereign.webp` (`tools/sprites/chapter_enemies.py`).

**Size:** the 8 sheets are 3.2 MB of WebP (old 10 strips ≈ 0.8 MB). The per-sheet sizes match the existing Omni sheets (250–450 KB), except the Sovereign death at 1.0 MB (26 frames of rays and embers; quality 82 would only save 14 %). The largest texture is 3168 × 512 (Sovereign attack); the Sovereign death is 2424 × 1008. Story runs load boss art only on the islands whose waves have the boss (`enemyArtSet.ts`).

## Verification

- `npx tsc --noEmit` passed. `npm run lint` passed. `npm run build` passed (only the usual chunk-size warning).
- `npx vitest run --maxWorkers=3`: 156 files passed, 2 skipped. 2,150 tests passed, 19 skipped.
- No sim change, so the balance sims were not re-run. The only `src/` change is the render hook.
- One Chromium (`python3 qa/withPreview.py --port=4473 node qa/omnibosses.mjs`), 1280×800, `?zoo=1&types=glacier_warden,eclipse_sovereign&quality=high`. It was run twice: the second run, after the final Sovereign death re-cut, made the shots below. Result: no page or console errors. Death clips started: Warden 0 → 1, and the Sovereign split 0 → 1 with its clip. The halves have 1 HP after the probe's 1e9 hit (sim design), so the towers drop them at once. That is a QA artifact.
  - [zoo-1280x800.jpg](omni-boss-shots/zoo-1280x800.jpg): both bosses walking. The Warden is near the top-right road and the Sovereign is mid-left, red from a hit flash.
  - [gw-death-1280x800.jpg](omni-boss-shots/gw-death-1280x800.jpg) and [es-split-1280x800.jpg](omni-boss-shots/es-split-1280x800.jpg) are full frames after the hit. SwiftShader screenshots take ~0.6 s, so they land late in the clips.
  - [ingame-death-frames.jpg](omni-boss-shots/ingame-death-frames.jpg): the in-game crops at +0 … +3 s.
  - [death.gif](omni-boss-shots/death.gif): both death clips at 12 fps and game scale over a map crop (`qa/omnibossgif.py`).
  - [compare-contact.jpg](omni-boss-shots/compare-contact.jpg) and [compare.gif](omni-boss-shots/compare.gif): old strip vs new sheet per clip at game scale. A yellow bar marks the contact frame.

## Open points

- Sovereign walk-up: recoloured and slimmer than the old painted back. Regenerating a dedicated back clip is the cleaner fix.
- Sovereign split now shows the death clip. This is a judgement call, easy to revert (above).
- A few sub-pixel sparkle dots survive around the Sovereign attack (backdrop specks inside the light reach). They are invisible at game scale.
