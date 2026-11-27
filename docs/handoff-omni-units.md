# Omni video animation for the five chapter-4/5 regular foes

Branch `hermes/sky-omni-units` (base `art-2d`, `505272d1`). The Rime Beetle (`rimebeetle`), Sledge Warden (`sledguard`), Dusk Hound (`duskhound`), Veilcaster (`veilcaster`) and Shadow Half (`eclipse_shade`) now walk, strike and die from sheets cut out of twenty Omni 1.2 Flash clips (720p, 8 s, magenta). This repeats the boss job (`docs/handoff-omni-bosses.md`). All twenty 6-frame painted strips are replaced; no old strip was kept.

## What changed

| Path | Change |
| --- | --- |
| `public/art2d/anim/<id>-{walk-down,walk-up,attack,death}.{webp,json}` | New Omni sheets, same paths (overwritten), for all five ids |
| `public/art2d/anim/<id>-walk-side.{webp,json}` | Deleted for all five (nothing references them) |
| `public/art2d/manifest.json` | All five: `sheet.side` removed (down/up mirrored), `stride` from the filmed loop (table below). `height`, `anchor`, `shadow`, `facing`, `facingUp` unchanged |
| `tools/sprites/omni_units.py` | The cut table: `python3 tools/sprites/omni_units.py <clip_dir> [job ...]` rebuilds all twenty sheets (jobs `rb-down` … `es5-death`) |
| `tools/sprites/veo_to_sheet.py` | Unchanged (every flag needed already existed) |
| `tests/render/omniUnits.test.ts` | New: wiring, no side strip, grid fits the WebP, walk fill = old strip fill ±0.05, stride vs filmed loop, attack contact frame + blow ≤ `ENEMY_MELEE` interval, death at the walk px scale |
| `tests/sim/chapterFourEnemies.test.ts`, `chapterFiveEnemies.test.ts` | `sheet.side` is now expected absent for every ch4/ch5 type |
| `qa/omniunits.mjs`, `qa/omniunitgif.py`, `qa/omniunitcompare.py` | One-Chromium zoo check, death GIF, old-vs-new contact sheet |
| `docs/omni-unit-shots/` | Shots (below) |

No `src/` change: the sim and renderer are untouched. The clips stay out of git (20 × 3–5 MB). They are in `/home/claude/work/ref/skyhold-p5-clips/` on hermes.

### Keying

Every cut uses `--unmix` plus `--core` (3 px for walks and attacks, 1 px for deaths, so pebbles, frost and shards near the pile survive). `--core` drops the clip's cast shadow and backdrop specks.

- **Veilcaster veil (pale lilac).** Keyed cleanly, no fix needed. The veil is opaque enough that the unmix keeps it as art. Its hue matches the old painted strip: median 322° new vs 325° old, over pale, mid-saturation pixels. Over dark ground it reads as a dusty lilac-pink, as in the start plate. The alpha has no holes.
- **Shadow Half cape (translucent violet).** Keyed cleanly, no recolour. Median hue is 267° new vs 263° old. The cape comes out a little more opaque and lighter than the old strip's cape, which matches the Omni start plate. Its see-through edges stay soft.
- **Shadow Half attack.** `--core` drops the dark specks and flashes. `--glow --glow-reach 40` keeps the punch's gold swirl as warm light instead of salmon paint. A faint dark-violet haze stays around the halo at the punch; it reads as aura.
- **Hound and Shadow Half deaths.** `--glow` keeps the tail fire and the halo flames orange/gold, not crimson.

### Size, anchor and timing

