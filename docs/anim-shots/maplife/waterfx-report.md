# Procedural Water Shimmer & Desert Dust / Heat Haze Report (`i10`, `i14`, `i15`)

Data-driven procedural water shimmer (`i10`, `i15`) and desert dust wisps + subtle open-sand heat haze (`i14`) added to `src/render2d/mapLifeLayer.ts`. All effects are strictly opt-in per island JSON (`src/data/mapLife/<id>.json`); islands without the new blocks keep their exact prior behaviour and shader.

## Summary & Before/After Measurements

Desktop viewport: `2000×991` (`dpr=1`, `quality=high`, `hero=none`, `lang=en`), captured in headless Chromium (Playwright + SwiftShader WebGL2) over a `1.5 s` interval (`sum|ΔRGB| > 30` and `> 15` pixel percentages).

- **Before (`mapLife` frozen)**: `mapAnim` video loops + `ambientFx` advancing `1.5 s` with `mapLife` frozen.
- **Prior `mapLife` (`b-report.md`)**: Grass sway + clouds + birds + butterflies (before water/dust/haze).
- **After (Water / Dust / Haze FX)**: Full `mapLife` live with the new single-pass water/haze shader and desert dust wisps.

| Island | Mask (`923×426`, `>0` / `≥128`) | Before (`>30` / `>15`) | Prior `mapLife` (`>30` / `>15`) | After Water/Dust FX (`>30` / `>15`) | Cropped FX Area (`>30` / `>15`) | Active Features |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **`i10`** (Willow Stream Terraces) | `i10-water.webp` (`0.64%` / `0.50%`, `2.6 KB`) | `0.250%` / `0.402%` | `1.503%` / `5.633%` | **`1.414%` / `6.296%`** | `0.675%` / `6.275%` | Single-pass **wind sway + flowing water** (`1.35 px` max UV ripple, 5 blended flow regions incl. weir/sluice chute at `1.55×`, warm sunlit `#faeec0` glints), clouds, birds, butterflies |
| **`i14`** (Ember Caravan Desert) | `i14-haze.webp` (`25.09%` / `18.89%`, `34.5 KB`) | `0.114%` / `0.140%` | `0.949%` / `2.045%` | **`1.086%` / `2.478%`** | `2.093%` / `4.553%` | **10 airborne dust wisps** (`α=0.145`, warm `#f0d3a6`/`#f7e3c4`, 3 drift bands across courtyard/canyon/wash, `6` on `med`), single-pass **subtle sand heat haze** (`0.62 px`), clouds, birds (no `wind` block) |
| **`i15`** (Moonlit Hollow Pools) | `i15-water.webp` (`3.36%` / `2.57%`, `8.0 KB`) | `0.198%` / `0.323%` | `0.859%` / `1.430%` | **`1.437%` / `3.300%`** | `2.266%` / `5.340%` | Single-pass **wind sway + still moonlit water** (`1.15 px` horizontal-biased pond ripples, cool silver `#c2dcff` glints across west cove, NE pond, south lily pond, and moon-well basin), clouds |

## Mask Approach & Exclusion Verification

Generated deterministically by `tools/map-life/gen_water_mask.py` (`--all --overlays --fixtures`) at `0.5×` layout resolution (`923×426`, lossless WebP) with gzipped test fixtures (`tests/fixtures/<id>-{water,haze}-mask.{gray.gz,json}`):

- **`i10` (`i10-water.webp`)**: Segments cool greenish-teal stream pixels (`H 106..215°`, `S ≥ 0.16`) inside the inverted `land-i10.webp` channel + the bottom weir/sluice chute (`H 112..210°` + weir crest foam, strictly excluding the tan stone sluice walls and timber gate). Excludes all 5 bridges/crossings (`+22 px`), composited rocks/lantern/props (map-vs-terrain diff with vignette-safe chroma threshold), roads, all 25 plots (centre + rims), entrances/castle, and both `mapAnim` rects (`east-terrace-channel`, `bridge-tributary`), with inward bank erosion and inward Gaussian feathering.
- **`i14` (`i14-haze.webp`)**: Segments open terracotta desert sand (`H 11..22.5°`, `S ≥ 0.64`) inside eroded `dressing-i14.webp` (keeping sandstone cliffs stationary), explicitly excluding the tiled west courtyard (`(110, 170, 595, 575)`), roads, all 24 plots, 3 entrances, castle, 7 landmarks, agave/scrub props, and all 4 `mapAnim` rects (`dry-wash-dust`, `merchant-awning`, `date-palm-fronds`, `potter-striped-shade`).
- **`i15` (`i15-water.webp`)**: Segments the 3 reflection ponds (west moonlit cove, NE pond, south-center lily pond) and the tiny turquoise moon-well basin (`(683, 474, 722, 498)` inside the stone rim). Excludes composited standing stones, ringed starry puddles, shore reeds/grass tufts, lotus flowers & lily pad clusters, mossy boulder, purple caves, castle, roads, all 26 plots (including plots sitting along the west cove edge and inside the south pond), and both `mapAnim` rects (`west-pool-reflection`, `north-pool-moonlight`).

