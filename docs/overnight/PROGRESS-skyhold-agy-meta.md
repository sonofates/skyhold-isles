# Overnight Progress — META (`hermes/skyhold-agy-meta`)

## Status Overview
Core meta-progression, replayability, and persistence architecture is implemented, verified, and passing all checks (`tsc --noEmit`, `npm run lint`, `npm test` — 72/72 tests across 12 files, `npm run build`, `npm run sim:balance`).

---

## Completed
1. **Per-Island Optional Challenges (`src/data/challenges.ts`, `src/sim/meta/runObserver.ts`)**
   - Added 27 hand-crafted optional challenges (3 per island for Islands 1–9), keyed by `level.id` (`CHALLENGES_BY_LEVEL_ID`), awarding Challenge Stars tracked separately from normal 3-star campaign ratings.
   - Tested all 27 challenges across Islands 1–9 against `SimWorld` to verify winnability.
   - Added deterministic `getChallengesForLevel(level)` fallback generator keyed by `level.id` so new islands (10+) added by ENEMIES/ISLANDS automatically get 3 balanced, persistable challenges without touching `challenges.ts`.
   - `RunObserver` observes `EventBus` purely without modifying `EnemySystem` or `WaveSystem`, rejects debug-skipped (`debugSkipToWave`) or debug-forced (`debugForceWin`) runs from unlocking challenges, and prevents sell-rebuild cheese on `maxTowersBuilt` / `maxGoldSpent`.

2. **Achievements & Lifetime Stats (`src/data/challenges.ts`, `src/sim/meta/metaEngine.ts`, `src/platform/metaSession.ts`)**
   - Added 22 achievements across `campaign`, `combat`, `economy`, `mastery`, and `endless` categories with progress counters (`current`, `target`, `progressRatio`).
   - Added `LifetimeStats` tracking `totalPlayTimeSec`, `gamesPlayed`, `gamesWon`, `gamesLost`, `wavesCleared`, `earlyWavesCalled`, `enemiesDefeatedTotal`, `enemiesDefeatedByType` (open `Record<string, number>` so future enemy types count automatically), `flyingEnemiesDefeated`, `towersBuiltTotal`, `towersBuiltByType` (open `Record<string, number>`), `towersUpgradedTotal`, `towersUpgradedToTier3`, `towersSoldTotal`, `goldEarnedTotal`, `goldSpentTotal`, `abilitiesCastTotal`, `meteorsCast`, `overchargesCast`, `towersCleansed`, `perfectClears`, `bestEndlessWaveOverall`, `dailyChallengesCompleted`.
   - Incremental delta flushing on `waveCompleted` / `endlessEntered` / `gameWon` / `gameLost` / `endRun` ensures stats persist mid-run without double-counting.

3. **Versioned Save Persistence & v1 Migration (`src/platform/storage.ts`, `src/sim/meta/metaEngine.ts`)**
   - Introduced versioned `MetaSaveData` (`version: 2`, key `skyhold_isles_meta_v2`) alongside `skyhold_isles_progress_v1`.
   - `migrateToMetaSave` / `loadMetaSave` transparently migrates existing `skyhold_isles_progress_v1` saves (`unlockedLevelIndex`, `bestStars`, `bestEndlessWaves`), merges monotonically with `Math.max` so neither v1 nor v2 ever wipes progress, handles corrupt/partial JSON, expands arrays cleanly when new islands are added, and retroactively grants implied achievements (`first_victory`, `endless_survivor`, etc.).

4. **Endless Mutators (`src/data/challenges.ts`, `src/sim/meta/mutators.ts`, `src/sim/meta/modifiers.ts`)**
   - Added 8 mutators (`swift_march`, `iron_clad`, `sky_swarm`, `gold_drought`, `titan_tide`, `tight_budget`, `no_frost`, `no_tesla`) with conflict-group guards so seeded rolls never pair conflicting economy squeezes or stack anti-air bans with `sky_swarm`.
   - `selectEndlessMutators(seed, count)` accepts integer or string seeds and returns deterministic mutators, merged `RunModifiers`, and `scoreMultiplier`.
   - `computeEndlessScore(wavesClearedInEndless, enemiesKilled, scoreMultiplier)` calculates Endless scores.

5. **Daily Challenge (`src/sim/meta/daily.ts`)**
   - Pure function `generateDailyChallenge(dateStr, levels?)` seeded by strict calendar `YYYY-MM-DD` string (verified with `isValidDateString`, including leap years).
   - Deterministically picks island, 1–2 compatible mutators, and tower restriction (`none`, `ban_one`, `limited_arsenal`) while guaranteeing at least 1 anti-air tower (`hitsFlyers`) remains available.
   - Daily completions record `dailyBestScores` and `daily_victor` without prematurely unlocking locked campaign islands.

6. **Tests (`tests/sim/metaChallenges.test.ts`, `tests/sim/metaMutatorsAndDaily.test.ts`, `tests/sim/metaSaveAndStats.test.ts`)**
   - Added 20 new tests covering challenge evaluation, anti-cheat/anti-sell-cheese, Island 1 6-tower 3x flawless clear, fallback challenges for Islands 10+, mutator determinism & SimWorld physics/economy integration, daily challenge determinism & anti-air invariant, v1->v2 save migration, and MetaSession lifecycle.