- **Size.** The renderer maps walk `frameH × 0.94` to the manifest `height`. The walk sheets are padded (`--fill`) so the median figure fills the frame like the old strips did. The old fills were measured from the strips (alpha > 128 bbox, median): beetle 0.848 / 0.837, sledge 0.880 / 0.832, hound 0.853 / 0.902, caster 0.837 / 0.842, Shadow Half 0.848 / 0.821 (down / up). New fills are within 0.005 of those, except the hound walk-up: 0.879 vs 0.902. That clip's union box is already tight, and `--fill` can only pad, never crop. That is a 2.5 % smaller hound on up-walks. The test allows ±0.05. The zoo shot and `compare-contact.jpg` confirm the on-screen size is unchanged.
- **Feet anchor** is the bottom-centre of the body. Attack and death sheets use a fixed anchor from their first frame (`--fixed-anchor`), so lunges and piles don't slide.
- **Death scale.** Deaths are drawn with the walk sprite's px scale (`EnemyLayer.playDeath`), so their first frame is cut to the walk "down" figure height (`--fig-px`).
- **Attack scale.** The renderer scales attack frame 0 to the walk figure height (`figScale`). Each attack therefore starts on a standing pose close to the walk pose. For the hound this matters: its clip coils small and then lunges toward the camera, ending bigger. The cut starts on the big standing pose from the end of the clip (src 92, 96) and skips the coil, which would otherwise pop to half size. The lunge frames are still ~1.2× the standing figure. That is the "wide lunge" of the clip.
- **Walk loops.** The default loop search (0.6–1.6 s, starting in the first second) picked a half cycle (one step, so the same leg always leads) on five clips. A lag scan of each clip (mean thumbnail difference vs lag) gives the full two-step cycle. `--min-seconds` / `--max-cycle` hold the search to it, and `--loop-from 0:150 --max-seconds 8` searches the whole clip where the first second loops badly (veilcaster down: 21.1 → 4.6).
- **Stride.** Each foe has one `stride` for both walk sheets: world units per loop = sim speed × loop length. Where the two loops differ in length, the geometric mean is used, so each plays within ±17 % of its filmed rate. The test bounds this at 0.8–1.25.

  | id | speed (u/s) | loop down / up (s) | old stride | new stride | played / filmed (down, up) |
  | --- | --- | --- | --- | --- | --- |
  | rimebeetle | 1.9 | 1.33 / 1.83 | 1.0 | **2.97** | 1.17, 0.85 |
  | sledguard | 1.4 | 1.42 / 1.67 | 1.5 | **2.15** | 1.08, 0.92 |
  | duskhound | 2.6 | 0.92 / 0.92 | 1.35 | **2.38** | 1.00, 1.00 |
  | veilcaster | 1.75 | 1.67 / 1.75 | 1.15 | **2.99** | 1.03, 0.98 |
  | eclipse_shade | 1.05 | 1.58 / 1.58 | 1.5 | **1.66** | 1.00, 1.00 |

  With the old strides, the 16–22-frame loops would have run 1.5–3× too fast (the beetle's 16-frame loop at stride 1.0 = 0.53 s). The new strides look large next to the foes' heights (1.4–2.1 u) because these foes are fast for their size. The beetle and the caster cover two body-heights per two-step cycle.
- **Attack timing.** Each attack is hand-picked frames at 12 fps. A blow fits in its `ENEMY_MELEE` interval: beetle 12 f = 1.00 s (every 1.0 s), sledge 16 f = 1.33 s (1.33 s), hound 10 f = 0.83 s (0.87 s), caster 15 f = 1.25 s (1.25 s), Shadow Half 15 f = 1.25 s (1.25 s). `impact` is the contact frame (lead 0.42–0.67 s).
- **Death length.** Deaths are 17–21 frames (1.4–1.75 s) and end on the settled pose. The game then fades the clip out over 0.2 s.

## Per clip

Loop score = mean thumbnail difference between the loop's first and last frame; lower is better. For scale, the shipped Omni foes are `golem` 23.7 and `boss` ~19, and the Warden walk is 5.27. "Old" = the 6-frame painted strip at `505272d1`.

| Clip | Source | Frames / fps | Loop score | Keyed OK? | Old vs new at game scale | Kept / replaced | Regenerate? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Beetle walk-down | `rb-walk-front`, src 4–35 (1.33 s) | 16 @ 12, 324×256 | 8.54 | Yes | New better: six legs ripple, antennae sway. Old: 6 stiff poses | **Replaced** | No |
| Beetle walk-up | `rb-walk-back`, src 3–46 (full cycle; the 20-frame half cycle scored 2.76 but alternates the tripods wrongly) | 22 @ 12, 260×256 | 5.62 | Yes | New better | **Replaced** | No |
| Beetle attack | `rb-attack`, picked 24…52, contact = src 40 (mandibles out) | 12 @ 12 (lead 0.58 s, dur 1.0 s), `impact` 7 | — | Yes | New better: rears, bites, drops back. Old: one lunge pose | **Replaced** | No |
| Beetle death | `rb-death`, picked 40…88 | 17 @ 12 (1.4 s), ends on the frozen heap | — | Yes; frost sparkles partly kept | New better: legs curl under, shell slumps, rime glints | **Replaced** | No |
| Sledge walk-down | `sg-walk-front`, src 0–34 | 17 @ 12, 231×256 | **2.13** | Yes | New clearly better: pushes the sled, real steps | **Replaced** | No |
| Sledge walk-up | `sg-walk-back`, src 23–63 (full cycle; half cycle 11.05) | 20 @ 12, 205×256 | 13.59 | Yes | New better | **Replaced** | No |
| Sledge attack | `sg-attack`, picked 15…90, contact = src 38 (shield fully out) | 16 @ 12 (lead 0.67 s, dur 1.33 s), `impact` 8 | — | Yes | New better: pulls in, bashes, holds, recovers | **Replaced** | No |
| Sledge death | `sg-death`, picked 22…84 | 18 @ 12 (1.5 s), ends slumped over the sled | — | Yes | New better: shield drops, kneels, slumps | **Replaced** | No |
| Hound walk-down | `dh-walk-front`, src 20–41 (fast run, one gallop stride) | 11 @ 12, 281×256 | 5.61 | Yes; tail fire stays orange | New clearly better: a real gallop | **Replaced** | No |
| Hound walk-up | `dh-walk-back`, src 22–43 | 11 @ 12, 278×256 | 8.96 | Yes | New better; 2.5 % smaller than the old strip (fill 0.879 vs 0.902) | **Replaced** | No |
| Hound attack | `dh-attack`, picked 92,96,30…88, contact = src 39 (jaws at full lunge) | 10 @ 12 (lead 0.42 s, dur 0.83 s), `impact` 5, 392×256 | — | Yes | New better: springing bite. The lunge grows ~1.2× (the clip lunges toward the camera); the coil before the spring is skipped | **Replaced** | Optional: a re-render that lunges sideways, without the camera-ward growth, would allow the coil |
| Hound death | `dh-death`, picked 8…94 | 18 @ 12 (1.5 s), 412×284, ends lying on its side, fire out | — | Yes (`--glow` keeps the flames orange). Frame is 284 px tall: the howl's tail fire rises above the head | New more dramatic: howls with flaring tail fire, collapses, the fire dims to embers. Old: 6-frame slump | **Replaced** | No |
| Caster walk-down | `vc-walk-front`, src 88–128 (whole clip searched; best start in the first second was 21.1) | 20 @ 12, 242×256 | **4.58** | Yes: veil lilac, no fringe | New clearly better: robe and veil flow | **Replaced** | No |
| Caster walk-up | `vc-walk-back`, src 137–178 (full cycle; half cycle 16.6) | 21 @ 12, 258×256 | 14.6 | Yes | New better | **Replaced** | No |
| Caster attack | `vc-attack`, picked 3,7,10,12,33…80, contact = src 40 (staff thrust, veil flares) | 15 @ 12 (lead 0.67 s, dur 1.25 s), `impact` 8 | — | Yes | New better: wind-up, thrust, veil flare. Src 13–31 face the camera straight and are skipped, so frame 3 → 4 is a quick staff swing | **Replaced** | Optional: a cast that stays three-quarter throughout would remove the jump |
| Caster death | `vc-death`, picked 24…110 | 19 @ 12 (1.6 s), 387×248, ends as a heap of robes beside the dropped staff | — | Yes | New better: staff drops, kneels, crumples | **Replaced** | No |
| Shadow Half walk-down | `es5-walk-front`, src 84–122 (full cycle; the default picked a 16-frame single step, 17.8) | 19 @ 12, 203×256 | 6.9 | Yes: cape violet, halo clean | New clearly better | **Replaced** | No |
| Shadow Half walk-up | `es5-walk-back`, src 2–40 | 19 @ 12, 170×256 | **4.46** | Yes | New better; cape slightly more opaque than the old strip's | **Replaced** | No |
| Shadow Half attack | `es5-attack`, picked 22…96, contact = src 52 (fist out, flash) | 15 @ 12 (lead 0.58 s, dur 1.25 s), `impact` 7, 307×256 | — | Yes: specks dropped, gold swirl as light. A little dark-violet haze at the halo during the punch | New far better: wind-up, punch with a gold swirl, cape sweep. Old: one punch pose | **Replaced** | No |
| Shadow Half death | `es5-death`, picked 3…98 | 21 @ 12 (1.75 s), 349×260, ends on the armour heap | — | Yes: halo flames gold, the small shards survive `--core 1` | Different: the old strip dissolved into smoke; the new one kneels, cracks and collapses into an armour heap (the brief's description of the clip) | **Replaced** | No |

No new sheet was worse than its old strip, so none of the old strips was kept.

## Old strips

The old `walk-down/up`, `attack` and `death` files were overwritten in place, because the manifest references those paths. The five `walk-side` strips were deleted: nothing references them, and a missing sheet already falls back to the front sprite / tinted placeholder. The old strips remain:

- in git at `505272d1:public/art2d/anim/<id>-*.{webp,json}` (`qa/omniunitcompare.py` reads them from there);
- repackable from the source atlases `design/art-2d/chapter4/` / `chapter5/` (`tools/sprites/chapter_enemies.py`).

**Size:** the 20 sheets are 6.4 MB of WebP (the old 25 strips ≈ 2 MB). Per sheet that is 197–434 KB, in line with the existing Omni sheets (200–650 KB). The largest texture is 3296 × 852 (hound death). Story runs load each foe's art only on the islands whose waves have it (`enemyArtSet.ts`).

## Verification

- `npx tsc --noEmit` passed. `npm run lint` passed. `npm run build` passed (only the usual chunk-size warning).
- `npx vitest run --maxWorkers=3`: 157 files passed, 2 skipped. 2,175 tests passed, 19 skipped. `omniUnits.test.ts` has 25 tests.
- No sim change, so the balance sims were not re-run.
- One Chromium (`python3 qa/withPreview.py --port=4474 node qa/omniunits.mjs`), 1280×800, `?zoo=1&types=rimebeetle,sledguard,duskhound,veilcaster,eclipse_shade&quality=high`. Result: no page or console errors. Each lethal probe hit started a death clip (counter 4 → 10; the Shadow Half step also caught a tower kill).
  - [zoo-1280x800.jpg](omni-unit-shots/zoo-1280x800.jpg): all five walking. The beetle is top-right, the Shadow Half and caster are mid-left, the sledge is fighting a soldier bottom-right (red from a hit flash), and the hound is bottom-left.
  - [deaths-1280x800.jpg](omni-unit-shots/deaths-1280x800.jpg): a full frame during the sledge's death.
  - [ingame-death-frames.jpg](omni-unit-shots/ingame-death-frames.jpg): in-game crops at +0 … +2.2 s. SwiftShader screenshots take ~0.5 s, so there are only 3–4 per clip. In the beetle's +1.2 s crop, the sim's rime patch burst covers the heap.
  - [death.gif](omni-unit-shots/death.gif): the five death clips at 12 fps, 1.6× game scale, over a map crop (`qa/omniunitgif.py`).
  - [compare-contact.jpg](omni-unit-shots/compare-contact.jpg) and [compare.gif](omni-unit-shots/compare.gif): old strip vs new sheet per clip at matching scale. A yellow bar marks the contact frame.

## Open points

- Strides are 1.1–3× the old values (table above), set from the filmed loops as the brief asks. If the owner prefers busier legs, lower `stride`: the loop then plays faster than filmed and the feet slide.
- The hound's lunge grows ~1.2× during the bite, and the caster's cast skips the camera-facing raise (a quick staff swing between frames 3 and 4). Both read fine at game scale; a re-render would be the clean fix.
- The beetle's walk-up loop (1.83 s) is longer than its walk-down loop (1.33 s). One stride serves both, so each plays ±17 % off its filmed rate.
