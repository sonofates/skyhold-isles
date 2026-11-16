# Overnight Progress — QA Harness (`skyhold-agy-qa`)

Branch: `hermes/skyhold-agy-qa` (base: `main` at `cfb9330`)

## Done
- **CI runner (`npm run ci`, `scripts/ci.ts`)**:
  - Runs `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run sim:balance`, and `npm run build` sequentially with per-step timing and a clear PASS/FAIL summary table.
  - Supports `--fail-fast` (stop on first failure) and `--full` (also runs `npm run sim:fuzz` and `npm run sim:bench`).
  - Latest full pass (`npm run ci -- --full`): 7/7 PASSED in 31.74s (`test`: 21 files / 112 tests in 7.92s).
- **Headless Fuzz Playthrough Harness (`npm run sim:fuzz`, `scripts/fuzzPlay.ts`, `tests/sim/fuzzPlay.test.ts`)**:
  - Exercises all islands in `LEVELS` dynamically across 4 seeded behavior profiles (`competent`, `balanced`, `chaotic`, `minimal`) with legal build, upgrade, sell, targeting-mode swap, Meteor/Overcharge ability (plus `preFirstWave` guard), `FixedTimestepStepper` 1x/2x/3x speed & pause, auto-wave toggle, early-call, story win -> Endless Mode transition, and dedicated Endless Mode passes.
  - Tick-by-tick invariants:
    - Finite positions/prevPositions/HP/dist/timers/yaw.
    - Integer non-negative gold AND exact gold ledger conservation (`startingGold + killRewards + waveClearBonuses + earlyCallBonuses + sellRefunds - buildCosts - upgradeCosts === world.gold`).
    - Bounded integer lives (`0..startingLives`).
    - Exact enemy conservation (`spawned === killed + leaked + active` and `world.enemiesKilledTotal`).
    - Tower state, cumulative `totalInvested`, grid-to-tower bijection (`MapGrid.getTowerIdAt === tower.id`), unique IDs/coords, and kill accounting (`activeTowerKills + soldTowerKills <= killedCount + pendingDeaths`).
    - Periodic `SpatialHashGrid` completeness check (returned pool indices match active enemies 1-to-1) and grid occupied-cell count match.
    - Periodic illegal-action probes (out-of-bounds/spawn build, invalid tower ID upgrade/sell, early `enterEndlessMode`) verifying zero state mutation.
    - Zero unexpected pool overflows, single `gameWon`/`gameLost` emission, and full replay determinism.
  - CLI prints failing seed & exact reproduction command (`npx tsx scripts/fuzzPlay.ts --level <N> --seed <S>`).
  - Fast Vitest suite (`tests/sim/fuzzPlay.test.ts`) runs 4 seeds/island + 3 endless waves/island + replay determinism across all 9 islands in ~7.7s.
- **Data & Cross-Layer Contract Coverage (`tests/data/contentContracts.test.ts`)**:
  - Dynamically checks `PALETTE` vs `PALETTE_HEX` & `lerpHexColor`, `TOWER_TYPES`/`TOWER_DEFS`/`TOWER_PICK_BOUNDS`/`TOWER_ICON_SVGS` (tiers 1-3, unique hotkeys, minRange < range), `ENEMY_TYPES`/`ENEMY_DEFS`/`ENEMY_BADGE_META`, `ABILITY_IDS`/`ABILITY_DEFS`/`UI_ICON_SVGS`/`computeMeteorDamage`, and all `LEVELS` (flightPath bounds & segments, wave counts vs pool cap, scripted greedy/weak build orders on grass without duplicate builds or tier > 3 upgrades).
