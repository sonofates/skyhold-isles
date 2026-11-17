# PROGRESS — skyhold-night-islands (ISLANDS agent)

Branch `hermes/skyhold-night-islands`. Deadline 09:00 TR. Updated each round.

NOTE: level order in code is L1 Sunlit Meadow, L2 Twin-Bridge Cay, L3 Highland Citadel, L4 Emerald Stepping
Stones, L5 Windmill Switchback, L6 Crescent Lagoon, L7 Skybridge Gauntlet, L8 Sunken Bastion, L9 Grand Skyhold
(README lists a different order; ignore it).

## How to look at the art without a browser
`npx tsx scripts/previewMap.ts <1-9|all> [outDir=/tmp/skyhold-preview] [yawQuarter=0] [width=1400] [col,row,halfWidth]`
Headless software rasteriser: runs the real MapBuilder/DecorBuilder in Node with the raw Kenney GLBs and writes PNGs
(flat shading, no AO/shadows/water shader; sky/water colours from the theme). Open PNGs with the Read tool.
`[col,row,halfWidth]` crops/zooms onto a grid point. It prints triangle + draw-call counts per island
(~34-50k tris, 17-22 map+decor draw calls per island).

## Status (round 1, running)
All checks green on the last commit: `npx tsc --noEmit`, `npm run lint`, `npm test` (79 tests), `npm run build`,
`npm run sim:balance` (all 9 islands inside their windows; nothing in the sim/data balance numbers changed this
round except wave composition of a few waves, see below).

### Done
1. Audit (below) + preview tool.
2. **Theme system** (render-only, keyed by `LevelDef.id`, so new levels from other branches fall back to
   `DEFAULT_THEME` and `LevelDef` is untouched): `src/render/islandThemes.ts` (types/helpers),
   `islandThemeTable.ts` (the 9 authored themes). Per theme: path style (dirt/stone/sand via colormap cell remap),
   grass tint + soft tint zones, ground kinds (sand / cobble / golden furrowed field / moss), cliff colours + depth,
   tree mix (new: pine w/ snow caps, palm, autumn, blossom), decor-bake odds, detail palettes (wheat tufts, shells,
   starfish, flower colours), hillocks on free decor tiles (rocky/snow-capped on highland/skybridge), bridge style
   (timber w/ lanterns, rope w/ emerald lanterns, stone parapets + masonry piers), spawn-gate crystal colour, goal
   crystal colour/glow + goal trimmings (pillars, gold pillars, shards, sheaves, shells, pennant poles), water
   colour, sky/sun mood (`SceneManager.setAtmosphere`), ambient (birds, butterflies, falling leaves, themed islets).
3. **Set pieces** (`setPieceGeometry.ts`, `setPieces.ts`): windmill (rotating blades), cottage, lighthouse, waterfall
   (animated streaks), arch/ruin wall/pillars (optional half-sunk plinth for water placement), banners (swaying cloth),
   crystal grove (emissive), dock + bobbing boats, watchtower, hay bales, scarecrow, brazier (flame), sea stack
   (+crystal variant), snow peak, obelisk, gatehouse (unused). Static parts merged into 1 mesh (+1 emissive mesh);
   animated parts are instanced per family (blades/cloth/flow/boat/flame) -> ~7 extra draw calls max.
   Placement rule (tested): set pieces only sit on decor (`T`) tiles or open water, never on buildable/path tiles.
4. Islands now each read differently:
   - L1 meadow: flower-heavy, blossom/oak trees, cottage, hay, welcome banners, butterflies, boat.
   - L2 cay: sandy beaches around 3 timber docks with boats, palms, harbour braziers, lantern bridges.
   - L3 highland: cool pine/snow hillocks, stone path, cobble keep court, watchtower + banners, 2 waterfalls off the
     south/east cliffs, 3 snow peaks in the background, tall cliffs.
   - L4 emerald: deep emerald grass, 6 glowing crystal groves + 2 crystal sea stacks, rope viaducts w/ lanterns,
     crystal islets, butterflies.
   - L5 windmill: golden furrowed fields (2), 2 windmills, hay bales, scarecrows, autumn trees, falling leaves,
     warm golden-hour sky.
   - L6 lagoon: sand ring + sand paths, palms, lighthouse in the lagoon, 3 docks, boats, sea stacks, turquoise sea.
   - L7 skybridge: stone paths/parapet bridges, cobble fort courts, 4 watchtowers, banners, broken arch, sea stacks
     in the chasm, tall dark cliffs, high-altitude sky.
   - L8 bastion: dusky sky, mossy cobbles, ruined arch/walls/pillars standing in the moat on half-sunk plinths,
     torches, indigo banners, watchtowers.
   - L9 skyhold: marble cliffs, big cobble court, obelisk, 4 corner towers, gold banners, gold goal crystal,
     sunset sky, ruin islets.