---

## Cross-Area Changes (Minimal & Documented)
- `src/sim/world.ts`:
  - Added optional 3rd constructor parameter `modifiers?: RunModifiers | null` (defaults to neutral; existing 2-arg callers and `balanceSim.ts` are untouched).
  - Enforces tower bans (`isTowerTypeAllowed`), tower cost scaling (`scaleGoldCost`), gold reward scaling (`scaleGoldReward`), enemy HP/speed/armor scaling (`spawnConfiguredEnemy`), story wave flyer scaling (`applyModifiersToLevel`), and staggered endless extra flyers (`pendingExtraFlyers`).
  - `enterEndlessMode(modifiers?: RunModifiers | null)` accepts optional mutator modifiers.
  - Zero edits to `enemySystem.ts`, `waveSystem.ts`, `combatSystem.ts`, `core/types.ts`, `core/eventBus.ts`.
- `src/platform/gameSession.ts`:
  - Thin delegation to new `MetaSession` (`src/platform/metaSession.ts`).
  - Prevents placement ghosting for banned tower types in `setPlacementMode`.
  - Guards `recordWinProgress` on `onGameWon` so Daily Challenge runs don't unlock locked campaign islands.
  - Exposes typed UI API methods directly on `GameSession`.

---

## Typed UI Integration Contract (Ready for Morning UI Wiring)
UI files (`src/ui/**`, `src/style.css`) were not touched. UI can call the following typed methods on `GameSession` (or `session.meta`):
- `session.getChallengeStatus(levelIndex): LevelChallengeStatus | null`
  - Returns `{ levelId, levelIndex, levelName, earnedStars, totalStars, challenges: [{ def, completed }] }`.
- `session.getAllChallengeProgress(): AllChallengeProgress`
  - Returns total challenge stars earned (`earnedStars / totalStars`) and per-island breakdown.
- `session.getAchievements(): readonly AchievementStatus[]`
  - Returns all 22 achievements with `{ def, unlocked, current, target, progressRatio }`.
- `session.getStats(): LifetimeStats`
  - Returns lifetime statistics snapshot for a Career / Stats modal.
- `session.getDailyChallenge(dateStr?): DailyChallengeSpec` & `session.getDailyStatus(dateStr?): DailyStatus`
  - Returns today's daily challenge details (`title`, `summary`, `levelName`, `mutators`, `towerRestriction`, `scoreMultiplier`, `completedToday`, `bestScoreToday`).
- `session.startDailyChallenge(dateStr?): DailyChallengeSpec`
  - Launches today's daily challenge directly into `playing` view.
- `session.rollEndlessMutators(seed?, count?): EndlessMutatorRoll` & `session.enterEndlessMode(seedOrModifiers)`
  - Lets Outcome modal / Endless setup preview mutators + score multiplier and launch mutated Endless runs.
- `session.getLastRunMetaOutcome(): RunMetaOutcome | null`
  - Populated immediately on `gameWon` / `gameLost` with `{ won, isDaily, newlyCompletedChallengeIds, newlyUnlockedAchievementIds, endlessScore, dailyScore }` for Outcome modal celebration badges.

### UI Needs for Lead / UI Team
1. **Level Select cards**: Display Challenge Stars (`earnedStars / totalStars`, distinct badge/color from normal 3★) + hover/expandable challenge checklist per island.
2. **Main Menu / Daily Card**: "Daily Watch" entry showing `getDailyStatus()`, rules summary (`spec.summary`), score multiplier, and launch button (`session.startDailyChallenge()`).
3. **Achievements & Lifetime Stats Modal**: Tabs for Achievements (progress bars using `current / target`) and Stats (`getStats()`).
4. **BuildBar during restricted runs**: Disable/lock tower cards not allowed by `session.simWorld.modifiers` (`isTowerTypeAllowed`).
5. **Outcome Modal**: Show newly completed challenges, newly unlocked achievements (`getLastRunMetaOutcome()`), and Endless Mutator seed selector on "Continue Endless".

---

## Decisions & Notes
- Kept `src/core/types.ts` and `src/core/eventBus.ts` untouched to avoid merge conflicts with ENEMIES and TOWERS branches.
- Open `Record<string, number>` maps for `enemiesDefeatedByType` and `towersBuiltByType` ensure new enemy/tower types added tonight work seamlessly without schema changes.
- `skyhold_isles_progress_v1` is never deleted and stays mirrored whenever v2 saves, guaranteeing safe rollback or parallel reads.

---

## Next Steps (If Time Remains in Overnight Turns)
- Add `getAllowedTowerTypes()` helper on `GameSession` / `MetaSession` and `getDailyStreak()` pure calendar streak calculation.
- Add `formatChallengeProgressHint` / live in-run challenge tracker API (`session.getActiveChallengeStates()`) so the in-game HUD or Pause Menu can show which of the 3 island challenges are still alive vs already failed during the current run!
- Add vitest coverage for live mid-run challenge status tracking and daily calendar streaks.