- **Simulation Test Coverage (`tests/sim/**`, `tests/core/**`)**:
  - `tests/core/gameLoop.test.ts` + isolated fix in `src/core/gameLoop.ts`: guarded `NaN` `rawDt` in `FixedTimestepStepper.step`; tested negative/`NaN`/`+Infinity` dt, `resetAccumulator`, `alpha`, pause/inactive visual time, speed switching, and `MAX_ACCUMULATOR_SEC` clamp.
  - `tests/sim/endlessAndPool.test.ts`: `getRewardMultiplier` decay & `0.32` floor, `buildEndlessWaveDef` determinism/caps/intervals/boss cadence, `enterEndlessMode` gating & reward scaling (`>= 1` floor), `ObjectPool` lifecycle/exhaustion, `EnemySystem` / `ProjectileSystem` / `CombatSystem` / `SimWorld` full-pool (360 enemies / 240 projectiles) exhaustion & recovery paths.
  - `tests/sim/mechanicsEdgeCases.test.ts`: linear homing tracking & recycled `poolIndex` `uid` mismatch safety, mid-flight sold-tower impact resolution, parabolic arc midpoint height & `isBossHit` flag, `CombatSystem` `±π` shortest-angle wrap, idle sweep & recoil/pop decay, `stunTimer` exact wake-up tick, `tesla` chain kills without overkill inflation, empty-group waves, story-to-endless wave previews, boss leak lives clamping at `0` + post-loss no-op ticks, and 2-point / tight-corner `CompiledPath` checks.
  - `tests/sim/targeting.test.ts`: normalized progress ties across ground vs flying lanes, Euclidean distance ties, `strongest` HP ties, exact `minRange`/`range` boundaries, and `SimWorld.setTowerTargeting`.
  - `tests/sim/coreAndGrid.test.ts`: `SeededRng`, `EventBus`, `MapGrid` & coordinate helpers, `CompiledPath` edge cases, and `SpatialHashGrid` query/clamping/clear tests.
  - `tests/sim/worldHelpers.test.ts`: `SimWorld.findHoveredEnemy`, `SimWorld.getMvpTowerSummary`, `SimWorld.debugSkipToWave`, `debugForceWin`/`debugForceLose`, and `sessionBridge` pure helpers (`buildHudStateView`, `buildAbilityBarState`, `stepPendingSpawns`).
  - `tests/sim/qaScriptsSmoke.test.ts`: verifies `CI_STEPS` / `EXTRA_QA_STEPS` match `package.json` scripts and smoke-tests `runSimBenchScenario`.
- **Render & Platform Headless Coverage (`tests/render/**`, `tests/platform/**`)**:
  - `tests/render/towerPicking.test.ts`: fixed stale `TowerEntity` test fixture (`recoil` / `stunTimer` / `kills`) for strict TS compatibility.
  - `tests/render/renderHelpers.test.ts`: `geometryHelpers` (`mergeColoredParts`, `mergePlainGeometries`, `mergeTexturedParts`, `disposeInstancedMeshes`), `kenneyPalette` (`remapUvCell`, `multiplyVertexTint`), and `LightningArcPool` spawn/expiry/capacity/vertex-cap/dispose.
  - `tests/render/cameraDynamics.test.ts`: `CameraController.configureForMap` (desktop & portrait mobile), `rotate90`, `panByScreenDelta`/`setKeyPan` bounds clamping, `zoomByDelta` clamping, `addShake` cooldown/decay, `getViewVersion`, `setShowcaseMode`.
  - `tests/platform/storageAndProgress.test.ts`: `storage.ts` settings/progress load/save, legacy v1 migration, truncation & sanitization, corrupt JSON & storage exception handling, toast flags, `recordWinProgress` monotonic unlocks/stars & boundary clamping, `recordEndlessProgress` monotonic tracking.
  - `tests/platform/sessionBridge.test.ts`: `isTouchDevice` / `getDefaultSettings` touch detection, `bindSimEventBridge` event wiring & floating texts/toasts, `updateMeteorPreviewFromNdc`, `updatePlacementPreviewFromNdc`, `updateHoverFeedback`.
  - `tests/platform/runtimeWrappers.test.ts`: headless Node tests with mocks for `GameLoop` (`browserLoop.ts`), `SoundManager` (`soundManager.ts`), and `InputManager` (`input.ts`).