5. **Waves**: every wave of every island has a flavour `name` (new optional `WaveDef.name`, data only - see UI notes).
   One "two-front surge" wave per island (second group arrives after a long gap): L2 W9 Twin-Bridge Rush, L3 W9
   Avalanche, L5 W10 Scarecrow's Gambit, L6 W9 Riptide, L7 W12 Pincer, L8 W9 The Drowned March, L9 W13 Pincer of the
   Crown; L1 W7 became the flyer-led "Gull Squadron"; L4 W11 "Cinder Bloom" is splitter-led. Sim windows unchanged.
6. Level subtitles rewritten to describe the new identity (short enough for the menu cards).
7. More landmarks (ponds, harbour stalls, beach huts/parasols, tents + campfire, cabins, cairns with prayer flags,
   statues, fountain), fortress parapets (low crenellated wall rims on L3/L7/L8/L9, never beside the route), water
   details (lily pads, buoys, driftwood bobbing on the shader's wave field), fireflies (L8) / crystal moths (L4).
8. **Themes for the enemies branch's islands 10-12 are already in `islandThemeTable.ts`** (ids `confluence-terraces`,
   `galewatch-spires`, `stormcrown-citadel`). I verified placement + sight-line tests against their level files by
   temporarily copying them into the tree (not committed). After merging, run `npx vitest run tests/render`: if a
   layout changed, the tests tell which set piece now sits on a buildable/route tile or hides the route.
9. Wave identity tweaks on top of names: L4 splitter-led (crystal shards), L5 grunt-heavier, L8 healer-heavier.
10. `balanceSim --robust` prints greedy lives at HP x0.97/0.985/1/1.015/1.03 (informational knife-edge detector).

11. Quality/readability: stone paths use the darker slate swatch (grey brutes and light units stay readable), tall
    landmarks are kept out of the route's sight lines for all 4 camera quarter-turns (test), hillocks beside the
    route are capped low, `low` graphics quality hides fliers / leaves / water props.
12. Tests added: `tests/render/islandThemes.test.ts` (placement rules, draw-call budget < 40 for map+decor, finite
    geometry, dispose, biome fallback), `tests/render/siteLines.test.ts`, `tests/sim/waveNames.test.ts`.
13. Themed bushes (hide under built towers), sheep pen, street lamps; two independent code-review passes (all
    findings fixed: dock boats on the waterline, snow flag, bird orbits, sheep head, tent door, ...).
14. Docs: `docs/island-themes.md` (theme authoring guide + preview workflow), README touch-ups.

### Round 2 (render-only polish; sim/data untouched, sim:balance unchanged and green)
- L9: rising golden sky lanterns (`AmbientSpec.leafRise`), L3: drifting snowflakes (leaf mode, white).
- L6: `sailboat` set piece (new `sail` anim family) circles the lighthouse; test keeps its orbit over open water.
- L1: two tethered `kite` set pieces (new `kite` anim family, string + swaying diamond); added to the sight-line test.
- New instanced families each cost 1 extra draw call (budget test still < 40).

### Round 3 (render-only)
- Braziers (L2, L8, ...) now emit 3 rising ember sparks each (new `ember` anim family, +1 draw call on islands with braziers,
  no shadow casting). Re-checked previews of all islands at several camera yaws: nothing overlaps routes. Hide-on-build for
  ground details already existed (flowers/tufts/bushes/pebbles hide under towers). Sim/data untouched.

### Round 4 (render-only)
- L7: three swaying `windsock` set pieces (new `sock` anim family: tapered striped sleeve swinging on a pole) on decor tiles
  (2,0), (11,0), (5,0); added to the sight-line test. Preview checked; draw calls on L7 map+decor stay ~18-19.
- All checks green (tsc, lint, 134 tests, build, sim:balance unchanged: every island inside its window).
- Scarecrow animation dropped (no good low-cost cloth part; static scarecrow reads fine).

