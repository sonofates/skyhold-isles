# New islands art handoff

| Island | Before at `2306a1c1` | Working-tree painting |
| --- | --- | --- |
| i25 · Galeglass Orrery | An armillary in an open shale meadow | A survey arcade carries a bronze quadrant above the cloud cliffs. A tripod beacon and paired survey stones mark the opposite rim. Blue glass ribs frame both enemy entrances. [Map](../public/art2d/map-i25-layered@1x.webp) |
| i26 · Cinderlift Terraces | A small hoist and an ochre road on ochre ground | A lift gantry suspends its bucket over the lower canyon. Twin furnaces and a cooling trough flank the slag yard. A pale haul road connects the ore kilns to the keep. [Map](../public/art2d/map-i26-layered@1x.webp) |
| i27 · Wickweavers’ Strand | A winding jack on a narrow strip of shore | A wick loft hangs drying skeins above a moored punt. Orchard rows and a flax-loading jetty follow the banks. Reed-thatched weirs open onto the towpaths. [Map](../public/art2d/map-i27-layered@1x.webp) |

At 932 × 430, i26’s median road-to-shoulder luminance contrast rose from 1.32∶1 to 3.18∶1 across the same 156 samples. A comparison with the base revision confirmed identical paths, pad coordinates, enemy spawn points and keep placement. The level JSON edits register the new entrance silhouettes for depth sorting.

## Before and after files

The biome paths below are relative to `design/art-2d/v2/biomes/`. Braces list filename alternatives.

| Before | After |
| --- | --- |
| `highlands/{terrain,land}-i25.webp` and `highlands/storm-cave-e.webp` | Repainted plate and land mask at the same paths. Added `highlands/gate-shard-grotto-e.webp`. |
| `ember/{terrain,land}-i26.webp`, `ember/tex-furnace-grit.webp` and `ember/mesa-cave-e.webp` | Repainted plate, land mask and road tile at the same paths. Added `ember/gate-ore-kiln-e.webp` and the heat-region source `ember/haze-i26.webp`. |
| `tidal/{terrain,land}-i27.webp` and `tidal/gate-cave-e.webp` | Repainted plate and land mask at the same paths. Added `tidal/gate-reed-weir-e.webp`. |
| `tools/map-compose/campaign.json` and `src/data/levels2d/{i25,i26,i27}.json` | Updated the three art recipes and six enemy-front registrations in place. |
| `public/art2d/map-{i25,i26,i27}-layered*.webp` | Replaced all 30 files in place. Each island has a master, 1×, 1.5× and native 3× map, plus A, B and goal fronts at both shipping tiers. All 30 resolve through the existing keys in `public/art2d/manifest.json`. |
| `public/art2d/life/{i25-sway,i26-haze,i27-sway,i27-water}.webp` and their `tests/fixtures/*-mask.{json,gray.gz}` pairs | Rebaked four masks and refreshed all eight fixtures. `tools/map-life/gen_new_island_surfaces.py` now uses the painted heat regions and writes the surface fixtures. |
| `design/art-2d/new-islands/islands.md` | Updated the terrain, gate and haul-road prompts for the built-in image generator. Added this handoff. [Prompts](../design/art-2d/new-islands/islands.md) |

## Verification

- `npx tsc --noEmit` passed. Vitest passed 1,832 tests, including default-view HUD coverage, and skipped 15. The full suite ran with `npx vitest run --maxWorkers=2`.
- `python3 -B tools/map-compose/rebake_all.py i25,i26,i27 --jobs 2` passed for all 57 pads. All 30 manifest images decoded at the expected dimensions. All four life masks measured zero over every road footprint and pad ellipse.
- `node qa/plotCoverCheck.mjs --ids=i25,i26,i27` stopped at Chromium startup with `shutdown: Operation not permitted`. The live HUD check and browser screenshots remain for the owner.
