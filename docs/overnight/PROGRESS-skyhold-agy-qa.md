# Overnight Progress — QA Harness (`skyhold-agy-qa`)

Branch: `hermes/skyhold-agy-qa` (base: `main` at `cfb9330`)

## Done
- **CI runner (`npm run ci`, `scripts/ci.ts`)**:
  - Runs `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run sim:balance`, and `npm run build` sequentially with per-step timing and a clear PASS/FAIL summary table.
  - Supports `--fail-fast` (stop on first failure) and `--full` (also runs `npm run sim:fuzz` and `npm run sim:bench`).
- **Headless Fuzz Playthrough Harness (`npm run sim:fuzz`, `scripts/fuzzPlay.ts`, `tests/sim/fuzzPlay.test.ts`)**:
  - Exercises all islands in `LEVELS` dynamically across 4 seeded behavior profiles (`competent`, `balanced`, `chaotic`, `minimal`) with legal build, upgrade, sell, targeting-mode swap, Meteor/Overcharge ability (plus `preFirstWave` guard), `FixedTimestepStepper` 1x/2x/3x speed & pause, auto-wave toggle, early-call, story win -> Endless Mode transition, and dedicated Endless Mode passes.
  - Asserts tick-by-tick invariants: finite positions/HP/dist/timers, integer non-negative gold and bounded lives, exact enemy conservation (`spawned === killed + leaked + active` + `world.enemiesKilledTotal`), no unexpected pool overflows, single `gameWon`/`gameLost` emission, and full replay determinism.
  - CLI prints failing seed & exact reproduction command (`npx tsx scripts/fuzzPlay.ts --level <N> --seed <S>`).
  - Fast Vitest suite (`tests/sim/fuzzPlay.test.ts`) runs 4 seeds/island + 3 endless waves/island + replay determinism across all 9 islands in ~6.6s.
- **Test Gap Coverage (`tests/**`, 14 files / 80 tests total, ~7s `npm test`)**:
  - `tests/render/towerPicking.test.ts`: fixed stale `TowerEntity` test fixture (`recoil` / `stunTimer` / `kills`) for strict TS compatibility.
  - `tests/platform/storageAndProgress.test.ts`: `storage.ts` settings/progress load/save, legacy v1 migration (smaller level counts / missing `bestEndlessWaves`), truncation & sanitization, corrupt JSON & storage exception handling, toast flags, `recordWinProgress` monotonic unlocks/stars & boundary clamping, `recordEndlessProgress` monotonic tracking.
  - `tests/sim/endlessAndPool.test.ts`: `getRewardMultiplier` decay & `0.32` floor, `buildEndlessWaveDef` determinism/caps/intervals/boss cadence, `enterEndlessMode` gating & reward scaling (`>= 1` floor), `ObjectPool` lifecycle/exhaustion, `EnemySystem` / `ProjectileSystem` / `CombatSystem` / `SimWorld` full-pool (360 enemies / 240 projectiles) exhaustion & recovery paths.
  - `tests/core/gameLoop.test.ts` + isolated fix in `src/core/gameLoop.ts`: guarded `NaN` `rawDt` in `FixedTimestepStepper.step`; tested negative/`NaN`/`+Infinity` dt, `resetAccumulator`, `alpha`, pause/inactive visual time, speed switching, and `MAX_ACCUMULATOR_SEC` clamp.
  - `tests/sim/targeting.test.ts`: normalized progress ties across ground vs flying lanes, Euclidean distance ties, `strongest` HP ties, exact `minRange`/`range` boundaries, and `SimWorld.setTowerTargeting`.
  - `tests/sim/coreAndGrid.test.ts`: `SeededRng`, `EventBus`, `MapGrid` & coordinate helpers, `CompiledPath` edge cases, and `SpatialHashGrid` query/clamping/clear tests.
  - `tests/sim/worldHelpers.test.ts`: `SimWorld.findHoveredEnemy`, `SimWorld.getMvpTowerSummary`, `SimWorld.debugSkipToWave`, `debugForceWin`/`debugForceLose`, and `sessionBridge` pure helpers (`buildHudStateView`, `buildAbilityBarState`, `stepPendingSpawns`).
