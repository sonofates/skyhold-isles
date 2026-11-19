# PROGRESS — skyhold-night-agy (QA, Balance, Logic Robustness)

- **Branch:** `hermes/skyhold-night-agy` (base: `art-2d` @ `0f854bb`)
- **Started:** 2026-11-18 ~22:52 UTC (01:52 TR) · **Deadline:** 09:00 TR (06:00 UTC)
- **Strict Ownership:**
  - **Ours:** `src/sim/**` *(EXCEPT `src/sim/enemySystem.ts`)*, `src/data/{heroes,towers,abilities,balance,challenges,daily,runModifiers,workshop}.ts`, `src/render2d/heroes2d.ts`, `src/render2d/ui/{progress2d,modes2d}.ts` *(logic only)*, `src/platform/**`, `src/core/**`, `scripts/**` *(coordinate `balanceSim.ts` via PROGRESS)*, `qa/bot/**`, `tests/**`, `package.json` (`qa:bot` script).
  - **Untouched:** visual UI, `game2d.ts`, `main2d.ts`, render layers, art, `tools/**`, `src/data/levels2d/**`, `src/data/enemies.ts`, `src/sim/enemySystem.ts`, `src/i18n/**`.

---

## Backlog Status

- [x] **1. Headless QA Bot (`qa/bot/**`, `npm run qa:bot`) + Sim Bug Fixes** — *DONE (Round 1)*
  - Built multi-worker Node headless runner (`qa/bot/{index,worker,runner,strategies,invariants,hash}.ts`) + unit/regression suite (`tests/sim/qaBot.test.ts`).
  - Plays all 17 2D islands (`l1c`, `i01`–`i16`) across `greedy` (17), `weak` (17), `abilities` on cooldown + barracks rally/sell-rebuild (17), all 5 `heroes` at L1/L10/L20 across 5 park modes (`castle`, `merge`, `front`, `altLane`, `roam` = 260), island `challenges` (34), `daily` squalls (17), `endless` 10 waves incl. `startEndlessFromStart` (19), and 11 full bit-exact determinism replay pairs = **381 scenarios / 18,299,977 sim ticks** (~79s across 6 workers; `--quick` mode for fast CI/Vitest slices).
  - Initial sweep caught **930 invariant violations** across 4 real sim bugs in our owned area — **all 4 fixed** (`381/381` scenarios now pass with `0` violations):
    1. **`GroundGraph.findPath` cross-chasm shortcut & melee off-road drift (`src/sim/groundGraph.ts`, `src/sim/heroSystem.ts`):** `DIRECT_WALK_DIST` (`1.4u`) previously allowed walking straight across unconnected chasms when two road verges passed within `3.8u`, and melee engagement/post-return (`i08:hero:bran:L10:roam`) drifted past `HERO_RULES.maxOffRoadDist` (`1.301u > 1.2u`). Fixed by requiring shared road neighborhood for direct steps, routing post returns > `1.4u` along `groundGraph.findPath`, and clamping melee steps onto walkable ground.
    2. **Tobb's Deploy Gizmo landing on build plots (`src/sim/heroSystem.ts`, `src/sim/world.ts`):** Caught 448 violations (`l1c` plots 3 & 9, `i01` plots 5 & 9, etc.). Fixed via `HeroSystem.resolveGizmoPlacement`, which enforces `>= plotRadius * 1.28` clearance from every plot in `grid.plots` while searching nearby road/verge positions within cast range (verified exhaustively across every plot of all 17 islands in `tests/sim/qaBot.test.ts`).
    3. **Unbalanced `enemyBlocked` / `enemyUnblocked` events (`src/sim/heroSystem.ts`, `src/sim/soldierSystem.ts`):** When Bran entered melee contact and died on the same tick, or when barracks soldiers and Bran co-held an enemy, `enemyBlocked` could fire twice or fail to emit `enemyUnblocked` when the hold ended. Fixed in both systems so block/unblock events stay 1-to-1.
    4. **Leaked mid-flight projectiles, burn zones & fire rings on victory + `debugSkipToWave` (`src/sim/world.ts`, `src/sim/abilitySystem.ts`, `src/sim/heroSystem.ts`, `src/sim/soldierSystem.ts`):** Winning a story run froze mid-air projectiles/mortar burn patches/fire rings indefinitely. Added `clearVictoryTransients()` on story win, full transient reset in `debugSkipToWave`, and `world.dispose()` for complete post-run teardown. Also fixed missing `tower.heroRangeBonus` on Archer T3 `fireVolley` (`src/sim/combatSystem.ts`).
- [x] **2. Hero Balance (`src/data/heroes.ts`, `src/sim/heroSystem.ts`, `src/render2d/heroes2d.ts`, `scripts/heroBalance.ts`)** — *DONE (Round 2)*
  - Tuned all 5 heroes (`bran`, `wren`, `mira`, `tobb`, `sela`) against `docs/hero-spec.md` targets (`L1 ≈ 1× T2 Barracks = 648 dmg`, `L20 ≈ 2× T3 Towers = 7,642 dmg`) without altering any skill-node percentage hardcoded in `src/i18n/heroesTr.ts` (keeps EN & TR tooltips 100% accurate).
  - Added per-hero `HeroLevelGrowth`, `buildLevel20Specialization` (all 3 branch pairings `B0+1 / B0+2 / B1+2`), and `defaultSkillsForLevel` (wired into `?herolevel=N` and `scripts/heroBalance.ts`).
  - Moderated Mira's `wispFireRing` capstone secondary ring (`0.78×` radius, `0.42×` burst, `0.55×` burn, `2.0s`) and gave Bran's `Rally Banner` a self-combat surge (`+6%` swing speed and `0.55×` banner damage bonus) so Bran reaches 3★ on Master islands (`i10`, `i16`) without over-scaling solo DPS.
  - Tobb's `Deploy Gizmo` build-plot collision fix verified across all 17 islands (committed in Step 1).