## Audit (what was samey before)
All 9 islands shared: one flat height, identical grass tint, same 3-tree mix on every `T` tile, same ambient
(4 islets + 5 clouds), same goal sanctuary and spawn gate, same sky/water. Only the grid shape differed.
`Windmill Switchback` had no windmill, `Crescent Lagoon` no beach/palms, `Skybridge Gauntlet` no real bridges,
`Sunken Bastion` no ruins/moat feel, `Highland Citadel` no mountain feel. Layouts themselves are decent (snake,
twin bridges, spiral, stepping stones, double hairpin, atoll ring, chasm, moat keep, citadel loop) -> I left grids
and path waypoints alone (the scripted greedy/weak builds depend on tile coords, and the sim is fragile).

## Balance stability analysis
The sim is chaotic around the boss waves: with the lives windows (Challenging 12-16, Heroic 8-13, Master 5-10) a
greedy run has to leak "exactly one boss" to be in window, so +-2% HP flips most islands (e.g. L1 20 -> 13 lives at
+3%, L4 15 -> 9 at +2%). Only L7/L8 stay in window across +-4%. I did not try to hide this by retuning (every
retune just moves the cliff). Suggestion for the lead: judge windows on min/median over +-2% neighbours (use
`npm run sim:balance -- --robust`) or make the boss leak cost less of a cliff.

Current `--robust` table (greedy lives at enemy HP x0.97 / 0.985 / 1.0 / 1.015 / 1.03, `!` = outside window):
```
L1 Breezy      20  20  20  20  13!      L6 Heroic      18! 18! 13  10  6!
L2 Challenging 20! 15  15  12  10!      L7 Heroic      4!  10  10  10  8
L3 Heroic      15! 15! 9   10  5!       L8 Master      9   7   7   8   10
L4 Challenging 20! 20! 15  14  6!       L9 Master      13! 9   9   9   4!
L5 Challenging 20! 18! 14  14  14
```
Lives come in 5-life steps because a leaking boss costs 5, hence the cliffs.

Experiments (round 1): L2 startingGold 260 -> 300 (kept): calmer first waves (peak progress 16/24% instead of 72/82%) and
the greedy window now survives HP x1.0..x1.03 (15/14/14 lives; before 15/12/10!). Sweeping the L4 final-wave boss
spacing showed the sim is not smooth at all (3, 6, 6.5, 7, 7.5, 8, 9 s give unrelated outcomes), so I stopped trying
to widen plateaus by hand.

### Pressure metric (new)
`npm run sim:balance -- --peaks` prints, per wave, the furthest path progress (%) any ground enemy reached in the
greedy run (0 = dies at the spawn, 100 = leaked). This is the only continuous difficulty signal the sim gives
(lives only change on boss waves). Readings: L1 smooth ramp 30 -> 82; L2/L3 start tense (70-85% from wave 1);
L4 stays 18-60% until the boss (loose mid-game); L8/L9 sit at 85-95% from wave 1 (Master). Careful: thinning
early waves does NOT soften them, it starves the economy (kill rewards) and the island collapses later
(tried on L2/L3: L2 greedy 15 -> 7 lives). Ramps have to be tuned together with rewards / clearBonus.

## Merge notes for the lead
- Expect small textual conflicts with the other night branches in: `src/render/mapBuilder.ts` (enemies branch changed
  the path-mask loop for extra lanes, my `isRoute`/theme code sits a few lines above), `src/render/renderWorld.ts`
  (one line each), `scripts/balanceSim.ts` (enemies added `livesByType`; I added `peakGroundProgress`, `--levels`,
  `--robust`, `--peaks`), `src/data/levels/types.ts` (they add `lane`/`elite`/`extraGroundPaths`, I add `WaveDef.name`).
- After merging run: `npx tsc --noEmit && npm run lint && npm test && npm run build && npm run sim:balance`, then
  `npx tsx scripts/previewMap.ts all` to eyeball every island (incl. 10-12) and `npx vitest run tests/render`.
- Islands without an authored theme get a deterministic biome preset derived from their id (no set pieces).