Every mask is verified by unit tests (`tests/render/mapLifeWaterFx.test.ts`) to be strictly `0` on every path vertex, path midpoint, plot centre and 4 rim points, entrance, goal, and `mapAnim` rect centre.

## Shader Design & Performance Notes

- **Single full-map pass budget**: `SurfacePass` mounts at most **one** fullscreen quad `Mesh` in `swayRoot` (index `1` of `MapView.world`, immediately above the map sprite and strictly below `mapAnimLayer`, `ambientFx`, plots, units, bars, and UI).
  - Wind-only islands keep the exact original `SWAY_FRAGMENT` shader (1 mask sampler, zero overhead).
  - Wind + water islands (`i10`, `i15`) run `SURFACE_WATER_FRAGMENT` in **one draw call** with two mask samplers (`uMask` + `uWaterMask`), early-`discard`ing pixels where both masks are `< 0.004` and performing a single `uMap` sample per active pixel.
  - Per-region flow vectors (up to 6 `vec4` UV rects + `vec4` flow/speed/glint vectors) blend with a `0.024` UV soft-box feather so stream bends and the weir chute transition seamlessly.
  - Heat-haze-only islands (`i14`) run `SURFACE_HAZE_FRAGMENT` in one draw call with early `discard` off open sand.
- **Desert dust wisps (`i14`)**: Two soft elongated multi-lobe dust ribbon textures (`256×64` each) packed into the previously unused bottom strip (`y = 192..256`) of the existing refcounted `512×256` `MapLifeAtlas` (zero extra atlas memory). Mounted in `dustLayer` inside `butterflyRoot` (strictly below plots, towers, units, HP bars, and all UI). Pre-allocated with zero per-frame heap allocations.
- **Quality tiers, pause, reduced motion & lifecycle**:
  - `low` tier / `reducedMotion` / `document.hidden`: disabled & unbuilt (`0` GPU resources, `0` atlas refs).
  - `med` tier: reduces shader detail (`uWaterParams.w = 0.55`, skipping secondary capillary ripple octave) and trims `i14` dust wisps (`10 → 6`) and clouds.
  - Pause freezes `time`; `smallBake` swaps `uMap` seamlessly; `destroy()` / `pagehide` frees mesh, geometry, shader, mask sources, dust sprites, and releases the shared atlas (`mapLifeAtlasRefCount() === 0`).
- **SwiftShader WebGL2 desktop frame times (2000×991 software GL)**: `i10` p50 `100.0 ms`, `i14` p50 `66.7 ms`, `i15` p50 `83.4 ms` (zero `pageerror` / `console.error` across `high`, `med`, and `low` tiers).

## Visual QA Artifacts

Saved under `docs/anim-shots/maplife/<id>/`:
- `i10`: `desktop.jpg`, `strip-waterfx.jpg` (6-frame 3 s crop of mid-stream, bridges, lower stream, weir chute), `i10-water-mask-overlay.jpg`, `diff-desktop-4x.jpg`, `diff-crop-6x.jpg`, `measurements.json`
- `i14`: `desktop.jpg`, `strip-waterfx.jpg` (6-frame 3 s crop of courtyard dust, open sand, road & plots), `i14-haze-mask-overlay.jpg`, `diff-desktop-4x.jpg`, `diff-crop-6x.jpg`, `measurements.json`
- `i15`: `desktop.jpg`, `strip-waterfx.jpg` (6-frame 3 s composite crop of west moonlit cove + moon-well & south lily pond), `i15-water-mask-overlay.jpg`, `diff-desktop-4x.jpg`, `diff-crop-6x.jpg`, `measurements.json`

Visual strip & 6× diff inspection confirmed:
- Flowing stream ripples & warm sunlit glints on `i10` follow each bend and accelerate cleanly over the weir chute with zero shimmer on banks, rocks, bridges, roads, or plots.
- Cool silver moonlight ripples on `i15` breathe softly across the west cove, NE pond, south lily pond, and moon-well basin while standing stones, lily pads, white lotus flowers, plots, and moonstone roads remain completely crisp and stationary.
- Pale warm dust wisps on `i14` drift calmly across the courtyard, dunes, and wash below plots/units/UI, with subtle calm heat shimmer restricted strictly to open terracotta sand.