- [x] **3. Robustness (Save/Progress Migrations, Fuzz Tests, Daily/Endless/Challenge Edge Cases, Zero-Alloc Hot Paths)** — *DONE (Round 2)*
  - **Save & Save-Code Migrations (`src/data/heroes.ts`, `src/platform/storage.ts`, `src/platform/saveCode.ts`, `src/render2d/ui/progress2d.ts`):**
    - Added platform-free `sanitizeHeroSaveData`, `hasHeroSaveProgress`, and monotonic/idempotent `mergeHeroSaveData` so `migrateProgress`, `hasAnyProgress`, `encodeSaveCode`, `decodeSaveCode`, `mergeProgress`, and `describeMergeGain` preserve 2D hero XP, skill trees, and `selectedHero` while keeping hero-less 3D saves byte-identical.
    - Fixed `loadProgress2D` / `remapProgress` empty `ids: []` wrapper bug (previously wiped positional stars to 0), duplicate IDs in `oldIds` (now merges via `Math.max` + badge union), non-object JSON primitives/arrays, `levelCount <= 0` edge cases, `NaN` `masterVolume` in `loadSettings`, and `NaN` stars/lives in `recordWin2D` / `applyRunResult2D`.
    - Added `tests/platform/robustnessFuzz.test.ts` (500 seeded fuzzed v1/v2/2D/corrupted payloads + 150 save-code round-trip/merge fuzz pairs).
  - **Daily, Endless & Coordinate Guards (`src/data/daily.ts`, `src/sim/waveSystem.ts`, `src/sim/abilitySystem.ts`, `src/sim/soldierSystem.ts`, `src/sim/groundGraph.ts`, `src/sim/world.ts`):**
    - Hardened `utcDayNumber`, `dailyChallengeFor`, `normalizeDailyRecord`, `liveStreak`, and `applyDailyWin` against `NaN`/`Infinity`/fractional day inputs and duplicate/negative `clearedIslands`.
    - Fixed `WaveSystem.skipToWave(NaN)` setting `currentWaveIndex = NaN`, capped `getCurrentWaveHpScale()` at `1e12` so extreme endless wave skips (`wave 5000`) never overflow IEEE-754 `double` to `Infinity`, capped high-offset endless boss counts (`<= 12`) & clear bonus (`<= 10,000`), made `enterEndlessMode()` idempotent, and rejected non-finite `(x, z)` coordinates in `castMeteor`, `setRally`, and `clampToGround`.
  - **Challenge + Hero Interaction Decision (`Silent Skies`):**
    - **Decision:** `Silent Skies` (`abilitiesDisabled: true`) disables **only global sanctuary/sky abilities (`Meteor Strike` and `Overcharge`)**; hero active skills and passives remain enabled and usable.
    - **Rationale:** Matches `docs/hero-spec.md` ("global active abilities are separate from hero skills"), matches EN/TR `CHALLENGES.silentSkies` copy ("Meteor Strike and Overcharge are disabled"), and matches Opus's `abilityBar2d.ts` / `heroHud2d.ts` UI without stripping hero identity on `i05`/`i08`/`i11`/`i15`. Verified across all 5 heroes in `tests/platform/robustnessFuzz.test.ts`.
  - **Zero Per-Tick Allocations in Owned `src/sim/**` Hot Paths:**
    - Added `GroundGraph.clampToGroundOut` & `findPathInto` (`_clampTarget`, `_clampStep`, `_chainScratch`), cached post-return routes into `h.waypoints`, reused `_heroShotScratch` for hero & Tobb gizmo projectiles, and reused `_impactOut` in `ProjectileSystem.predictImpactPoint` (in addition to the 9 per-tick `SimWorld.fixedTick` closures and `HeroSystem`/`SoldierSystem` sort closures eliminated in Step 1).
- [x] **4. Speed 3× & Deterministic Replay Command API (`src/core/**`, `src/sim/**`, `src/platform/**`)** — *DONE (Round 2)*
  - Added `SPEED_MULTIPLIERS`, `isSpeedMultiplier`, `clampSpeedMultiplier`, `nextSpeedMultiplier` (`1 -> 2 -> 3 -> 1`), `stepper.setSpeed(...)`, `stepper.cycleSpeed()`, and `NaN` `rawDt` guards in `src/core/gameLoop.ts` + `GameLoop.cycleSpeed()` in `src/platform/browserLoop.ts`.
  - Built `src/sim/replay.ts` + `SimWorld` command hooks (`world.tick`, `world.elapsedSimSec`, `world.seed`, `SimCommand`, `StampedSimCommand`, `SimReplayLog`, `world.applyCommand`, automatic `recordCommands` interception, `world.exportReplay`, `serializeSimReplay`, `parseSimReplay`, `computeSimStateHash`, and `SimReplayPlayer` with `1×–8×` `stepFrame` + silent `seekToTick` timeline scrubbing via `EventBus.muted`).
  - Integrated `SimReplayPlayer` round-trip verification into `qa/bot/runner.ts` determinism checks and added `tests/sim/replayAndSpeed.test.ts`.
- [x] **5. Deep Quality & Robustness Audit Pass (`src/core/**`, `src/sim/**`, `src/render2d/**`, `src/platform/**`, `qa/bot/**`)** — *DONE (Round 2 Audit)*
  - **`EventBus` Re-Entrancy Fix (`src/core/eventBus.ts`):** Added zero-allocation `emitDepth` copy-on-write unsubscribe handling so self-unsubscribing listeners never skip sibling listeners, cross-unsubscribing suppresses pending listeners in the same `emit`, and `clear()` halts remaining listeners without allocating on normal ticks.
  - **`SoldierSystem` `towerFireRateMul` Wiring (`src/sim/soldierSystem.ts`, `src/sim/world.ts`):** Wired `mods.towerFireRateMul` into `SoldierSystem` so barracks soldier melee cadence honors `RunModifiers.towerFireRateMul.barracks` consistently with `CombatSystem` and `hasModifierEffectIn2D` (`sim:balance` stays bit-identical).
  - **`?herolevel=N` Skill-Budget Isolation (`src/render2d/heroes2d.ts`):** Hardened `resolveHeroForRun` when overriding hero level on an existing save so `?herolevel=1` never leaks overspent saved skills (`[]`), while `?herolevel=20` on a lower-level save expands to a full 19-point L20 build.
  - **Replay Terminal Guard & State Digest Completeness (`src/sim/replay.ts`, `src/sim/abilitySystem.ts`, `src/sim/projectileSystem.ts`, `qa/bot/{hash,runner}.ts`):** `SimReplayPlayer.finished` now resolves `true` when `world.outcome !== 'ongoing'` and all commands are consumed (even if `summary.totalTicks` was inflated); extended `computeSimStateHash` and `hashWorldState` to cover pending meteors, barracks rally coordinates, hero `fireRings`, and active Mortar T3 burn zones; verified full `won -> enterEndless -> endless wave` replay & backward timeline seeks.
  - **Zero-Alloc Skill Targeting & Platform Guards (`src/sim/heroSystem.ts`, `src/platform/{browserLoop,storage,contentStorage}.ts`, `package.json`):** Eliminated temporary arrays and sort closures in `pickEnemiesNear` / `pickTowersNear` (`Hunter's Mark`, `Thunder Call`, `Overhaul`) + `resolveGizmoPlacement`; clamped negative/non-finite RAF `rawDt` in `GameLoop.start()`; hardened `loadSettings()` / `ContentStore.load()` against primitive/array JSON; added `qa/bot` to `npm run lint`.