- **Simulation Performance Benchmark (`npm run sim:bench`, `scripts/simBench.ts`)**:
  - Benchmarks `SimWorld.fixedTick` at 100 / 250 / 360 active enemies (derived dynamically from `ENEMY_TYPES`) with 40 active towers across all archetypes (`Skybridge Gauntlet`, 1,080 timed ticks/scenario after JIT warmup).
  - Latest Linux host run: 100 enemies ~27.3k ticks/s (0.037 ms/tick), 250 enemies ~12.2k ticks/s (0.082 ms/tick), 360 enemies ~9.4k ticks/s (0.107 ms/tick; 0.320 ms per 3x frame).
  - Asserts a 180 ticks/s hard floor and soft phone-headroom budgets (`>= 3600`, `>= 2200`, `>= 1500` ticks/s; pass `--strict` to fail exit code on soft budget miss).

## Next (Post-Merge QA Follow-ups for Lead)
- After ENEMIES / TOWERS / ISLANDS / PERF / META / UI branches merge into `main`, run `npm run ci -- --full`:
  - `tests/data/contentContracts.test.ts`, `scripts/fuzzPlay.ts`, and `scripts/simBench.ts` automatically cover newly registered enemies, towers, and islands.
  - Note: `tests/sim/waves.test.ts` line 305 currently asserts `expect(LEVELS.length).toBe(9)` (existing baseline test; update after new islands merge).
- Consider extending `tsconfig.json` (or adding `tsconfig.scripts.json`) if the team wants `tsc --noEmit` to typecheck `tests/**` and `scripts/**` in CI too (currently blocked by missing `@types/node` and un-exported `ScriptedBuildAction` in `src/data/levels/index.ts`).

## Decisions
- Fuzz harness reuses `scripts/fuzzPlay.ts` from `tests/sim/fuzzPlay.test.ts` (matching `balanceSim.ts`'s `process.argv[1]?.endsWith(...)` entrypoint pattern) to keep zero duplicated logic.
- Kept `simBench.ts` separate from Vitest (`npm run sim:bench`) so wall-clock benchmark variance never flakes unit tests, while `tests/sim/qaScriptsSmoke.test.ts` ensures `simBench.ts` and `ci.ts` stay wired and passing.
- Avoided editing `src/data/levels/index.ts`, `src/platform/storage.ts`, `src/render/geometryHelpers.ts`, `src/ui/**`, or `scripts/balanceSim.ts` to keep merge conflicts at zero with parallel ENEMIES / ISLANDS / META / TOWERS / PERF / UI branches.

## Known Issues / Findings in `src` (Reported Only or Isolated)
- `src/sim/waveSystem.ts`: In Endless Mode, `canStartNextWave()` returns `true` during `allSpawned`, so repeatedly calling the next wave early before active enemies clear stacks multiple 100+ enemy waves simultaneously and can saturate `BALANCE.pools.maxEnemies` (360) — observed `enemyPool.acquire()` returning `null` (16 dropped spawns on L7 when stacking waves 19–27 without clearing). `SimWorld` handles `null` without crashing.
- `src/sim/enemySystem.ts`: When a `splitter` dies at exact pool capacity (360/360), `spawnSplitChild` runs before `pool.releaseAtActivePos(pos)`, so both hatchlings fail to acquire slots even though the parent is releasing 1 slot on that step.
- `src/render/geometryHelpers.ts`: `mergeColoredParts([])`, `mergePlainGeometries([])`, and `mergeTexturedParts([])` call Three.js `mergeGeometries(prepared, false) ?? new THREE.BufferGeometry()`, but Three.js 0.187 `mergeGeometries` throws `TypeError: Cannot read properties of undefined (reading 'index')` when given an empty array (missing `if (prepared.length === 0) return new THREE.BufferGeometry();` guard). All current callers pass non-empty arrays.
- `src/data/levels/index.ts`: Does not re-export `ScriptedBuildAction`, though `scripts/balanceSim.ts` imports it from there (ignored at runtime by `tsx`, flagged only if strict `tsc` checks `scripts/`).
- `src/platform/storage.ts`: `loadProgress` checks `typeof parsed.unlockedLevelIndex === 'number'` without `Number.isFinite(...)` (unlike `bestStars`/`bestEndlessWaves`).

## Cross-area Changes
- `src/core/gameLoop.ts`: 1-line isolated `Number.isNaN(rawDt)` guard in `FixedTimestepStepper.step` (prevents `NaN` dt from poisoning `elapsedVisualTime` and `alpha`, covered in `tests/core/gameLoop.test.ts`).