- **Simulation Performance Benchmark (`npm run sim:bench`, `scripts/simBench.ts`)**:
  - Benchmarks `SimWorld.fixedTick` at 100 / 250 / 360 active enemies with 40 active towers across all 5 archetypes (`Skybridge Gauntlet`, 1,080 timed ticks/scenario after JIT warmup).
  - Baseline on Linux host: 100 enemies ~15.5k–19.8k ticks/s (~0.05–0.06 ms/tick), 250 enemies ~9.3k–9.7k ticks/s (~0.10 ms/tick), 360 enemies ~6.3k–7.6k ticks/s (~0.13–0.16 ms/tick; ~0.40–0.47 ms per 3x frame).
  - Asserts a 180 ticks/s hard floor and soft phone-headroom budgets (`>= 3600`, `>= 2200`, `>= 1500` ticks/s; pass `--strict` to fail exit code on soft budget miss).

## Next (Optional Future QA Follow-ups After Merge)
- Once ENEMIES / TOWERS / ISLANDS merge into `main`, re-run `npm run ci -- --full` so the fuzz harness, balance sim, and tests automatically validate new islands, enemy types, and towers.
- Consider extending `tsconfig.json` (or adding a dedicated `tsconfig.scripts.json`) if the team wants `tsc --noEmit` to typecheck `tests/**` and `scripts/**` in CI too (currently blocked by missing `@types/node` and un-exported `ScriptedBuildAction` in `src/data/levels/index.ts`).

## Decisions
- Fuzz harness reuses `scripts/fuzzPlay.ts` from `tests/sim/fuzzPlay.test.ts` (matching `balanceSim.ts`'s `process.argv[1]?.endsWith(...)` entrypoint pattern) to keep zero duplicated logic.
- Kept `simBench.ts` separate from Vitest (`npm run sim:bench`) so wall-clock benchmark variance never flakes unit tests, while exposing `--strict` and `npm run ci -- --full`.
- Avoided editing `src/data/levels/index.ts`, `src/platform/storage.ts`, or `scripts/balanceSim.ts` to keep merge conflicts at zero with parallel ENEMIES / ISLANDS / META / TOWERS / PERF / UI branches.

## Known Issues / Findings in `src` (Reported Only or Isolated)
- `src/sim/waveSystem.ts`: In Endless Mode, `canStartNextWave()` returns `true` during `allSpawned`, so repeatedly calling the next wave early before active enemies clear stacks multiple 100+ enemy waves simultaneously and can saturate `BALANCE.pools.maxEnemies` (360) — observed `enemyPool.acquire()` returning `null` (16 dropped spawns on L7 when stacking waves 19–27 without clearing). `SimWorld` handles `null` without crashing.
- `src/sim/enemySystem.ts`: When a `splitter` dies at exact pool capacity (360/360), `spawnSplitChild` runs before `pool.releaseAtActivePos(pos)`, so both hatchlings fail to acquire slots even though the parent is releasing 1 slot on that step.
- `src/data/levels/index.ts`: Does not re-export `ScriptedBuildAction`, though `scripts/balanceSim.ts` imports it from there (ignored at runtime by `tsx`, flagged only if strict `tsc` checks `scripts/`).
- `src/platform/storage.ts`: `loadProgress` checks `typeof parsed.unlockedLevelIndex === 'number'` without `Number.isFinite(...)` (unlike `bestStars`/`bestEndlessWaves`).

## Cross-area Changes
- `src/core/gameLoop.ts`: 1-line isolated `Number.isNaN(rawDt)` guard in `FixedTimestepStepper.step` (prevents `NaN` dt from poisoning `elapsedVisualTime` and `alpha`, covered in `tests/core/gameLoop.test.ts`).