- [x] **6. Round 3 Deep Audit & IEEE-754 / Positional Save / Transient State Fixes (`src/data/**`, `src/sim/**`, `src/render2d/**`, `src/platform/**`, `src/core/**`, `qa/bot/**`)** — *DONE (Round 3)*
  - **`loadProgress2D` Positional Slot Alignment Fix (`src/render2d/ui/progress2d.ts`):** Previously, filtering `obj.ids` with `.filter(...)` compacted out `null`/empty slot entries (`['l1c', null, 'i02'] -> ['l1c', 'i02']`), shifting subsequent islands left by 1 and misaligning `oldIds[j]` against `progress.bestStars[j]` / `clears[j]` / `bestEndlessWaves[j]`. Fixed by preserving positional indices (`map` invalid entries to `''`) and only falling back to `levels.map((l) => l.id)` when no valid ID exists.
  - **`Workshop.buyRank` & Math `NaN`/`Infinity` Traps (`src/data/workshop.ts`, `src/data/abilities.ts`, `src/data/runModifiers.ts`, `src/sim/waveSystem.ts`, `src/platform/gestures.ts`):** Fixed `buyRank(..., availableStars = NaN)` bypassing `cost > availableStars` (`cost > NaN === false` in IEEE-754) and purchasing upgrades with `NaN`/`Infinity` stars; guarded `computeMeteorDamage`, `computeEarlyCallBonus`, `combineRunModifiers`, `VelocityTracker`, and `DoubleTapDetector` against non-finite inputs.
  - **`HeroSystem` Victory Walk-State & Lethal Slow Event Fixes (`src/sim/heroSystem.ts`, `src/sim/projectileSystem.ts`, `qa/bot/invariants.ts`):** `clearTransientZones` previously cleared `waypoints` while leaving `hero.state === 'moving'`, causing `HeroLayer` in 2D to run walk frames in place and keep the yellow move pennant (`moveMarker`) pinned on the Victory screen; now transitions `'moving'` cleanly to `'idle'` at `(x, z)` (enforced by `qa/bot` post-victory invariant). Also guarded `ProjectileSystem` `applySlow` with `hp > 0` (matching `AbilitySystem` and `HeroSystem`) so lethal frost/chill hits never emit spurious `armorCracked` events on dead Stone Golems (`sim:balance` stays 100% byte-identical across all 33 levels).
  - **Command, Grid & Replay Hardening + PRNG Digest Completeness (`src/core/rng.ts`, `src/sim/{grid,heroSystem,world,replay}.ts`, `src/render2d/heroes2d.ts`, `qa/bot/hash.ts`):** Enforced integer `(col, row)` in `MapGrid.isInside` (closing TypedArray index truncation on 3D tile maps), required target `(x, z)` for `'meteor'` in `SimWorld.castAbility` & `parseSimReplay`, rejected partial-`NaN`/`±Infinity` coordinates in `castHeroSkill` & `parseSimReplay`, deduplicated/validated `hero.skills` in `parseSimReplay`, deduplicated `heroes2d.ts` pure helpers onto `src/data/heroes.ts`, and added zero-allocation `SeededRng.getState()`, `pendingVolleys`, and Kindling DoT digests to `computeSimStateHash` & `hashWorldState`.
- [x] **7. Round 4 Deep Audit — Victory Soldier Reset, 2D Reset/Save-Code Safety, `EventBus` `on()` Re-Entrancy & Replay Polish (`src/core/**`, `src/sim/**`, `src/platform/**`, `src/render2d/ui/{progress2d,modes2d}.ts`, `qa/bot/**`)** — *DONE (Round 4)*
  - **Barracks Soldier Post-Victory Combat Freeze (`src/sim/world.ts`, `qa/bot/invariants.ts`):** When the final enemy of a story run died after `SoldierSystem.update` in tick `K-1`, `fixedTick` returned early at victory on tick `K` before `SoldierSystem.update` ran, leaving fighting/engaging soldiers frozen in `'fighting'` / `'engaging'` targeting released pool slots on the Victory screen. Added `this.soldierSystem.clearCombatState()` to `SimWorld.clearVictoryTransients()` and enforced zero post-victory soldier combat states / `blockedCount` / `pendingMeteors` in `qa/bot/invariants.ts`.
  - **2D Save Reset Backups, Remappable 2D Save Codes & `mergeProgress` Frontier Walk (`src/render2d/ui/{progress2d,modes2d}.ts`, `src/platform/{saveCode,gameSession}.ts`):**
    - `resetProgress2D()` now backs up non-empty 2D saves (including persistent hero XP & skill trees) to `PROGRESS_2D_RESET_BACKUP_KEY` before erasing and never overwrites an existing real backup on an empty reset (matching 3D `resetProgressSave`).
    - Added `encodeSaveCode2D`, `decodeSaveCode2D`, `exportSaveCode2D`, and `importSaveCode2D` (preserving 2D `ids` for island-insertion/reordering remapping and backing up pre-import saves to `PROGRESS_2D_IMPORT_BACKUP_KEY`), while keeping 3D `encodeSaveCode(progress)` byte-identical.
    - Fixed `GameSession.resetProgress` / `importSaveCode` / `hydrateProgressFromCloud` `Object.assign(this.progress, ...)` leaving stale `this.progress.heroes` behind when assigning a hero-less `ProgressData`, added `GameSession.cycleSpeed()`, walked `unlockedLevelIndex` forward across contiguous cleared islands in `mergeProgress` (with `sanitizeRanks`), and guarded `nowMs` against `NaN`/`±Infinity` in `resolveQueryRun2D` and `recordDailyWin2D`.
  - **`EventBus` Mid-Emit `on()` Subscription Isolation (`src/core/eventBus.ts`):** Added copy-on-write on `on()` when `emitDepth > 0` and snapshotted `const len = list.length` in `emit()` so listeners subscribed mid-emit never fire spuriously on the already-in-flight event (zero allocations on normal ticks).
  - **Geometry `NaN` / Negative-Slack Guards & Replay/Hero Polish (`src/sim/{grid,path,spatialHash,heroSystem,world,replay}.ts`):**
    - Guarded `worldToGridCoord` (previously returned `{ col: NaN, row }` for `NaN`), `MapGrid.findPlotAt` (negative slack squared positive), `CompiledPath.sample(NaN)` / `nearestDist(NaN)`, and `SpatialHashGrid.insert/query`.
    - Normalized non-finite/out-of-range `heroLevel` and `seed` in `SimWorld` constructor (`heroConfig` parity with `hero.level`), zeroed `SimReplayPlayer` fractional `accumulator` (`alpha = 0`) on forward/same-tick `seekToTick` scrubs, added stateful `player.speed` / `player.paused` / `player.setSpeed()` / `player.cycleSpeed()` convenience hooks, expanded `computeSimStateHash`, and improved Tobb's targetless `Overhaul` auto-aim (`castHeroSkill(1)`) to prioritize cleansing stunned towers (including stunned Beacons) while skipping idle Beacons.
