# Handoff: a painted frame around the fitted map (opus, branch `hermes/skyhold-frame`, 2026-11-19)

Base `art-2d` (c822ef8, HUD dock merged). UI / render only: no sim, balance, data or HUD-placement
change. Owner decision kept: HUD dock + the smaller fitted map (`docs/handoff-opus-hud.md`).

## What changed (what the player sees)

The letterbox bands around the fitted map used to be the map's outermost 2 px stretched across
them. That gave streaks (very visible on i24: vertical stripes left and right). The bands are now a
frame (`src/render2d/mapFrame.ts`, drawn by `MapView`):

1. **Backdrop**: the island's own painting, downsampled to 160 px wide, box-blurred (r 8, 3
   passes ≈ Gaussian σ ≈ 5 % of the width), desaturated (60 % colour kept) and darkened (× 0.6).
   It is built **once per map** on a small canvas (CPU blur, no per-frame filter) and drawn behind
   the map, scaled up around the map's centre until it covers the screen (+4 % overscan for camera
   shake). Colours carry on from the map's edges into the bands: sea-blue beside the coast islands,
   violet on the moonlit ones, near-black on ember / i16, warm on sand. No streaks, and no
   recognisable mirrored castle or cave (everything is a soft blob). The backdrop is hidden when the
   map covers the whole screen (no overdraw).
2. **Shadow**: a soft dark falloff (cubic, ~4.5 % of the short screen side) outside each map edge
   that has an open band, plus radial corner pieces. 8 small sprites; nothing drawn under the map.
3. **Vignette**: a light radial darkening of the screen corners.
4. **Border**: a thin painted moulding hugging the image, outside it (from the map outward: dark
   contact line, gilt line, wood, warm top-light, dark rim). 8 px at 1080 p, 4 px on phones. It sits
   *under* the world container, so a sprite standing proud of the map edge is drawn over it, not
   cut by it.

**Low quality tier** (`?quality=low`, or the governor dropping to low): keeps backdrop + border
(they are what makes the bands read as a frame) and drops the shadow + vignette (two alpha-blended
layers). `MapView.setQuality` is called wherever `fx.setQuality` already was in `game2d.ts`.

Fallbacks: no DOM / unreadable bitmap → flat dark fill `0x1c1914` (never throws). Canvas textures
use `CanvasSource` directly, so they don't go through Pixi's resource cache.

### Cost
The backdrop takes **19–53 ms once per map** (warm; ~20 ms at 1366x768 / phone bakes, ~50 ms for
the bigger 2560 bake) in headless software Chromium (swiftshader, the QA browser). The first, cold
load measured 183 ms (l1c). See `docs/frame-shots/report.txt`. Measured live: `__p0.mapFrame().backdropMs`.
Most of it is reading the big source bitmap; a GPU-backed canvas should be faster. Per frame: one
screen-sized sprite (backdrop), one screen-sized sprite (vignette, not on low), 8 shadow strips and
one static Graphics. These are the same order of cost as the old 8 band sprites.

## Files
- `src/render2d/mapFrame.ts` (new): pixel helpers (`boxBlurRGBA`, `gradeRGBA`), backdrop / shadow /
  vignette textures, `borderWidth`, `shadowReach`, `backdropPlacement`.
- `src/render2d/mapView.ts`: band layout rewritten (backdrop, shadow, vignette, border), `setQuality`,
  `frameInfo()` (QA).
- `src/render2d/game2d.ts`: `map.setQuality(tier)` next to the three `fx.setQuality` calls.
- `src/render2d/main2d.ts`: `__p0.mapFrame()` QA hook.
- `tests/render/mapFrame.test.ts` (new, 6 tests): blur keeps flat images flat and gives a monotone
  ramp (no overshoot / streaks), grade maths, no-DOM fallback, border sizes, and **the backdrop
  covers the screen + overscan, centred on the map, on all 25 islands × 6 screens with the real HUD
  dock fit** (scale ≤ 2.2 × the map's).
- `qa/frameshots.mjs` (new): the shots below; asserts backdrop = blur + border whenever a band is
  open, low tier has no shadow / vignette, and `hudCheck` 0 overlaps on every shot. `--quick=1` is
  a one-shot-per-island sweep for all biomes.
- `qa/withPreview.py`: `--port=N` (passes `--base=` to the script), refuses a port that is already
  taken (a stale preview from another checkout), starts vite with `node node_modules/vite/bin/vite.js`
  instead of `npx` (terminating npx can orphan vite). Default use is unchanged.

## Verification

### Shots (`docs/frame-shots/`, all looked at, zoomed crops of borders / corners / bands)
l1c, i06, i12, i16 mid-battle (wave ≥ 2, foes on the roads) and i24 on its boss wave (Colossus on
the north road) at 1920x1080, 2560x1080, 1366x768 and 844x390 (DPR 2, touch), plus
`low-i24-844x390` at `?quality=low`. 21 shots, `report.txt`: **problems 0, overlaps 0 on every
shot**. All shots use `&quality=high`, because headless swiftshader would otherwise calibrate to low.

Also swept all 25 islands at 1920x1080 (`--quick=1`, contact sheet looked at): meadow, coast, snow,
sand, wheat, moonlit, marsh, ember, highland, chapter-two kits. The frame reads the same everywhere
and nothing streaks. Bright biomes (i03 snow, i06 sand) give a mid-grey / teal band, and the
shadow is visible as a soft halo. Dark biomes (i12 moonlit, i16 ember) give a deep band, and the
gilt line still separates the map.

### HUD placement (`qa/hudplace.mjs --part=check`, build of commit 12cdff3)
**25 islands × 6 screens = 150 combos, 0 overlaps, 0 pieces outside their slot, 0 page errors →
`problems: 0`**. The new-foe heads-up was checked in the info slot 30 times. Report:
`docs/frame-shots/report-hudcheck.txt`. The later commit only changed how the backdrop is
downscaled plus a QA field, so placement is unaffected (and `frameshots` re-ran `hudCheck` on it:
0 overlaps). The foe-card probe missed its tap on 19 combos (i02 / i06 / i21 mostly, as in the HUD
session). That flakiness is known: the next-wave card and every dock piece were still checked
there.

### Gate (final code)
`npx tsc --noEmit` 0 errors · `npm run lint` 0 problems · `npm test` **98 files passed / 1 skipped,
1296 tests passed / 11 skipped** (+6 new) · `npm run sim:balance` **PASSED (41 levels)** ·
`npm run build` OK.

## Open / notes
- When a band is thinner than the border (i06 / i24 at 2560x1080: 3–5 px top / bottom), the
  moulding runs along the screen edge, cropped. It looks like a picture frame cut by the screen,
  which I judged fine. Hiding the border on sides with a band < border width is a one-line change
  if the owner prefers it.
- On the phone, the hero tray's right edge and the Settings / Codex captions overlap the border
  line by a few px. Both are dock pieces allowed over the map image, so that is expected.
- Tuning knobs, all in `mapFrame.ts`: `BACKDROP_BRIGHTNESS` (0.6), `BACKDROP_SATURATION` (0.6),
  `BACKDROP_BLUR_R` / `_PASSES`, `borderWidth`, `shadowReach`, the vignette stops. The moulding
  colours are in `MapView.layoutBands`; the shadow alpha (0.55) is in the `MapView` constructor.
- No dedicated wood / parchment frame art exists in the UI kit (`story-frame` is an open book), so
  the border is procedural Graphics in the kit's palette. A painted 9-slice frame could replace it
  later without touching the layout.
