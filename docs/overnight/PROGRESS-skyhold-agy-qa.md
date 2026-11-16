# Overnight Progress — QA Harness (`skyhold-agy-qa`)

Branch: `hermes/skyhold-agy-qa` (base: `main` at `cfb9330`)

## Done
- Initialized QA harness progress tracking.
- Fixed stale `TowerEntity` test fixture in `tests/render/towerPicking.test.ts` (`recoil` / `stunTimer` / `kills`) discovered while checking strict TypeScript compatibility across `tests/`.
- Added `scripts/ci.ts` and `npm run ci` (`tsc --noEmit` + `eslint` + `vitest` + `sim:balance` + `build`) with per-step timing and clear summary output (`--fail-fast` supported).

## Next
- Build headless fuzz playthrough harness (`scripts/fuzzPlay.ts` + `npm run sim:fuzz` + fast `tests/sim/fuzzPlay.test.ts`).
- Fill unit test gaps:
  - `tests/platform/storageAndProgress.test.ts` (`storage.ts` load/save/migration/corrupt/throw handling + `recordWinProgress` / unlocks + `recordEndlessProgress`)
  - `tests/sim/endlessAndPool.test.ts` (`getRewardMultiplier`, `buildEndlessWaveDef`, endless transitions, `ObjectPool` & `EnemySystem`/`ProjectileSystem` pool exhaustion paths)
  - `tests/core/gameLoop.test.ts` (`FixedTimestepStepper` edge cases, negative/NaN `rawDt`, `resetAccumulator`, speed changes, `alpha`, paused/inactive)
  - `tests/sim/targeting.test.ts` (targeting tie-breakers & boundary ranges)
- Add sim performance benchmark script (`scripts/simBench.ts` + `npm run sim:bench`) at 100 / 250 / 360 enemies with 40 towers and soft phone budget assertion.

## Decisions
- Avoided editing `src/data/levels/index.ts` or `balanceSim.ts` to prevent merge conflicts with ENEMIES / ISLANDS branches.
- Kept `npm test` fast (<60s) and deterministic.

## Known Issues / Findings in `src` (Reported Only or Isolated)
- `src/data/levels/index.ts` does not re-export `ScriptedBuildAction`, though `scripts/balanceSim.ts` imports it from there (ignored at runtime by `tsx`, flagged only if strict `tsc` checks `scripts/`).
- `src/platform/storage.ts`: `loadProgress` checks `typeof parsed.unlockedLevelIndex === 'number'` without `Number.isFinite(...)` (unlike `bestStars`/`bestEndlessWaves`); harmless for valid JSON numbers except extreme overflow `1e999` (`Infinity` clamps to `levelCount - 1`), and `levelCount <= 0` edge case.
- `src/core/gameLoop.ts`: `FixedTimestepStepper.step(NaN, ...)` propagates `NaN` into `elapsedVisualTime` and `alpha` (planning trivial isolated `Number.isNaN(rawDt)` guard + test).

## Cross-area Changes
- None yet.
