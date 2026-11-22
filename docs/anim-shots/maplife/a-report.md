# Map Life Rollout — Group A (`i01`–`i08`)

Procedural map-life layer rollout for campaign islands `i01`–`i08`.
Renderer (`src/render2d/mapLifeLayer.ts`) was **not modified** — all islands opt in purely via `src/data/mapLife/<id>.json` and precomputed sway masks under `public/art2d/life/<id>-sway.webp`.

## Summary Table

Desktop viewport: `2000×991` (dpr 1, `quality=high`, `hero=none`, `mapAnim` + `ambientFx` active in both phases).
Changed-pixel metrics compare two live frames **1.5 s apart**: `sum|ΔRGB| > 30` (primary), plus `sum|ΔRGB| > 15` and `mean |ΔRGB|` (captures subtle low-alpha cloud shadow drift across large open areas).

| Island | Biome | Sway Mask Coverage (nonzero / ≥128) | Changed px `>30` (before → after) | Changed px `>15` (before → after) | Mean `\|ΔRGB\|` (before → after) | Enabled Layers |
|---|---|---:|---:|---:|---:|---|
| `i01` | Sunny Poppy Meadow / Orchard | 40.65% / 35.92% | 2.586% → 4.454% | 4.310% → 10.907% | 3.21 → 7.79 | Wind (`2.0 px`), Clouds (`3`, α 0.115), Birds (`3–5`, warm brown), Butterflies (`8`, 6 zones) |
| `i02` | Coastal Tidal Estuary / Salt Meadow | 13.58% / 9.00% | 1.100% → 1.415% | 1.583% → 7.727% | 1.26 → 4.13 | Wind (`1.85 px`), Clouds (`3`, α 0.11), Birds (`4–7`, pale gulls `#eef4f8`) |
| `i03` | Snowy Alpine Highlands | — (wind off) | 0.498% → 0.479% | 0.868% → 1.826% | 0.55 → 1.81 | Clouds (`2`, overcast α 0.085), Birds (`2–4`, dark alpine ravens `#2b2f3c`) |
| `i04` | Emerald Forest Terraces / Crystal Grove | 42.28% / 37.25% | 0.883% → 7.704% | 1.363% → 17.610% | 1.04 → 9.52 | Wind (`2.1 px`), Clouds (`3`, α 0.12), Birds (`3–6`, woodland brown), Butterflies (`6`, 5 zones) |
| `i05` | Golden Autumn Harvest / Wheat Orchard | 2.91% / 2.15% | 5.519% → 4.398% | 7.558% → 10.009% | 6.40 → 7.14 | Wind (`2.15 px`, tall wheat outside `mapAnim`), Clouds (`3`, α 0.125), Birds (`4–6`, dark rooks `#2e241d`) |
| `i06` | Sunny Sandy Atoll / Coastal Lagoon | — (wind off) | 2.216% → 1.937% | 3.382% → 6.354% | 2.67 → 4.53 | Clouds (`4`, α 0.105), Birds (`4–7`, bright coastal gulls `#f5f8fa`) |
| `i07` | Windswept Highland Gorge / Moorland | 23.28% / 17.47% | 0.819% → 1.311% | 1.255% → 7.792% | 0.97 → 4.51 | Wind (`2.05 px`), Clouds (`3`, brisk speed 58), Birds (`3–5`, highland swifts `#343238`) |
| `i08` | Twilight Marshland & Moat | 26.94% / 22.01% | 0.499% → 2.011% | 0.715% → 5.609% | 0.88 → 3.92 | Wind (`1.75 px`), Clouds (`2`, dusk α 0.095), Birds (`2–4`, slow marsh birds `#2c2e38`) |

> Note on `i03`, `i05`, `i06` `>30` values: `i03` (falls/rapids), `i05` (windmill sails + 7 large wheat video loops), and `i06` (8 ocean/lagoon surf loops + SW palms) already run periodic `mapAnim` video loops whose phase varies slightly between live 1.5 s captures. Low-opacity drifting cloud shadows primarily shift pixel channels by 15–25 RGB, reflected in the 1.3×–4.9× jump in `>15` coverage and `mean |ΔRGB|` across every island.

## Islands Deliberately Without Wind Sway

- **`i03` (Snowy Alpine Highlands)**: Nearly the entire terrain is snowfield, ice, cliff rock, cobble road, and buildings. The only notable foliage cluster (`northeast-spruce-stand`) is already animated via `src/data/mapAnim/i03.json`. Snowfields and rock must never sway, so wind sway is omitted and life comes from cool overcast cloud shadows and sparse alpine birds.
- **`i06` (Sunny Sandy Atoll / Coastal Lagoon)**: Terrain is beach sand, wet-sand road, sandbars, tidepools, ocean surf, and lagoon water. The only foliage (`southwest-palm-fronds`) is already animated via `src/data/mapAnim/i06.json`. Sand and water must never sway, so wind sway is omitted and life comes from coastal cumulus shadows (4) and pale seagulls.

## Mask Notes & Visual QA

- Every sway mask (`i01`, `i02`, `i04`, `i05`, `i07`, `i08`) was generated via `tools/map-life/gen_sway_mask_a.py` (importing shared helpers from `gen_sway_mask.py` without modifying it) and visually verified via its overlay (`docs/anim-shots/maplife/<id>/<id>-sway-mask-overlay.jpg`).
- Strictly zero on every road vertex/midpoint, plot centre/rim, entrance cave, goal castle, bridge/crossing, landmark, building, water channel/lake/moat, cliff rim, sand flat, harvested stubble (`i05`), and `mapAnim` video-loop rect.
- Browser Playwright QA (`tools/map-life/qa_shots_a.mjs`, Chromium `159.0.8154.6`) verified all 8 islands on `2000×991`:
  - `0` console errors / `0` page errors across all 8 islands.
  - `swayReady === true` on all 6 wind islands, `false` on `i03`/`i06`.
  - Pause (`Space`) freezes `mapLife.time` on all 8 islands.
  - `reducedMotion: true` cleanly disables and tears down `mapLife` on all 8 islands.
  - Bird flocks spawn cleanly via `stepMapLife`.
- Total added JPG assets under `docs/anim-shots/maplife/i0*`: **5.7 MB** (14 JPGs: 8 desktop screenshots + 6 mask overlays).

## Verification & Open Merge Note

- `npx tsc --noEmit`: **PASS**
- `npm run lint`: **PASS**
- `npm run build`: **PASS**
- `npx vitest run tests/render/mapLifeMasks-a.test.ts`: **17/17 PASS**
- `npx vitest run` (full suite): **136 passed, 2 skipped, 1 failed** (**1746 passed, 15 skipped, 1 failed** of 1762 tests).
  - The **sole failure** is `tests/render/mapLifeLayer.test.ts` lines 167 & 174 (`expect(getMapLifeConfig('i01')).toBeUndefined()` and `expect(mapLifeLayer(..., 'i01', ...)).toBeUndefined()`), which used `'i01'` as an unconfigured-island placeholder during the `i17` pilot. Per task constraints ("Do not touch `mapLifeLayer.test.ts`"), that file was left untouched; once group A merges, update those two `'i01'` assertions to `'nonexistent'` (or an unconfigured id).
