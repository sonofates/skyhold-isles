# Overnight Progress — QA Harness (`skyhold-agy-qa`)

Branch: `hermes/skyhold-agy-qa` (base: `main` at `cfb9330`)

## Done
- Fixed stale `TowerEntity` test fixture in `tests/render/towerPicking.test.ts` (`recoil` / `stunTimer` / `kills`).
- Added `scripts/ci.ts` and `npm run ci` (`tsc --noEmit` + `eslint` + `vitest` + `sim:balance` + `build`) with per-step timing and clear summary output (`--fail-fast` supported).
- Built headless fuzz playthrough harness:
  - `scripts/fuzzPlay.ts` + `npm run sim:fuzz` (CLI flags: `--seeds=N`, `--level(s)=...`, `--seed=S`, `--endless-waves=N` for single-seed failure repro).
  - Exercises all 4 profiles (`competent`, `balanced`, `chaotic`, `minimal`) across every island (`LEVELS`), varying legal builds, upgrades, sells, targeting changes, Meteor/Overcharge abilities (plus pre-first-wave rejection guards), `FixedTimestepStepper` speeds (1x/2x/3x) & pauses, auto-wave toggles, early wave calls, story wins -> Endless Mode continuation, and determinism double-run verification.
  - Asserts strict tick-by-tick invariants: finite positions/HP/progress/timers, non-negative integer gold & bounded lives, exact enemy conservation (`spawned === killed + leaked + active`), no pool overflows under normal/endless play, `gameWon`/`gameLost` firing at most once and matching state.
  - Added fast Vitest fuzz suite `tests/sim/fuzzPlay.test.ts` (4 seeds/island + 3 endless waves/island + replay determinism across all 9 islands in ~6.6s).

## Next
- Fill remaining unit test gaps:
  - `tests/platform/storageAndProgress.test.ts` (`storage.ts` load/save/migration/corrupt/throw handling + `recordWinProgress` / unlocks + `recordEndlessProgress`)
  - `tests/sim/endlessAndPool.test.ts` (`getRewardMultiplier`, `buildEndlessWaveDef`, endless transitions, `ObjectPool` & `EnemySystem`/`ProjectileSystem` pool exhaustion paths)
  - `tests/core/gameLoop.test.ts` (`FixedTimestepStepper` edge cases: negative/NaN `rawDt`, `resetAccumulator`, speed changes, `alpha`, paused/inactive)
  - `tests/sim/targeting.test.ts` (targeting tie-breakers & boundary ranges)
- Add sim performance benchmark script (`scripts/simBench.ts` + `npm run sim:bench`) at 100 / 250 / 360 enemies with 40 towers and soft phone budget assertion.

## Decisions
- Fuzz harness reuses `scripts/fuzzPlay.ts` from `tests/sim/fuzzPlay.test.ts` (matching `balanceSim.ts`'s `process.argv[1]?.endsWith(...)` entrypoint pattern) to avoid duplicating fuzz engine logic.
- Avoided editing `src/data/levels/index.ts` or `balanceSim.ts` to prevent merge conflicts with ENEMIES / ISLANDS branches.

## Known Issues / Findings in `src` (Reported Only or Isolated)
- `src/sim/waveSystem.ts`: In Endless Mode, `canStartNextWave()` returns `true` during `allSpawned`, so repeatedly calling the next wave early before active enemies clear stacks multiple 100+ enemy waves simultaneously and can saturate `BALANCE.pools.maxEnemies` (360) — observed `enemyPool.acquire()` returning `null` (16 dropped spawns on L7 when stacking waves 19–27 without clearing). `SimWorld` handles `null` without crashing, though capping/gating early calls in `allSpawned` or increasing pool headroom may be worth considering for endless play.
- `src/sim/enemySystem.ts`: When a `splitter` dies at exact pool capacity (360/360), `spawnSplitChild` runs before `pool.releaseAtActivePos(pos)`, so both hatchlings fail to acquire slots even though the parent is releasing 1 slot on that step.
- `src/data/levels/index.ts` does not re-export `ScriptedBuildAction`, though `scripts/balanceSim.ts` imports it from there (ignored at runtime by `tsx`, flagged only if strict `tsc` checks `scripts/`).
- `src/platform/storage.ts`: `loadProgress` checks `typeof parsed.unlockedLevelIndex === 'number'` without `Number.isFinite(...)` (unlike `bestStars`/`bestEndlessWaves`).
- `src/core/gameLoop.ts`: `FixedTimestepStepper.step(NaN, ...)` propagates `NaN` into `elapsedVisualTime` and `alpha` (will fix with isolated `Number.isNaN(rawDt)` guard + test).

## Cross-area Changes
- None yet.
