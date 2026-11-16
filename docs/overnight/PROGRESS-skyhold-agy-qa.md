# Overnight Progress — QA Harness (`skyhold-agy-qa`)

Branch: `hermes/skyhold-agy-qa` (base: `main` at `cfb9330`)

## Done
- Fixed stale `TowerEntity` test fixture in `tests/render/towerPicking.test.ts` (`recoil` / `stunTimer` / `kills`).
- Added `scripts/ci.ts` and `npm run ci` (`tsc --noEmit` + `eslint` + `vitest` + `sim:balance` + `build`) with per-step timing and clear summary output (`--fail-fast` supported).
- Built headless fuzz playthrough harness (`scripts/fuzzPlay.ts` + `npm run sim:fuzz` + `tests/sim/fuzzPlay.test.ts`) checking all invariants across every island (`LEVELS`), endless mode, and determinism replay.
- Filled unit test gaps across platform, sim, and core (76 total tests across 13 test files, <10s `npm test`):
  - `tests/platform/storageAndProgress.test.ts`: `storage.ts` settings/progress load/save, legacy v1 migration, array truncation & sanitization, corrupt JSON & storage exception handling, toast flags, `recordWinProgress` monotonic unlocks/stars & boundary clamping, `recordEndlessProgress` monotonic tracking.
  - `tests/sim/endlessAndPool.test.ts`: `getRewardMultiplier` decay & `0.32` floor, `buildEndlessWaveDef` determinism/caps/intervals/boss cadence, `enterEndlessMode` gating & reward scaling (`>= 1` floor), `ObjectPool` lifecycle/exhaustion, `EnemySystem` / `ProjectileSystem` / `CombatSystem` / `SimWorld` full-pool (360 enemies / 240 projectiles) exhaustion & recovery paths.
  - `tests/core/gameLoop.test.ts` + isolated fix in `src/core/gameLoop.ts`: guarded `NaN` `rawDt` in `FixedTimestepStepper.step`, plus tests for negative/`NaN`/`+Infinity` dt, `resetAccumulator`, `alpha`, pause/inactive visual time, speed switching, and `MAX_ACCUMULATOR_SEC` clamp.
  - `tests/sim/targeting.test.ts`: normalized progress ties across ground vs flying lanes, Euclidean distance ties, `strongest` HP ties, exact `minRange`/`range` boundaries, and `SimWorld.setTowerTargeting`.
  - `tests/sim/coreAndGrid.test.ts`: `SeededRng`, `EventBus`, `MapGrid` & coordinate helpers, `CompiledPath` edge cases, and `SpatialHashGrid` query/clamping/clear tests.
- Added simulation performance benchmark (`scripts/simBench.ts` + `npm run sim:bench`):
  - Benchmarks `SimWorld.fixedTick` at 100 / 250 / 360 active enemies with 40 active towers across all 5 archetypes (Skybridge Gauntlet, 1,080 timed ticks per scenario after JIT warmup).
  - Baseline measured on Linux host: 100 enemies ~19,844 ticks/s (0.0504 ms/tick), 250 enemies ~9,752 ticks/s (0.1025 ms/tick), 360 enemies ~7,624 ticks/s (0.1312 ms/tick; 0.394 ms per 3x frame).
  - Enforces a 180 ticks/s hard floor and soft phone-headroom budgets (`>= 3600`, `>= 2200`, `>= 1500` ticks/s; pass `--strict` to fail CI on soft budget miss).

## Next
- Add focused tests for `SimWorld` helper surfaces (`findHoveredEnemy`, `getMvpTowerSummary`, `debugSkipToWave`, `debugForceWin`, `debugForceLose`) and `sessionBridge` pure view builders (`buildHudStateView`, `buildAbilityBarState`, `stepPendingSpawns`).
- Review all test suites & scripts as a final end-of-night pass and run full `npm run ci`, `npm run sim:fuzz`, `npm run sim:bench`.

## Decisions
- Fuzz harness reuses `scripts/fuzzPlay.ts` from `tests/sim/fuzzPlay.test.ts` (matching `balanceSim.ts`'s `process.argv[1]?.endsWith(...)` entrypoint pattern) to avoid duplicating fuzz engine logic.
- Kept `simBench.ts` separate from Vitest unit tests (`npm run sim:bench`) so wall-clock timing checks never cause flaky unit test failures on busy CI runners, while still offering `--strict` mode.
- Avoided editing `src/data/levels/index.ts`, `src/platform/storage.ts`, or `scripts/balanceSim.ts` to prevent merge conflicts with ENEMIES / ISLANDS / META branches.

## Known Issues / Findings in `src` (Reported Only or Isolated)
- `src/sim/waveSystem.ts`: In Endless Mode, `canStartNextWave()` returns `true` during `allSpawned`, so repeatedly calling the next wave early before active enemies clear stacks multiple 100+ enemy waves simultaneously and can saturate `BALANCE.pools.maxEnemies` (360) — observed `enemyPool.acquire()` returning `null` (16 dropped spawns on L7 when stacking waves 19–27 without clearing). `SimWorld` handles `null` without crashing.
- `src/sim/enemySystem.ts`: When a `splitter` dies at exact pool capacity (360/360), `spawnSplitChild` runs before `pool.releaseAtActivePos(pos)`, so both hatchlings fail to acquire slots even though the parent is releasing 1 slot on that step.
- `src/data/levels/index.ts` does not re-export `ScriptedBuildAction`, though `scripts/balanceSim.ts` imports it from there (ignored at runtime by `tsx`, flagged only if strict `tsc` checks `scripts/`).
- `src/platform/storage.ts`: `loadProgress` checks `typeof parsed.unlockedLevelIndex === 'number'` without `Number.isFinite(...)` (unlike `bestStars`/`bestEndlessWaves`).

## Cross-area Changes
- `src/core/gameLoop.ts`: 1-line isolated `Number.isNaN(rawDt)` guard in `FixedTimestepStepper.step` (prevents `NaN` dt from poisoning `elapsedVisualTime` and `alpha`, covered in `tests/core/gameLoop.test.ts`).
