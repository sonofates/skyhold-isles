# Map-Life Rollout Report — Group C (`i18`–`i24`, `l1c`)

Desktop (2000×991, High quality) visual QA measured via Playwright (`tools/map-life/qa_maplife_c.mjs`) comparing two live frames 1.5 s apart with map life OFF (`before`: `mapAnim` + `ambientFx` only) vs ON (`after`: `mapAnim` + `ambientFx` + `mapLife`). Pause freeze, reduced-motion disable, and zero console/page errors were verified on every island.

## Summary Table

| Island | Biome | Mask Coverage % | Changed Pixels (`sum\|ΔRGB\|>30`) before → after | Mean `\|ΔRGB\|` before → after | Enabled Features |
| :--- | :--- | ---: | ---: | ---: | :--- |
| **`i18`** (Lantern Glassworks) | Underground crystal cavern / glassworks | 0.00% *(no wind)* | 0.432% → 0.372%* | 0.65 → 0.91 | Subtle vault haze shadows (2 clouds, α=0.075), sparse cavern swifts/bats (2–3) |
| **`i19`** (Lanternseed Fig) | Sunlit tropical figwood canopy | 16.42% | 2.219% → 3.783% | 2.91 → 5.88 | Wind sway (strength 2.05), canopy clouds (3, α=0.115), forest birds (3–5), butterflies (8, 6 zones) |
| **`i20`** (Three Pennants Head) | Stormy coastal headland | 21.85% | 2.168% → 3.248% | 2.66 → 6.44 | Brisk wind sway (strength 2.20), squall clouds (3, α=0.12), pale coastal gulls (3–6) |
| **`i21`** (Kitewright Down) | Breezy chalk downland / sky meadow | 27.64% | 0.828% → 1.166% | 1.28 → 4.79 | Wind sway (strength 2.15), sky-meadow clouds (4, α=0.11), downland swifts (4–7), butterflies (7, 6 zones) |
| **`i22`** (Brineglass Ferry) | Underground salt mine & brine sinkhole | 0.00% *(no wind)* | 1.323% → 1.138%* | 1.73 → 2.19 | Subtle subterranean shadows (2 clouds, α=0.07), sparse cavern swifts/bats (2–3) |
| **`i23`** (Waxlight Orchard) | Golden autumn orchard & apiary meadow | 32.48% | 1.411% → 2.172% | 1.78 → 5.20 | Gentle wind sway (strength 1.90), autumn clouds (3, α=0.105), orchard birds (4–6), butterflies (8, 6 zones) |
| **`i24`** (Lastlight Head) | Dusk coastal sea-fort headland | 33.30% | 2.549% → 2.892% | 2.39 → 5.70 | Sea-breeze wind sway (strength 2.10), dusk clouds (3, α=0.115), pale gulls/terns (3–5) |
| **`l1c`** (Meadow Crossing) | Classic storybook sunny daisy meadow | 35.33% | 1.263% → 1.901% | 2.17 → 5.40 | Calm wind sway (strength 2.00), sunny clouds (3, α=0.125), meadow birds (4–6), butterflies (8, 6 zones) |

*\*On the two underground cavern islands (`i18`, `i22`), wind sway is deliberately omitted; subtle low-alpha vault shadows (`α=0.07–0.075`) produce `< 30` per-pixel RGB deltas over the dark stone floor while raising full-frame `mean |ΔRGB|` (`0.65 → 0.91` on `i18`, `1.73 → 2.19` on `i22`). The slight `gt30` variance reflects live `mapAnim` crystal/water loop phase between the two runs.*

## Notes & Rationale

- **Wind deliberately omitted (`i18`, `i22`):** Both islands are enclosed subterranean caverns (`glassworks` biome: slate rock floor, quartz/halite crystals, kilns, and the `i22` brine sinkhole water pool) with zero grass or wind-blown foliage. Life is provided through subtle drifting vault shadows and sparse small cavern swifts/bats instead.
- **Mask cleanliness:** Every swaying island (`i19`, `i20`, `i21`, `i23`, `i24`, `l1c`) was generated with biome-tuned HSV thresholds and explicit prop exclusions via `tools/map-life/gen_sway_mask_c.py` (without modifying `gen_sway_mask.py`), visually inspected via `docs/anim-shots/maplife/<id>/<id>-sway-mask-overlay.jpg`, and locked by sha256 + raw grayscale fixtures in `tests/render/mapLifeMasks-c.test.ts` (strictly `0` on all path vertices, path midpoints, plot centres/rims, entrances, goals, landmarks, painted props such as `i19`'s ancient fig trunk and `i21`'s fallen kite, rocks, water, and `mapAnim` rects).
- **Renderer changes:** None (`src/render2d/mapLifeLayer.ts` and `src/render2d/main2d.ts` untouched).
- **Artifact footprint:** Total added JPG screenshots + overlays across all 8 islands is ~5.1 MB (well within the 25 MB budget).
