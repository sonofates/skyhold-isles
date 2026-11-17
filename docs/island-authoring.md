# Authoring a new island (layout → waves → balance)

Used for Amberstone Mesa, Moonwell Crossing and Emberglass Sanctum (L14–L16). Everything is deterministic and runs
headless; the whole loop is a few minutes per island.

1. **Layout + lanes.** Write `src/data/levels/levelN.ts` (copy a sibling). Lanes are axis-aligned waypoint lists that
   start on an `S` tile and end on the shared goal `G`; extra lanes may run on tiles of earlier lanes (merge). A lane may
   cross *itself* at right angles (Moonwell's pretzel); it may not run along its own tiles twice (`tests/sim/waves.test.ts`).
   `scripts/levelTool.ts` renders a land mask + lane waypoints into the `layout` strings (`renderLayout`).
2. **Waves.** 20–24 named waves (unique names, ≤ 32 chars), 1–2 bosses, a few elite groups, every extra lane used.
   `lane: n` on a wave group picks `extraGroundPaths[n-1]`. Register the level in `src/data/levels/index.ts`.
3. **Seed the build orders.** `npx tsx scripts/levelTool.ts <n> --seed-from=13 --write` ranks the buildable tiles by road
   coverage and re-targets level 13's scripted/weak orders onto them (a starting point only).
4. **Optimise the greedy script.** `npx tsx scripts/tuneBuildOrder.ts --level=<n> --hp=<scale a bit above the target> --iters=400 --write`
   hill-climbs tower types/sites/timing for mean lives over HP ×{0.985,1,1.015} and writes the greedy order plus a derived
   weak order (≈70% of the towers, default targeting, half the upgrades, a wave late — the sim requires 64–74%).
5. **Pick the HP scale.** `npx tsx scripts/hpSweep.ts --level=<n> --scales=… --growth=0.06,0.08` and choose values where greedy
   ends inside the difficulty window (Master 5–10 lives) with neighbours inside too. Low `waveHpGrowth` (0.06–0.08) plus a
   higher `enemyHpScale` removes the "everything dies on the final wave" cliff. Finish with `npm run sim:balance -- --robust`.
6. **Theme.** Add an entry to `src/render/islandThemeTable.ts` keyed by the level id (see `docs/island-themes.md`); set pieces
   only on decor (`T`) tiles or open water, tall landmarks must not hide the road (render tests tell you).
7. **Checks.** `npx tsc --noEmit && npm run lint && npm test && npm run build && npm run sim:balance`.