- [x] **8. Round 5 Deep Audit — Platform Input/Cloud/Bridge Leaks, Defeat Transients & Delayed Endless Replay (`src/platform/**`, `src/sim/{world,replay}.ts`, `qa/bot/invariants.ts`)** — *DONE (Round 5)*
  - **`InputManager` Horizontal Trackpad Wheel & Blur Cleanup (`src/platform/input.ts`):**
    - Horizontal-only trackpad scroll (`deltaY === 0`, `deltaX !== 0`) previously evaluated `e.deltaY < 0 ? 1 : -1` as `-1` with `Math.max(0.4, 0) = 0.4`, zooming the camera out on horizontal scroll, while `NaN` `deltaY` forwarded `NaN` zoom deltas. Guarded `onWheel` against `!Number.isFinite(e.deltaY) || e.deltaY === 0`, and routed `onBlur` through `resetTransientState()` so pending `longPressTimer` / `dragButton` / `longPressFired` / `pinched` states are always cleared on focus loss.
  - **`bindSimEventBridge` & `GameSession` Listener / Timer Teardown (`src/platform/{sessionBridge,gameSession}.ts`):**
    - `bindSimEventBridge` previously returned only `unbindSound` and leaked all 11 `EventBus` listeners (`economyChanged`, `waveStarted`, `waveCompleted`, `towerBuilt`, `towerUpgraded`, `towerSold`, `enemySpawned`, `enemyHit`, `enemyKilled`, `gameWon`, `gameLost`) when unbound; now unsubscribes all listeners. Also added `cancelStarChimes()`, `simWorld.dispose()`, and `events.clear()` to `GameSession.dispose()` and `showMenuView(..., reloadShowcase = true)`.
  - **`hydrateProgressFromCloud` Explicit Adapter & Corrupt-Blob Safety (`src/platform/{cloudSync,storage}.ts`):**
    - Added `saveLocalProgress` so `hydrateProgressFromCloud` writes merged saves directly to the passed `adapter.cloudSave` (and awaits completion) without relying on the global `getPlatform()` singleton or firing duplicate unawaited achievement IPCs, and guarded the corrupt-cloud-JSON recovery path with `hasAnyProgress(normalizedLocal)` so an empty local save never clobbers a remote cloud slot.
  - **`Haptics.pulse` Clock Guards (`src/platform/haptics.ts`):**
    - Hardened `Haptics.pulse` against `NaN` timestamps (previously poisoned `lastAt` and disabled rate limiting forever) and non-monotonic / rolled-back clocks (previously muted haptics until the clock caught back up).
  - **Defeat Transients, `debugForceLose` Endless Flag & Delayed Endless Replay (`src/sim/{world,replay}.ts`, `qa/bot/invariants.ts`):**
    - `SimWorld.debugForceLose()` now includes `endless: this.waveSystem.isEndless` on `gameLost` (matching `onEnemyLeakedFn`), and both defeat paths call `clearDefeatTransients()` to clear mid-flight projectiles, pending meteors, pending volleys, and transition a `'moving'` hero to `'idle'` (enforced by `qa/bot/invariants.ts`).
    - Hardened `SimReplayPlayer.finished`, `stepTicks`, and `runToEnd` so terminal `'lost'` replays finish cleanly even with trailing commands, while `'won'` replays with a delayed `enterEndless` command (`tick > winTick`) advance seamlessly into Endless mode.
