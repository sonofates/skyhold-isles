# PROGRESS — skyhold-night-islands (ISLANDS agent)

Branch `hermes/skyhold-night-islands`. Deadline 09:00 TR. Updated each round.

## Status (round 1)
- Baseline verified green: tsc, lint, tests, sim:balance all pass on `cfb9330`.
- NOTE: level order in code is L1 Sunlit Meadow, L2 Twin-Bridge Cay, L3 Highland Citadel, L4 Emerald
  Stepping Stones, L5 Windmill Switchback, L6 Crescent Lagoon, L7 Skybridge Gauntlet, L8 Sunken Bastion,
  L9 Grand Skyhold (README lists a different order; ignore it).

## Audit (what is samey today)
All 9 islands share: one flat height, identical grass tint, identical tree mix (3 kinds, random), same
decor on every `T` tile, same ambient (4 islets + 5 clouds), same goal sanctuary, same spawn gate. The only
difference between levels is the grid shape. `Windmill Switchback` has no windmill, `Crescent Lagoon` has no
beach/palms, `Skybridge Gauntlet` has no bridges in the visual sense, `Sunken Bastion` has no ruins/moat feel,
`Highland Citadel` has no mountain/pine feel.

## Plan
1. Dev tool `scripts/previewMap.ts`: headless software rasteriser that renders MapBuilder/DecorBuilder output to
   PNG (no browser on this box), so art can be checked visually.
2. `src/render/islandThemes.ts`: per-level theme table keyed by level id (render-side, so `LevelDef` is untouched
   and new levels from other branches fall back to a default theme).
3. Per-theme: grass tint/sand patches, tree mix (pine/palm/autumn/blossom), cliff stone colors, ambient (birds,
   islets), signature set piece (windmill, lighthouse, ruins, waterfall, banners, bridges...).
4. Waves, layout, rebalance (after visuals).

## Done
(nothing yet)

## Next
see Plan.

## Decisions
- Themes live in render code keyed by level id, not in LevelDef (avoids merge conflicts with other branches).

## Known issues

## Cross-area changes
(none yet)
