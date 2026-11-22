# Map-Life Rollout Report — Group B (`i09`–`i16`)

Procedural map-life layer (`src/render2d/mapLifeLayer.ts`, zero renderer changes) rolled out to islands `i09` through `i16`.

## Summary Table

Desktop viewport: `2000×991` (`dpr=1`, `quality=high`, `hero=none`, `lang=en`), measured in real headless Chromium (Playwright) over a `1.5 s` interval (`sum|ΔRGB| > 30` fraction, with `> 15` in parentheses). `Before` freezes `mapLife` while advancing existing `mapAnim` video loops and `ambientFx` for `1.5 s`; `After` runs live with `mapLife` enabled.

| Island | Biome | Mask Coverage (`>0` / `≥128`) | Changed Pixels (`>30` / `>15`) Before → After | Enabled Features |
| :--- | :--- | :---: | :---: | :--- |
| **`i09`** | Royal Orchard Garden (daytime lush lawn, marble road, balustrades) | `44.14%` / `37.63%` | `0.312% → 1.086%` (`0.553% → 6.112%`) | **Wind** (`1.95 px`, calm breeze + sunlit sheen), **Clouds** (`3`, `α=0.115`, `#1b3048`), **Birds** (`[3,5]`, `#4a3828`), **Butterflies** (`8`, 6 garden zones) |
| **`i10`** | Willow Stream Terraces (daytime olive terraced meadow, blue stream, 5 bridges) | `39.29%` / `31.52%` | `0.315% → 1.503%` (`0.451% → 5.633%`) | **Wind** (`2.05 px`, water & banks strictly `0`), **Clouds** (`3`, `α=0.12`, `#193045`), **Birds** (`[3,6]`, `#443627`), **Butterflies** (`6`, 6 terrace zones) |
| **`i11`** | Gale Sky Highlands (daytime emerald clifftop meadows above cloud sea) | `27.44%` / `22.44%` | `0.124% → 2.341%` (`0.141% → 12.555%`) | **Wind** (`2.25 px`, brisk gusts, chasm/cliffs/rock ledges strictly `0`), **Clouds** (`4`, `α=0.125`, speed `58`, `#1a2f52`), **Birds** (`[4,7]`, cool slate `#3e4858`) |
| **`i12`** | Twilight Hollow Glade (dusk purple-lavender feathery meadow, lanterns, shrine) | `35.17%` / `27.87%` | `0.108% → 0.741%` (`0.126% → 1.193%`) | **Wind** (`1.55 px`, `sheen=0`, lanterns/stumps/stones/shrine strictly `0`), **Clouds** (`2`, `α=0.08`, `#130f26`), **Birds** (sparse dusk `[2,3]`, `#241a33`, `shadowAlpha=0.08`) |
| **`i13`** | Misty Slate Watch Ridge (overcast barren wet slate rock plateau) | `—` (wind off) | `0.549% → 1.025%` (`1.542% → 4.434%`) | **Clouds** (`3`, overcast `#17202c`, `α=0.11`, speed `52`), **Birds** (`[3,5]`, dark slate `#2b323d`) |
| **`i14`** | Ember Caravan Desert (sunny terracotta sand dunes, sandstone cliffs, bazaar) | `—` (wind off) | `0.222% → 0.949%` (`0.255% → 2.045%`) | **Clouds** (`2`, warm shadow `#3d1e14`, `α=0.095`), **Birds** (`[2,4]`, desert hawks `#4a2a18`, crisp shadow `[38,54]`) |
| **`i15`** | Moonlit Hollow Pools (deep night blue-lavender clearing with 3 reflection ponds) | `36.27%` / `28.46%` | `0.238% → 0.859%` (`0.306% → 1.430%`) | **Wind** (`1.45 px`, `sheen=0`, all 3 ponds + starry puddles strictly `0`), **Clouds** (`2`, night `#0c1429`, `α=0.085`) |
| **`i16`** | Obsidian Furnace Sanctum (volcanic ash, magma fissures, forge) | `—` (wind off) | `0.642% → 1.174%` (`1.125% → 2.878%`) | **Clouds** (`3`, drifting volcanic ash-plume shadows `#1a110e`, `α=0.11`) |

## Islands Where Wind Sway Was Deliberately Left Off

- **`i13` (Misty Slate Watch Ridge)**: Bare terrain (`terrain-i13.webp`) is almost entirely fractured grey-blue wet slate rock with only two tiny gnarled trees on the far left edge. Rock must never sway; atmosphere is carried by swift overcast cloud shadows, soaring slate ravens, and existing mist/rain-sheen/pennant animations.
- **`i14` (Ember Caravan Desert)**: Terrain is pure terracotta desert sand and sandstone cliffs; the lone date palm already has a dedicated `mapAnim` video loop (`date-palm-fronds`), and the merchant awnings are likewise video-animated. Sand and stone must never sway; atmosphere is carried by warm desert cloud shadows and soaring desert hawks.
- **`i16` (Obsidian Furnace Sanctum)**: Terrain is volcanic ash, obsidian cliffs, crystals, and glowing magma fissures with zero wind-swaying vegetation. Ash, rock, and lava must never sway; atmosphere is carried by drifting dark ash-plume cloud shadows complementing existing embers, smoke, and magma animations.

## QA & Verification Notes

- All 5 sway masks (`i09`, `i10`, `i11`, `i12`, `i15`) were generated with `tools/map-life/gen_sway_mask_b.py` (importing shared helpers from `gen_sway_mask.py` without modifying it) and visually inspected via `<id>-sway-mask-overlay.jpg` and 4× browser `diff-desktop-4x.jpg` heatmaps.
- Automated Playwright checks passed on every island (`i09`–`i16`): zero `pageerror`/`console.error`, Space-bar pause freezes `mapLife.time`, `reducedMotion` disables & tears down `mapLife`, and `quality=low` keeps `mapLife` unbuilt and disabled.
- Total added QA image footprint across `docs/anim-shots/maplife/i09`–`i16`: `5.4 MB` (well below the ~25 MB limit).