- [x] **9. Round 6 Deep Audit — Defeat Burn/Soldier/Co-Hold Teardown, Hero Death Aura Cleanup, Placement Preview Road-Reach & Cross-Device 2D Save-Code Merges (`src/core/**`, `src/data/**`, `src/sim/**`, `src/platform/**`, `src/render2d/ui/progress2d.ts`, `qa/bot/invariants.ts`)** — *DONE (Round 6)*
  - **Defeat & Forced-Win Transient + Co-Held Blocker Teardown (`src/sim/{world,soldierSystem,heroSystem}.ts`, `qa/bot/invariants.ts`):**
    - `SimWorld.clearDefeatTransients()` now also clears Mortar T3 ground burn zones (`clearBurnZones()`) and barracks soldier combat state (`soldierSystem.clearCombatState()`), while `SoldierSystem.clearCombatState()` and `HeroSystem.clearTransientZones()` zero `e.blockers` / `e.heroBlockers` / `e.heroDamageReduction` on surviving enemies and emit 1-to-1 `enemyUnblocked` events (even when Bran and a soldier co-held the same enemy).
    - `SimWorld.clearVictoryTransients()` also clears `enemyPool` and `spatialHash` so a mid-wave `debugForceWin()` followed by `enterEndlessMode()` never leaks story-wave enemies into Endless `betweenWaves`. Enforced all post-defeat burn-zone, `fireRings`, soldier combat-state, and enemy blocker invariants across all 381 `qa:bot` scenarios.
  - **Immediate Hero Death Aura Cleanup (`src/sim/heroSystem.ts`):**
    - When a hero falls during `HeroSystem.update` (`updateEnemyStrikesAgainstHero`), `clearHeroBuffs(towers)` now immediately zeroes `towers[i].heroRateBonus` / `heroRangeBonus` (Tobb's `Tinker`) before `CombatSystem.update` runs in the same tick and zeroes `soldiers[i].bonusArmor` / `damageMul` (Bran's `Rally Banner` / Sela's `Calm Waters`) before `SoldierSystem.update` runs on the next tick.
  - **Barracks Road-Reach & Banned-Tower Placement Previews + `GameSession.startLevel` Disposal (`src/sim/world.ts`, `src/platform/{sessionBridge,gameSession}.ts`):**
    - Added `SimWorld.canPlaceTowerAt(col, row, type)` (exact dry-run of `placeTower`: outcome, challenge bans, tile/plot occupancy, gold cost, and `soldierSystem.hasRoadInRange` for Barracks) and wired it into `placeTower`, `updatePlacementPreviewFromNdc`, and `GameSession.refreshPlacementPreview` (`radialPreview`) so out-of-reach Barracks and banned towers never show a false-green ghost. Also added `this.simWorld.dispose()` to `GameSession.startLevel()` before replacing `simWorld`.
  - **Cross-Device `importSaveCode2D` Hero Unlock Preservation & Boundary Guards (`src/render2d/ui/progress2d.ts`, `src/platform/storage.ts`, `src/sim/{replay,groundGraph}.ts`, `src/data/runModifiers.ts`, `src/core/pool.ts`):**
    - `importSaveCode2D` now preserves the incoming save code's pre-remap `selectedHero` candidate into `mergeProgress` so cross-device merges where island clears combine across remapped rosters keep unlocked hero selections; `migrateProgress` walks `clears`-only frontiers consistently with `mergeProgress`; `SimWorld.setAutoWave` ignores post-defeat toggles; `SimReplayPlayer.stepTicks` flushes pre-endless commands (`setAutoWave`) preceding delayed `enterEndless`; and `ObjectPool.releaseAtActivePos`, `combineRunModifiers`, and `GroundGraph.clampToGroundOut` guard out-of-bounds/non-positive/negative inputs.
- [x] **10. Round 7 Deep Audit — 2D Steam Achievements & Cloud Sync, `SoldierSystem` Same-Tick Counter-Kill Unblock, `IAP` Catalogue/SKU Normalization & Replay/Input Polish (`src/render2d/ui/{progress2d,modes2d}.ts`, `src/sim/{soldierSystem,waveSystem,world,replay}.ts`, `src/platform/{iap,input}.ts`, `qa/bot/{invariants,hash}.ts`)** — *DONE (Round 7)*
  - **2D Steam Achievement Unlocks & Steam Cloud Save (`src/render2d/ui/progress2d.ts`):**
    - `desktop/main.cjs` boots `2d.html`, yet `saveProgress2D` previously wrote only to `localStorage` (`PROGRESS_2D_KEY`) and never unlocked Steam achievements or pushed 2D progress to Steam Remote Storage.
    - Added `CLOUD_PROGRESS_2D_SLOT = 'progress2d'` (`skyhold_progress2d.json`, isolated from 3D `'progress'`), `saveLocalProgress2D`, automatic Steam Cloud write + `syncAchievementsFromProgress(progress, platform, levels)` in `saveProgress2D` (skipping QA `mock-*` islands), Steam Cloud reset in `resetProgress2D`, and `hydrateProgress2DFromCloud` for monotonic cross-device 2D + hero XP/tree/selection cloud merges.
  - **`SoldierSystem` Same-Tick Block + Counter-Kill `enemyUnblocked` Fix & Immediate `blockedCount` Sync (`src/sim/soldierSystem.ts`, `qa/bot/invariants.ts`):**
    - When a soldier newly blocked an enemy (`!wasBlocked` & `e.heroBlockers === 0`) that carried a small residual `meleeTimer` from an earlier fight and killed the soldier on that exact tick's counter-swing, `e.poolIndex` was missing from `_prevBlocked` and `enemyUnblocked` was never emitted. Fixed by tracking newly-blocked slots in `_prevBlocked` (matching `HeroSystem.assignSingleHeroHold`), decrementing `soldierSystem.blockedCount` immediately on `release(s, true)` (`sellTower` / `setRallyPoint`), and enforcing strict duplicate-`enemyBlocked` / orphan-`enemyUnblocked` invariants in `qa/bot/invariants.ts`.
  - **`IAP` Custom Catalogue & Stored SKU Normalization (`src/platform/iap.ts`):**
    - Normalized stored/restored/mock entitlement IDs against the active `catalogue` + `/^[a-zA-Z0-9_.-]{1,80}$/` validator across `readIdSetFromKey`, `persistEntitlements`, `createMockIapBackend`, and `extractEntitlementsFromCustomerInfo` so cached store SKUs resolve `store.owned('full_unlock') === true` on boot and malformed tokens never linger in memory.
  - **Delayed `enterEndless` Same-Tick Siblings, `autoShortenedBy` Digest, `findHoveredEnemy` & 3→2 Finger Pinch (`src/sim/{replay,waveSystem,world}.ts`, `qa/bot/hash.ts`, `src/platform/input.ts`, `src/render2d/ui/modes2d.ts`):**
    - `SimReplayPlayer.stepTicks` now flushes sibling commands (`startWave`, tower builds) stamped on the same delayed tick as `enterEndless`; `WaveSystem.getAutoShortenedBy()` is included in `computeSimStateHash` & `hashWorldState` and zeroed in `skipToWave`; `SimWorld.findHoveredEnemy` skips `hp <= 0` corpses and `burrowed` enemies; `InputManager.onPointerUp` re-anchors pinch midpoint/distance when lifting a 3rd touch finger back to 2 fingers; and `resolveQueryRun2D` returns `NEUTRAL_RUN_MODIFIERS` when zeroed workshop ranks produce a neutral patch.
- [x] **11. Round 8 Deep Audit — Mid-Tick Unblock Re-Entrancy, Resolved `heroSkillCast` Targets, Replay Victory-Wait Pacing & Cloud/Daily/DOM Hardening (`src/sim/{heroSystem,soldierSystem,projectileSystem,waveSystem,world,replay}.ts`, `src/platform/{saveCode,cloudSync,gameSession,safeArea,deviceClass,serviceWorker}.ts`, `src/render2d/ui/progress2d.ts`)** — *DONE (Round 8)*
  - **Mid-Tick Listener `enemyUnblocked` Deduplication & Zero-Alloc Scratch (`src/sim/{heroSystem,soldierSystem}.ts`):**
    - When `commandHeroMove`, `setRallyPoint`, or `sellTower` is invoked inside a mid-tick event listener (`'heroHit'`, `'meleeHit'`, etc.), `releaseCurrentMeleeHolds(true)` / `SoldierSystem.release(s, true)` now invalidates the corresponding `_prevTotalBlocked` / `_prevBlockedUid` slot so end-of-tick reconciliation never emits a duplicate `enemyUnblocked` for the same enemy. Also reused module-level `_rallyRoadPt` in `SoldierSystem.setRally` and `_gizmoPlacementOut` in `HeroSystem.resolveGizmoPlacement`.
  - **Resolved `heroSkillCast` Target Coordinates (`src/sim/{heroSystem,projectileSystem}.ts`):**
    - `heroSkillCast` now emits the actual resolved `(targetX, targetZ)` for `deployGizmo` (plot-cleared verge position rather than raw plot center), `overhaul` (snapped tower/gizmo), `huntersMark` (marked foe), `thunderCall` (first struck foe), and `shieldBash` (cone point in front of Bran's shield), aligning 2D `HeroLayer` FX bursts without altering hero combat RNG or `yaw`. Also credited `onHeroHit` in `ProjectileSystem.resolvePierce`.
  - **Replay Victory-Wait Tick Pacing & `SimWorld` / `WaveSystem` Guards (`src/sim/{replay,world,waveSystem}.ts`):**
    - `SimReplayPlayer.stepTicks` now advances paused victory windows (`outcome === 'won'` with delayed `enterEndless`) 1 tick at a time instead of jumping ahead, keeping `seekToTick` and post-endless command deltas exact at every intermediate tick.
    - Guarded `SimWorld.fixedTick` against non-finite / `<= 0` `dt`, validated `TowerType` and `TargetingMode` on `canPlaceTowerAt` / `placeTower` / `setTowerTargeting`, and added `WaveSystem.markFinished()` (wired into `debugForceWin()`) + residual bonus/queue cleanup in `enterEndlessMode()`.
  - **`mergeDaily` Commutativity, Empty-Local Steam Cloud Guard, `GameSession` & DOM Hardening (`src/platform/{saveCode,cloudSync,gameSession,safeArea,deviceClass,serviceWorker}.ts`, `src/render2d/ui/progress2d.ts`):**
    - Fixed `mergeDaily(a, b)` non-commutativity when `a.lastDay === b.lastDay` with a `streak === 0` record, sanitized `mergeDaily` inputs, and added `+N daily win(s)` to `describeMergeGain`.
    - Guarded `hydrateProgressFromCloud` and `hydrateProgress2DFromCloud` so an empty local save never writes an empty blob to Steam Cloud during a temporary `cloudRead` outage (and skipped `mock-*` islands in `hydrateProgress2DFromCloud`).
    - Hardened `GameSession` async cloud hydration (`this.disposed` + monotonic re-merge against live `this.progress`), `dailyShareText` streak on Daily replays (`liveStreak`), `meteorReady` onboarding under `Silent Skies`, detached `readSafeArea` probes, duplicate `initDeviceClass` media listeners, and non-positive `registerServiceWorker` `checkEveryMin`.
- [x] **12. Round 9 Deep Audit — Re-Entrant Hero Skill Cooldowns & Scratches, Causal Replay `seq` Recording, Burrowed Subsystem Guards & `mergeProgress` / Platform Hardening (`src/sim/**`, `src/data/runModifiers.ts`, `src/platform/{saveCode,platform,qualityController}.ts`, `src/render2d/ui/modes2d.ts`)** — *DONE (Round 9)*
  - **Re-Entrant `HeroSystem.castSkill` Cooldown, Per-Phase Scratch Isolation & Lethal `0-HP` Guard (`src/sim/heroSystem.ts`):**
    - `castSkill` previously applied `h.skillCooldowns[slot] = act.cooldownSec` *after* `executeActive(...)` returned, allowing synchronous `'enemyHit'` / `'enemyKilled'` / `'shieldBroken'` / `'lightningChain'` / `'groundZone'` listeners to re-enter `castHeroSkill(slot)` with `cooldown === 0` (infinite recursion / free recasts). Now commits the cooldown upfront as soon as target validation succeeds, isolates zero-allocation scratch buffers (`_skillCandidates0/1`, `_hitSets[0/1]`, `_resolvedCastTargets[0/1]`, `_periodicCandidates`, `_strikeCandidates`, `_queryCandidates`, `_holdCandidates`, `_cleaveCandidates`), recomputes hero armor per strike inside `updateEnemyStrikesAgainstHero`, and enforces `h.hp > 0` in `getRuntimeState`, `commandMove`, and `castSkill` so lethal `'heroHit'` callbacks report `alive: false` and cannot resurrect a 0-HP hero.
  - **Causal `seq` Ordering in `SimWorld` Replay Command Recording (`src/sim/{world,soldierSystem,heroSystem}.ts`):**
    - `SimWorld` methods previously called `recordCommand` *after* emitting synchronous `EventBus` events, and `placeTowerOnPlot` wrapped `placeTower` (including `'towerBuilt'` / `'economyChanged'`) in `recordSuppressDepth > 0`. Synchronous follow-up commands issued inside `'towerBuilt'`, `'towerSold'`, `'waveStarted'`, `'economyChanged'`, or `'endlessEntered'` were either suppressed or stamped *before* their parent command (`seq = 0` before `seq = 1`), breaking `SimReplayPlayer` playback. Refactored `placeTowerInternal` (removing `recordSuppressDepth`) and committed all command records *before* emitting events, so parent→child listener chains replay bit-for-bit; also made `applyCommand({ kind: 'setAutoWave' })` return `false` post-defeat and eliminated temporary `RoadPoint` allocations in `hasRoadInRange` / `addBarracks`.
  - **Burrowed-Enemy Guards Across Combat Subsystems (`src/sim/{targeting,combatSystem,abilitySystem,projectileSystem}.ts`):**
    - Added `!e.burrowed` checks across `acquireTarget`, `CombatSystem` (`fireVolley` + `hitsFlyers`, `fireChainLightning`), `AbilitySystem` meteor impacts, and `ProjectileSystem` (`updateBurnZones`, single-target `resolveImpact` / `resolvePierce`, `applySplash`) so direct subsystem callers never hit or pierce off underground burrowers (`sim:balance` stays 100% byte-identical across all 33 levels).
  - **`mergeProgress` NaN / Workshop Fallback, `combineRunModifiers` Clamping & Platform Guards (`src/platform/{saveCode,platform,qualityController}.ts`, `src/data/runModifiers.ts`, `src/render2d/ui/modes2d.ts`):**
    - Hardened `mergeProgress` against `NaN`/negative/out-of-range array entries, inferred `clears >= 1` for v1 `bestStars > 0` records, preserved the affordable side's Workshop ranks when the higher-spent side exceeds earned stars instead of wiping `workshop` to `{}`, and reported `'hero skills'` in `describeMergeGain`.
    - Clamped non-positive/negative multipliers and `maxLives < 1` in `combineRunModifiers`, snapshotted `onPause` / `onResume` / `onOverlayChange` listener sets in `createPlatformAdapter` (plus non-string `slot`/`id` guards), guarded `QualityController.frame` against `Infinity`/`NaN` frame samples, and aligned `modes2d` (`availableChallenges`, `dailyForToday`, `canPlayEndless`) with `heroes2d` for v1 star-only clears.
- [x] **13. Round 10 Deep Audit — `FixedTimestepStepper` / `SimReplayPlayer` Mid-Frame Pause & Accumulator Guards, Idempotent `EventBus` Subscriptions, Lethal `heroHit` Runtime State & Cross-Device 2D Workshop Merges (`src/core/**`, `src/sim/{replay,heroSystem,soldierSystem}.ts`, `src/platform/{cloudSync,gameSession}.ts`, `src/render2d/{heroes2d,ui/progress2d}.ts`, `qa/bot/invariants.ts`)** — *DONE (Round 10)*
  - **Mid-Frame `3×`/`8×` Pause Halt & `resetAccumulator` Underflow Fix (`src/core/gameLoop.ts`, `src/sim/replay.ts`):**
    - `FixedTimestepStepper.step` and `SimReplayPlayer.stepFrame` previously checked `simActive && !paused` only before entering the multi-tick catch-up loop (up to 18 ticks at `3×` / 48 ticks at `8×`) and decremented `this.accumulator` *after* `onFixedTick` / `stepTicks(1)`. Pausing mid-frame (`gameWon`, `gameLost`, first-sighting modal, Steam overlay) still executed remaining catch-up ticks while paused, and calling `resetAccumulator()` / `reset()` / `seekToTick()` inside a tick underflowed `this.accumulator` to `-BALANCE.fixedDt`. Fixed by re-checking active/paused state inside the loop and decrementing `accumulator` upfront.
  - **Idempotent Per-Registration `EventBus` Unsubscribes (`src/core/eventBus.ts`):**
    - Replaced function-value lookup with lightweight `ListenerEntry` slots (`{ fn, active }`) so calling `off()` twice never removes a second subscription of the same callback reference, mid-emit `off()` / `clear()` skips deactivated slots in O(1) without affecting sibling registrations, and normal `emit()` stays zero-allocation.
  - **Lethal `'heroHit'` `getHeroState` Consistency & Aura-Boosted Barracks Rally Reach (`src/sim/{heroSystem,soldierSystem}.ts`, `qa/bot/invariants.ts`):**
    - `HeroSystem.updateEnemyStrikesAgainstHero` now transitions a 0-HP hero into `'dead'` (setting `respawnTimer`, clearing buffs & holds) *before* emitting `'heroHit'` and `'heroDied'`, so HUD/QA listeners calling `world.getHeroState()` on a lethal blow see `{ alive: false, state: 'dead', hp: 0, respawnRemaining > 0 }` (enforced across all hero runs in `qa/bot/invariants.ts`).
    - `SoldierSystem.setRally` now scales barracks rally placement range by `1 + tower.auraRange + (tower.heroRangeBonus ?? 0)` (matching `acquireTarget` and `CombatSystem.fireVolley`).
  - **Cloud Non-Object JSON Guard, Pre-Remap 2D Workshop Merges & 0-XP `selectedHero` Persistence (`src/platform/{cloudSync,gameSession}.ts`, `src/render2d/{heroes2d,ui/progress2d}.ts`):**
    - Guarded `hydrateProgressFromCloud` against valid non-object JSON (`"null"`, `"42"`, `"[]"`) so an empty local save never overwrites `CLOUD_PROGRESS_SLOT`; preserved pre-remap `workshop` candidates in `importSaveCode2D` and `hydrateProgress2DFromCloud` when combined stars can afford them; persisted `selectedHero` changes on 0-XP / `MAX_HERO_XP` runs in `recordRunResult2D`; guarded invalid `heroId`s in `applyHeroXp`; and aligned `GameSession` (`selectIsland`, `todaysDaily`, `startLevel`) with v1 star-only clears.
- [x] **14. Round 11 Deep Audit — Mid-Tick `sellTower` Re-Entrancy in `SoldierSystem`/`CombatSystem`, Cross-Device `mergeProgress` Workshop Unions, Async Cloud-Read Race Protection & Replay/Platform Hardening (`src/sim/{soldierSystem,combatSystem,projectileSystem,replay}.ts`, `src/data/heroes.ts`, `src/platform/{saveCode,storage,cloudSync,gameSession,contentStorage,iap}.ts`, `src/render2d/ui/progress2d.ts`, `qa/bot/runner.ts`)** — *DONE (Round 11)*
  - **Mid-Tick `sellTower` / `placeTower` Re-Entrancy Safety (`src/sim/{soldierSystem,combatSystem,projectileSystem}.ts`):**
    - `SoldierSystem.removeBarracks` previously left removed squad soldiers in `'fighting'` and spliced `this.barracks` / `this.soldiers` mid-loop while `this.primary[e.poolIndex]` held a raw mutable array index: selling a barracks inside `'soldierAttack'`, `'soldierHurt'`, `'soldierDied'`, or `'meleeHit'` could fire post-removal T3 `cleave` / `'meleeSwing'` events, skip the next barracks's swings, or misroute `'meleeSwing'` onto another barracks's soldier. Fixed by marking removed squad members `'dead'`, snapshotting `_stepBarracksIds` & `_sweepSoldiers`, and storing monotonic `soldier.id` in `this.primary` (`getSoldierById`).
    - `CombatSystem.update` now snapshots `_stepTowerIds` (zero per-tick allocations) so selling or building a tower inside `'beaconPulse'` / `'towerFired'` / `'enemyHit'` / `'lightningChain'` never skips or double-ticks sibling towers. Also propagated `isBossHit` on Ballista T2/T3 piercing impacts (`ProjectileSystem.resolvePierce`).
  - **Commutative `mergeProgress` Workshop Unions & `describeMergeGain` (`src/platform/saveCode.ts`, `src/data/heroes.ts`, `src/render2d/ui/progress2d.ts`):**
    - `mergeProgress` now unions non-overlapping Workshop ranks (`Math.max` per upgrade) whenever the merged `starWallet` can afford them (falling back deterministically to the higher-spent side, then the affordable side, then `{}`), keeps `mergeHeroSaveData` tie-breaking commutative across equal-XP saves, compares `workshopStarsSpent` on pre-remap 2D saves, and reports `'workshop upgrades'` in `describeMergeGain`.
  - **Concurrent Local-Write Protection Across Async Cloud Hydration (`src/platform/{cloudSync,storage,gameSession}.ts`, `src/render2d/ui/progress2d.ts`):**
    - Both `hydrateProgressFromCloud` and `hydrateProgress2DFromCloud` now detect `localStorage` writes that happened while `await adapter.cloudSave.read(...)` was in flight (`diskRawAfter !== diskRawBefore`) and fold them monotonically into `normalizedLocal` before persisting, and `GameSession` persists diverged in-memory progress and catches rejected cloud promises cleanly.
  - **Replay `0.05..0.1` Modifier Fidelity, `SimReplayPlayer.dispose()`, `ContentStore` & `IAP` Guards (`src/sim/replay.ts`, `src/platform/{contentStorage,iap}.ts`, `qa/bot/runner.ts`):**
    - Delegated `sanitizeReplayModifiers` directly to `combineRunModifiers` so valid `0.05..0.1` multipliers round-trip bit-for-bit while corrupt `<= 0` replay modifiers fall back to `1`; added `SimReplayPlayer.dispose()`; and hardened `ContentStore` (`clears`-only saves, `Infinity` frontiers, non-string IDs/statuses) and `IAP` (`null`/non-string IDs).

---

## Requests for Other Agents

1. **Opus (`src/render2d/game2d.ts`, `src/render2d/ui/worldMap.ts`):**
   - `Game2D.towerHasTarget(t)` (around line 267): currently skips `!e.active || e.hp <= 0 || (e.flying && !def.hitsFlyers)` without checking `e.burrowed`, so attack towers pre-roll attack sheets at underground `burrower`s they cannot shoot; also `maxSq` uses `(st.range * (1 + t.auraRange)) ** 2` without `+ (t.heroRangeBonus ?? 0)` (Tobb's upgraded Tinker range bonus).
   - `Game2D.syncRangePreview()` / `openForPlot()` (lines 734 & 906): range preview disc uses base `getTowerTierStats(type, tier).range` instead of scaling by `(1 + t.auraRange + (t.heroRangeBonus ?? 0))` when inspecting an aura-buffed tower.
   - `Game2D.wireEvents()` `lightningChain` handler (line 376): when `t` is null (Sela's **Thunder Call**, where `points[0]` is `{ x: h.x, y: 1.1, z: h.z }`), `muzzle` falls back to `this.towers.muzzleHeight('tesla')` instead of `p0.y`, drawing the bolt origin above Sela's head.
   - `worldMap.ts` / `main2d.ts` (optional 1-line Steam Cloud pull on boot): `saveProgress2D` now automatically writes `'progress2d'` to Steam Cloud and unlocks Steam achievements on every 2D save; to also pull remote Steam Cloud progress on launch, call `hydrateProgress2DFromCloud()` from `./progress2d.ts` when `getPlatform().isSteam` is true and refresh `progress` if `updated === true`.
2. **Codex (`src/sim/enemySystem.ts`):**
   - `EnemySystem.updateHealerAura` (line 840): checks `if (!ally.active || ally.hp >= ally.maxHp) continue;` — harmless today since pass 1 releases `hp <= 0`, but adding `|| ally.hp <= 0 || ally.burrowed` is a good defensive guard if new enemy death-delay mechanics are added tonight.

---

## Hero Balance — Before vs After (`npm run sim:heroes`)

### 1. Controlled 55s Unit Power Equivalence Benchmark (`l1c` mixed ground/armored/flyer wave)
- **Spec Targets (`docs/hero-spec.md`):**
  - **Level 1 Target (`1× Tier-2 Barracks`, 140g):** `648 dmg`
  - **Level 20 Target (`2× Tier-3 Towers: Archer + Cannon`, 500g):** `7,642 dmg`

| Hero | Before L1 Dmg | After L1 Dmg | After L10 Dmg | Before L20 Dmg (`B0+1`) | After L20 Dmg (`B0+1 / B0+2 / B1+2`) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Bran Ironoak** | `224` *(35% of ref)* | `959` | `2,014` | `6,011` | `7,683 / 6,767 / 8,492` |
| **Wren Skyfletch** | `499` *(77% of ref)* | `646` | `2,633` | `5,776` | `7,532 / 7,105 / 6,746` |
| **Mira Emberwisp** | `537` *(83% of ref)* | `575` | `3,829` | `7,783` | `7,174 / 6,212 / 7,081` |
| **Tobb Gearwright** | `733` *(113% of ref)* | `653` | `2,019` | `5,948` | `7,530 / 6,508 / 7,730` |
| **Sela Tidecaller** | `622` *(96% of ref)* | `685` | `2,183` | `5,609` | `7,673 / 7,456 / 8,202` |

### 2. Campaign Island Impact (`l1c`, `i05`, `i10`, `i16` — Greedy / Weak)
- **Before:** `bran` L1 dealt only `2.9k–3.7k` across 15–20 waves and `bran` L20 failed to reach 3★ on Master `i10` (`12L 2★`, vs `20L 3★` for every ranged hero), while `mira` L20 dominated `i05` (`101k–105k`, ~3.5×–4.5× `bran`/`sela`).
- **After:**
  - Every hero at L20 turns `l1c` Weak (`11L 2★` baseline) into `20L 3★`, turns `i05` Weak (`Loss 0L` baseline) into a victory (`9L–20L`), and upgrades **both** Master `i10` Greedy (`5L 1★` baseline) and Master `i16` Greedy (`5L 1★` baseline) to **3★ clears** (`bran` L20 now clears `i10` at `13L 3★` and `i16` at `13L 3★`; `wren`/`mira`/`tobb`/`sela` L20 all clear at `20L 3★`).
  - Master `i10` L20 Greedy hero damage band narrowed from `26.1k–63.5k` (`2.44×` spread) to `28.0k–66.7k` with every hero earning 3★, and no hero solo-carries Master Weak (`L 0L` on `i10`/`i16` weak across all 5 heroes).
  - Kept all `src/i18n/heroesTr.ts` node percentage strings untouched by tuning `baseStats`, `levelGrowth`, passive base power (`Kindling` / `Calm Waters`), and active base damage/cooldowns/radii.

---

## Speed 3× & Deterministic Replay Command API (for Opus)

### 1. Speed 3× Helpers (`src/core/gameLoop.ts`, `src/platform/browserLoop.ts`)
- `FixedTimestepStepper` already runs up to `MAX_STEPS_PER_FRAME = 18` fixed 60 Hz ticks per 100 ms frame (zero sim-time loss at `3×` speed, bit-identical to `1×` and `2×`).
- New helpers exported from `src/core/gameLoop.ts`:
  ```ts
  import {
    SPEED_MULTIPLIERS,     // readonly [1, 2, 3]
    isSpeedMultiplier,     // (val: unknown) => val is 1 | 2 | 3
    clampSpeedMultiplier,  // (val: unknown, fallback?: SpeedMultiplier) => 1 | 2 | 3
    nextSpeedMultiplier,   // 1 -> 2 -> 3 -> 1
  } from '../core/gameLoop.ts';

  // Drop-in replacement in Game2D.tap() (src/render2d/game2d.ts line 960):
  else if (hudHit === 'speed') this.stepper.cycleSpeed();
  // Direct keyboard hotkey (e.g. Digit1/Digit2/Digit3):
  this.stepper.setSpeed(3);
  ```

### 2. Recording a Run (`src/sim/world.ts`, `src/sim/replay.ts`)
- **Zero-touch recording:** Pass `recordCommands: true` in `SimWorldOptions` (or call `world.setCommandRecording(true)`). Every successful call on `SimWorld` (`placeTower`, `placeTowerOnPlot`, `upgradeTower`, `sellTower`, `setTowerTargeting`, `setRallyPoint`, `startNextWave`, `setAutoWave`, `commandHeroMove`, `castHeroSkill`, `castMeteor`, `castOvercharge`, `castAbility`, `startEndlessFromStart`, `enterEndlessMode`, or `world.applyCommand(cmd)`) automatically appends a `{ tick, seq, command }` entry!
  ```ts
  import {
    SimWorld,
    SimReplayPlayer,
    serializeSimReplay,
    parseSimReplay,
    type SimCommand,
    type StampedSimCommand,
    type SimReplayLog,
  } from '../sim/world.ts';

  const world = new SimWorld(level, events, modifiers, {
    heroId: hero?.heroId,
    heroLevel: hero?.level,
    heroSkills: hero?.skills,
    seed: hero?.seed,
    recordCommands: true,
  });

  // Optional live feed hook for a replay/action timeline UI:
  world.onCommandRecorded = (entry: StampedSimCommand) => {
    // entry = { tick: world.tick, seq, command }
  };

  // At run end (or any time): export self-contained JSON-serializable replay log (with 64-bit FNV-1a stateHash):
  const replay: SimReplayLog = world.exportReplay();
  const json: string = serializeSimReplay(replay);
  ```

### 3. Playing Back & Scrubbing a Replay (`SimReplayPlayer`)
- `SimReplayPlayer` reconstructs `SimWorld` with exact `seed`, `modifiers`, and `hero`, dispatches commands at exact `(tick, seq)` boundaries, supports `1×–8×` playback in a Pixi RAF loop, and mutes `EventBus` automatically during `seekToTick` timeline scrubs so audio/FX listeners are never spammed:
  ```ts
  const parsed = parseSimReplay(json); // returns SimReplayLog | null (never throws)
  if (parsed) {
    const player = new SimReplayPlayer(level, parsed, events);
    // Render `player.world` with the exact same Game2D layers!

    // Per Pixi frame (supports speedMultiplier = 1, 2, 3, 4, 8, and paused; or stateful player.speed / player.paused / player.cycleSpeed()):
    const { alpha, currentTick, finished } = player.stepFrame(dtSec, replaySpeed, replayPaused);
    const progress01 = player.progress; // currentTick / player.totalTicks

    // Timeline scrubber (forward or backward rewind to any tick 0..player.totalTicks; snaps alpha to 0):
    player.seekToTick(targetTick);

    // Optional integrity check at replay end, then release pooled entities:
    const check = player.verifyState(); // { matchesOutcome, matchesHash, actualHash, expectedHash }
    player.dispose();
  }
  ```
