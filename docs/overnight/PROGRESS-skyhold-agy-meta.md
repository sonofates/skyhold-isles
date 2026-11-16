# Overnight Progress — META (`hermes/skyhold-agy-meta`)

## Status Overview
All 5 meta-progression & replayability backlog items + live in-run tracking, daily calendar streaks, bugfixes, difficulty-aware daily balancing, and cheat hardening are implemented, verified, and passing all checks (`tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, `npm run sim:balance`). Ready for morning integration & UI hookup.

---

## Completed
1. **Per-Island Optional Challenges (`src/data/challenges.ts`, `src/sim/meta/runObserver.ts`)**
   - 27 hand-crafted optional challenges (3 per island for Islands 1–9), keyed by `level.id` (`CHALLENGES_BY_LEVEL_ID`), awarding Challenge Stars tracked separately from normal 3-star campaign ratings.
   - Verified all 27 curated challenges across Islands 1–9 against `SimWorld` (including ban-substituted & budget-constrained runs) to confirm winnability.
   - Deterministic `getChallengesForLevel(level)` fallback generator keyed by `level.id` so new islands (10+) added by ENEMIES/ISLANDS automatically get 3 balanced, persistable challenges.
   - `RunObserver` observes `EventBus` purely without modifying `EnemySystem` or `WaveSystem`, rejects debug-skipped (`debugSkipToWave`), debug-forced (`debugForceWin`), debug-spawned (`enemySpawned` outside wave phase or via `pendingDebugSpawns`), or post-loss resumed runs from unlocking challenges/dailies/wins, and prevents sell-rebuild cheese on `maxTowersBuilt` / `maxGoldSpent`.
   - Snapshots story win state on `gameWon` (`getStoryWinSnapshot`) so entering Endless Mode never retroactively flips completed story challenges to `'failed'` in `getLiveChallengeStates()`.
   - Added live mid-run tracker (`evaluateLiveLevelChallenges`, exposed via `session.getLiveChallengeStates()`) reporting `'on_track' | 'failed' | 'completed'` plus human-readable `progressLabel` (e.g., `4/6 towers`, `1240/2750g`, `Set 3x before W1`, `Banned tower built`) and `previouslyCompleted`.

2. **Achievements & Lifetime Stats (`src/data/challenges.ts`, `src/sim/meta/metaEngine.ts`, `src/platform/metaSession.ts`)**
   - 25 achievements across `campaign`, `combat`, `economy`, `mastery`, and `endless` categories with progress counters (`current`, `target`, `progressRatio`), including `upgrade_specialist` (100 upgrades), `mutated_endless` (5+ mutated Endless waves in one run), and `daily_streak_3` (3 consecutive Daily Challenge days).
   - `LifetimeStats` tracks `totalPlayTimeSec`, `gamesPlayed`, `gamesWon`, `gamesLost`, `wavesCleared`, `earlyWavesCalled`, `enemiesDefeatedTotal`, `enemiesDefeatedByType` (open `Record<string, number>` so future enemy types count automatically), `flyingEnemiesDefeated`, `towersBuiltTotal`, `towersBuiltByType` (open `Record<string, number>`), `towersUpgradedTotal`, `towersUpgradedToTier3`, `towersSoldTotal`, `goldEarnedTotal`, `goldSpentTotal`, `abilitiesCastTotal`, `meteorsCast`, `overchargesCast`, `towersCleansed`, `perfectClears`, `bestEndlessWaveOverall`, `bestEndlessScoreOverall`, and `dailyChallengesCompleted`.
   - Incremental delta flushing on `waveCompleted` / `endlessEntered` / `gameWon` / `gameLost` / `endRun` ensures stats, `bestEndlessScoreOverall`, and `mutated_endless` persist mid-run (even when quitting Endless early) without double-counting.

3. **Versioned Save Persistence & v1 Migration (`src/platform/storage.ts`, `src/sim/meta/metaEngine.ts`)**
   - Versioned `MetaSaveData` (`version: 2`, key `skyhold_isles_meta_v2`) alongside `skyhold_isles_progress_v1`.
   - `migrateToMetaSave` / `loadMetaSave` transparently migrates existing `skyhold_isles_progress_v1` saves (`unlockedLevelIndex`, `bestStars`, `bestEndlessWaves`) and earlier v2 payloads, merges monotonically with `Math.max` so neither v1 nor v2 ever wipes progress, handles corrupt/partial JSON, expands arrays cleanly when new islands are added, and retroactively grants implied achievements (`first_victory`, `endless_survivor`, `daily_streak_3`, etc.).

4. **Endless Mutators (`src/data/challenges.ts`, `src/sim/meta/mutators.ts`, `src/sim/meta/modifiers.ts`)**
   - 8 mutators (`swift_march`, `iron_clad`, `sky_swarm`, `gold_drought`, `titan_tide`, `tight_budget`, `no_frost`, `no_tesla`) with conflict-group guards so seeded rolls never pair conflicting economy squeezes or stack anti-air bans with `sky_swarm`.
   - `selectEndlessMutators(seed, count)` accepts integer or string seeds and returns deterministic mutators, merged `RunModifiers`, and `scoreMultiplier`.
   - `RunObserver` tracks `endlessEnemiesKilled` separately from story kills so `computeEndlessScore(wavesClearedInEndless, endlessEnemiesKilled, scoreMultiplier)` accurately scores Endless performance.
   - `describeActiveModifiers` formats active mutators and tower restrictions into clean UI badges (`ModifierBadgeInfo`).

5. **Daily Challenge & Streaks (`src/sim/meta/daily.ts`)**
   - Pure function `generateDailyChallenge(dateStr, levels?)` seeded by strict calendar `YYYY-MM-DD` string (`isValidDateString`, including leap years).
   - Deterministically picks island, compatible mutators, and tower restriction (`none`, `ban_one`, `limited_arsenal`) while guaranteeing at least 1 anti-air tower (`hitsFlyers`) remains available, scaling rule severity by island difficulty (`Master` islands cap at 1 non-drought mutator and avoid double-bans/`limited_arsenal`/anti-air bans on `sky_swarm`), and keeping `spec.scoreMultiplier === spec.modifiers.scoreMultiplier` exact.
   - `computeDailyStreaks(completedDates, referenceDate)` computes `currentStreak` and `bestStreak` via pure UTC calendar-day math.
   - Daily completions record `dailyBestScores` and `daily_victor` without prematurely unlocking locked campaign islands (and reject debug-tainted wins).

6. **Tests (`tests/sim/metaChallenges.test.ts`, `tests/sim/metaMutatorsAndDaily.test.ts`, `tests/sim/metaSaveAndStats.test.ts`)**
   - Comprehensive unit & `SimWorld` integration coverage (79 total tests passing across 12 suites): challenge conditions, live mid-run challenge status, Endless story-snapshot freezing, anti-cheat/anti-sell-cheese/debug-spawn/post-loss resume rejection, Island 1 6-tower 3x flawless clear, fallback challenges for Islands 10+, mutator determinism & `SimWorld` physics/economy/cost-helper integration, daily challenge determinism & 120-day `scoreMultiplier`/Master fairness invariants, calendar streaks, build restriction queries, v1->v2 save migration, mid-Endless quit persistence, and `MetaSession` lifecycle.

---

## Cross-Area Changes (Minimal & Documented)
- `src/sim/world.ts`:
  - Added optional 3rd constructor parameter `modifiers?: RunModifiers | null` (defaults to neutral; existing 2-arg callers and `balanceSim.ts` are untouched).
  - Added `getTowerBuildCost(type)` and `getTowerUpgradeCost(towerOrId)` helpers reflecting `towerCostMultiplier` (reused in `placeTower` & `upgradeTower`).
  - Guarded `debugForceWin()` so it is a no-op once Endless Mode is active.
  - Enforces tower bans (`isTowerTypeAllowed`), tower cost scaling (`scaleGoldCost`), gold reward scaling (`scaleGoldReward`), enemy HP/speed/armor scaling (`spawnConfiguredEnemy`), story wave flyer scaling (`applyModifiersToLevel`), and staggered endless extra flyers (`pendingExtraFlyers`).
  - `enterEndlessMode(modifiers?: RunModifiers | null)` accepts optional mutator modifiers.
  - Zero edits to `enemySystem.ts`, `waveSystem.ts`, `combatSystem.ts`, `core/types.ts`, `core/eventBus.ts`.
- `src/platform/sessionBridge.ts`:
  - Updated `updatePlacementPreviewFromNdc` to check `simWorld.getTowerBuildCost(placementType)` and `isTowerTypeAllowed(placementType, simWorld.modifiers)` so placement ghost validity matches `SimWorld.placeTower` under `tight_budget` (`towerCostMultiplier !== 1`).
- `src/platform/gameSession.ts`:
  - Thin delegation to `MetaSession` (`src/platform/metaSession.ts`).
  - Prevents placement ghosting for banned tower types in `setPlacementMode`.
  - Taints `meta.markDebugTainted()` when `pendingDebugSpawns` are active.
  - Guards `recordWinProgress` on `onGameWon` so Daily Challenge runs don't unlock locked campaign islands.
  - Exposes typed UI API methods directly on `GameSession`.

---

## Typed UI Integration Contract (Ready for Morning UI Wiring)
UI files (`src/ui/**`, `src/style.css`) and render files (`src/render/**`) were not touched. UI can call these typed methods on `GameSession` (or `session.meta`):
- `session.getChallengeStatus(levelIndex): LevelChallengeStatus | null`
  - `{ levelId, levelIndex, levelName, earnedStars, totalStars, challenges: [{ def, completed }] }`.
- `session.getAllChallengeProgress(): AllChallengeProgress`
  - Total challenge stars earned (`earnedStars / totalStars`) and per-island breakdown.
- `session.getLiveChallengeStates(): readonly LiveChallengeStatus[]`
  - Mid-run status for active HUD / Pause Menu checklist (`state: 'on_track' | 'failed' | 'completed'`, `previouslyCompleted`, `progressLabel`).
- `session.getAchievements(): readonly AchievementStatus[]`
  - All 25 achievements with `{ def, unlocked, current, target, progressRatio }`.
- `session.getStats(): LifetimeStats`
  - Lifetime statistics snapshot (including `bestEndlessScoreOverall`) for Career / Stats modal.
- `session.getDailyChallenge(dateStr?): DailyChallengeSpec` & `session.getDailyStatus(dateStr?): DailyStatus`
  - Daily challenge details (`title`, `summary`, `levelName`, `mutators`, `towerRestriction`, `scoreMultiplier`, `completedToday`, `bestScoreToday`, `currentStreak`, `bestStreak`).
- `session.startDailyChallenge(dateStr?): DailyChallengeSpec` & `session.getActiveDailyChallenge(): DailyChallengeSpec | null`
  - Launches today's daily challenge directly into `playing` view, and checks whether a daily run is currently active.
- `session.getActiveModifierBadges(): readonly ModifierBadgeInfo[]`
  - Formatted active mutators & tower restrictions for HUD / Pause Menu banners.
- `session.getAllowedTowerTypes(): readonly TowerType[]` & `session.isTowerAllowed(type): boolean`
  - For disabling/locking restricted tower cards in BuildBar / radial menu.
- `session.getTowerBuildCost(type): number` & `session.getTowerUpgradeCost(towerId): number | null`
  - Effective build & upgrade gold costs accounting for `towerCostMultiplier` (`tight_budget`).
- `session.rollEndlessMutators(seed?, count?): EndlessMutatorRoll` & `session.enterEndlessMode(seedOrModifiers)`
  - Lets Outcome modal / Endless setup preview mutators + score multiplier and launch mutated Endless runs.
- `session.getLastRunMetaOutcome(): RunMetaOutcome | null`
  - Populated immediately on `gameWon` / `gameLost` with `{ won, isDaily, newlyCompletedChallengeIds, newlyUnlockedAchievementIds, endlessScore, dailyScore }`.

### UI / Render Needs for Lead / UI Team
1. **Level Select cards**: Display Challenge Stars (`earnedStars / totalStars`, distinct badge/color from normal 3★) + expandable/hover challenge checklist per island.
2. **Main Menu / Daily Card**: "Daily Watch" entry showing `getDailyStatus()`, streak badge (`currentStreak`), rules summary (`spec.summary`), score multiplier, and launch button (`session.startDailyChallenge()`).
3. **In-Game HUD / Pause Menu**: Optional compact challenge tracker (`session.getLiveChallengeStates()`) and active mutator/restriction pills (`session.getActiveModifierBadges()`).
4. **BuildBar / Radial Menu / TowerPanel / `towerBadges.ts`**: Disable/lock tower cards where `!session.isTowerAllowed(type)`, and update `BuildBar`, `TowerPanel`, and `src/render/towerBadges.ts:186` to read `session.getTowerBuildCost(type)` / `simWorld.getTowerUpgradeCost(tower)` instead of raw `getTowerTierStats(...).upgradeCost` so displayed costs & affordability arrows stay accurate under `tight_budget`.
5. **Achievements & Stats Modal**: Tabs for Achievements (25 items with progress bars via `current / target`) and Lifetime Stats (`getStats()`).
6. **Outcome Modal**: Show newly completed challenges, newly unlocked achievements (`getLastRunMetaOutcome()`), and optional Endless Mutator seed toggle on "Continue Endless".

---

## Decisions & Notes
- Kept `src/core/types.ts` and `src/core/eventBus.ts` untouched to avoid merge conflicts with ENEMIES and TOWERS branches.
- Open `Record<string, number>` maps for `enemiesDefeatedByType` and `towersBuiltByType` ensure new enemy/tower types added tonight work seamlessly without schema changes.
- `skyhold_isles_progress_v1` is never deleted and stays mirrored whenever v2 saves, guaranteeing safe rollback or parallel reads.

---

## Next Steps (If Further Work Is Needed Post-Merge)
- Wire the UI components listed above onto `GameSession`'s typed meta API after merging the mobile/UI branch.
- Re-verify `getChallengesForLevel` if ENEMIES adds Islands 10+ (fallback challenges work out of the box, and bespoke challenges can optionally be added to `CHALLENGES_BY_LEVEL_ID`).