## Next (ideas, in rough priority)
- Re-verify everything after the lead merges the towers/enemies branches (see Merge notes).
- More authored moments: (ember sparks round 3, L7 windsocks round 4 done); animated scarecrow not done.
- If wave pacing is to be tuned further, do it together with kill rewards / clearBonus (see Pressure metric).
- Layout/path changes were deliberately NOT attempted: every grid tweak invalidates both scripted build orders and
  the knife-edge windows; the themes make the existing layouts read very differently already.
- Optional: surface `WaveDef.name` in the wave preview / start toast (UI owner).

## Decisions
- Themes live in render code keyed by level id, not in LevelDef (avoids merge conflicts with other branches).
- No grid / waypoint changes: scripted builds + balance windows stay valid.
- `scripts/balanceSim.ts` accepts `--levels=3,6` (the harness here forbids env-var prefixes).

## UI needs (not done: ui is off limits)
- `WaveDef.name` exists for all L1-L9 waves; the wave preview / "wave started" toast could show it.
- Nothing else.

## Known issues
- Preview rasteriser ignores shadows/AO/post-processing: judge composition and colour relations, not final shading.
- The `peak` set pieces on L3 sit outside the grid; if the camera pan bounds clip them it is only cosmetic.

## Cross-area changes
- `src/render/sceneManager.ts`: added `setAtmosphere()` (sky gradient/fog/hemi/sun colours per island); default
  call with `{}` reproduces the old look. Called from `RenderWorld.loadLevel` (one line + import).
- `src/data/levels/types.ts`: `WaveDef.name?: string` (optional, data only).
- `materials.ts` is untouched; per-level water colour and goal glow are set on the shared materials at map build.

### Round 28 (render-only: leaping fish)
- New `fish` set piece + `leap` anim family (instanced, no shadow, +1 draw call on islands that use it): a small fish arcs out of the water about every 6 s (per-fish period/offset), hidden under the surface in between. Placed on L2 Twin-Bridge Cay (2) and L6 Crescent Lagoon (3). Test `keeps leaping fish over open water` guards placement (footprint ~0.7 tile, must be water/off-grid).
- tsc, lint, 143 tests, build, `sim:balance` green (sim/data untouched; greedy L1 20 / L2 15 / L3 9 / L4 15 / L5 14 / L6 13 / L7 10 / L8 7 / L9 9).

### Round 48 (render-only: cottage chimney smoke)
- Cottages (L1 and the cottage variant in the theme table) now puff three pale smoke wisps from the chimney, reusing the `ember` anim family (instanced, shadowless; +1 draw call on islands without braziers; L1 map+decor now 27 draws, budget test still < 40).
- tsc, lint, 143 tests, build green; sim/data untouched, so the `sim:balance` result at the start of this round stands (greedy L1 20 / L2 15 / L3 9 / L4 15 / L5 14 / L6 13 / L7 10 / L8 7 / L9 9; every weak script loses L2+).

### Round 59 (render-only: waterfall spray)
- Waterfalls (L3's two cliff falls, plus any other theme using the piece) now throw 4 white spray particles up from the plunge pool, reusing the `ember` anim family (no new draw call on islands that already have braziers/cottages; L3 map+decor 23 draws, budget test < 40 unaffected).
- tsc, lint, 143 tests, build, `sim:balance` green (sim/data untouched; greedy L1 20 / L2 15 / L3 9 / L4 15 / L5 14 / L6 13 / L7 10 / L8 7 / L9 9; every weak script loses L2+).
- Handoff state unchanged; see "Merge notes for the lead".

### Rounds 5-72 (verification only, collapsed)
- Many rounds re-ran tsc / lint / tests / build / `sim:balance` on a clean tree; the only source changes after round 4 were the render-only rounds 28, 48 and 59 above. Result every time: green, greedy L1 20 / L2 15 / L3 9 / L4 15 / L5 14 / L6 13 / L7 10 / L8 7 / L9 9 lives; every weak script loses L2+. Rounds 72-81 re-ran tsc + lint + tests (+ build, full sim:balance in 77) + `sim:balance`: unchanged.
- Handoff state final; layout/path and wave-ramp changes deliberately untouched (knife-edge windows). See "Merge notes for the lead".
- Rounds 82-114: tsc, lint, 143 tests, build, `sim:balance` re-run on clean tree every round: unchanged, green (greedy L1 20 / L2 15 / L3 9 / L4 15 / L5 14 / L6 13 / L7 10 / L8 7 / L9 9; every weak script loses L2+). Handoff state final.
