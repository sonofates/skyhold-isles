# Handoff — 2D Run Modifiers, Mode Recording & Settings Wiring (`agy-modifiers`)

- **Branch:** `hermes/skyhold-2d-modifiers` (base: `art-2d` @ `48b7da3`)
- **Date:** 2026-11-18
- **Scope:** Backend / logic wiring only (no new visual screens, CSS, art, or layout; `src/data/levels2d/**` and `tools/map-compose/**` untouched).

---

## 1. What Was Built

### A. `Game2D` Modifier & Endless Mode Wiring (`src/render2d/game2d.ts`, `src/render2d/buildRing.ts`)
- Added `modifiers?: RunModifiers` and `startEndless?: boolean` options to `Game2DHooks` (`Game2D` constructor options).
- `Game2D.newRun()` passes `this.hooks.modifiers ?? NEUTRAL_RUN_MODIFIERS` directly into `new SimWorld(this.level, this.events, ...)` and calls `this.world.startEndlessFromStart()` when `startEndless` is true (preserving modifiers and Endless mode across **Retry**).
- `Game2D` scales the horn's displayed early-call bonus by `world.mods.waveBonusMul`, computes free-plot affordability `minCost` across non-banned towers, and passes `world.mods.bannedTowers` to `BuildRing.openBuild(...)` so banned towers appear disabled with `'Off-limits in this challenge'` in the existing tooltip (using existing disabled token visuals, no layout/CSS changes).

### B. URL Query Parsing, 3D Composition Reuse & Save Recording (`src/render2d/ui/modes2d.ts`, `src/render2d/ui/progress2d.ts`, `src/render2d/ui/inGame.ts`, `src/render2d/main2d.ts`)
- **`composeRunModifiers2D(workshop, challenges)`** reuses `runModifiersFor(workshopModifiers(workshop), challenges)` from `src/data/challenges.ts` and `src/data/workshop.ts` directly — zero forked math.
- **`resolveQueryRun2D(q, progress, opts)`** in `src/render2d/ui/modes2d.ts` (wired in `main2d.ts`):
  - Reads Workshop upgrade ranks from `loadProgress2D()` (`skyhold_isles_progress2d_v1`) during normal play; debug/QA scenes (`?bench=`, `?zoo=`, `?towers=`, `?melee=`, `?autoplay=`, `?end=`) keep `NEUTRAL_RUN_MODIFIERS` unless explicit challenge params are given.
  - Supports `?level=<id>` deep links plus `?challenge=<id>` (repeatable or comma-separated), `?daily=1` (with or without `?level=`), and `?endless=1`.
  - Validates island IDs against `getLevelById` and challenge IDs against `CHALLENGES` (`isChallengeId`); unknown IDs/values are ignored with `console.warn`.
- **Results recording in `progress2d.ts`** (keeping `PROGRESS_2D_KEY = 'skyhold_isles_progress2d_v1'` and `ProgressData` v2 migration + `remapProgress` id-remapping):
  - `recordWin2D` / `applyRunResult2D` / `recordRunResult2D`:
    - **Challenge wins:** filters active challenges with `badgesForWin(challengesForLevel(level), challenges)` and passes them to `applyWin`, crediting per-island `challengeClears` (+1 Workshop ★ each) and island mastery (`isIslandMastered`).
    - **Daily Squall wins:** records `applyDailyWin(progress.daily, day, utcDayNumber(nowMs))` (once per UTC day, streak + bestStreak + total +1 Workshop ★, yesterday midnight grace, future-clock repair) alongside the island clear.
    - **Endless runs:** records `applyEndlessRecord(progress, levelIndex, waveReached)` via `recordEndless2D` once past the island's story waves (`waveReached > level.waves.length`), both on defeat and if leaving to the World Map mid-run; never awards campaign stars on an Endless run.
    - **Losses** on non-Endless runs do not mutate saved progress.
  - Added `bestEndlessWave` and `challengeClears` to `IslandState` returned by `islandStates()`.

### C. Pure UI Helpers & Daily Squall Button Enablement (`src/render2d/ui/modes2d.ts`, `src/render2d/ui/metaScreens.ts`)
- Exported pure helpers in `src/render2d/ui/modes2d.ts`:
  - `availableChallenges(levelId, progress, levels?)` → `AvailableChallenge2D[]` (`[]` before first clear, else the island's offered `ChallengeDef` pair with `completed: boolean`).
  - `dailyForToday(date, progress?, levels?)` → `Daily2D | null` (deterministic UTC-day selection via `utcDayNumber` + `dailyChallengeFor`; filters to cleared islands when `progress` is supplied, or selects deterministically across `levels` when omitted).
  - `canPlayEndless(levelId, progress, levels?)` → `boolean` (`true` once the island has at least one clear).
  - `buildRunHref2D(levelId, opts)` / `dailyHref2D(levelId)` → URL builders for briefing / Daily actions.
- Enabled the existing **Set sail** button (`[data-testid="daily2d-start"]`) in `openDaily` (`src/render2d/ui/metaScreens.ts`) to navigate to `dailyHref2D(level.id)` (`?level=<id>&daily=1`) instead of being disabled (no restyling).

### D. Shared Settings Gating (`src/render2d/settings2d.ts`, `src/render2d/damageNumbers2d.ts`, `src/render2d/game2d.ts`)
- **Audio (`audioSettings2d`):** 2D currently has no WebAudio/music playback wired in `render2d`. Wired shared `GameSettings` (`masterVolume`, `muted` from `platform/storage`) and `musicVolume` (`audio/musicPrefs`) into a single pure-testable `audioSettings2d()` getter (exported from `src/render2d/settings2d.ts`, re-exported from `src/render2d/ui/modes2d.ts`, and exposed on `Game2D.audioSettings`).
- **Screen shake (`cameraShake`):** Implemented pure damped view-shake state (`triggerShake2D`, `stepShake2D`, matching 3D `CameraController` decay & cooldown) applied to `map.root.position` on cannon/mortar/ballista shots, mortar impacts, Tesla overloads, meteor impacts, boss phases, and boss deaths; strictly gated by `settings.cameraShake` (and skipped in `bench`/`zoo`/`towers`/`melee` QA scenes).
- **Floating damage numbers (`damageNumbers`):** Implemented pure pooled hit-number state (`spawnDamageNumber2D`, `stepDamageNumbers2D`, merging hits on the same foe within `BALANCE.floatingTextMergeWindowSec` = 150 ms and flagging heavy hits at `>= 55` or boss, matching 3D `FloatingTextPool`) rendered via pre-allocated `paintedText` sprites in `DamageNumbers2D`; strictly gated by `settings.damageNumbers`.
- **Vibration (`haptics`):** Synced `haptics.setEnabled(shouldVibrate2D(settings, isTouchDevice()))` and bound `bindHaptics(events)` in `Game2D`.

---

## 2. Files Touched

| Category | Files |
|---|---|
| 2D Game & Settings | `src/render2d/game2d.ts`, `src/render2d/buildRing.ts`, `src/render2d/settings2d.ts` *(new)*, `src/render2d/damageNumbers2d.ts` *(new)*, `src/render2d/main2d.ts` |
| 2D Modes & Save Adapter | `src/render2d/ui/modes2d.ts` *(new)*, `src/render2d/ui/progress2d.ts`, `src/render2d/ui/inGame.ts`, `src/render2d/ui/metaScreens.ts` |
| Unit Tests | `tests/render/modifiers2d.test.ts` *(new, 20 tests)* |
| Handoff Doc | `docs/handoff-agy-modifiers.md` *(new)* |

*(Untouched as required: `src/data/levels2d/**`, `tools/map-compose/**`, `src/sim/**`, `src/data/**`, `src/core/**`, `paintedUi.css`.)*

---

## 3. Gate Numbers

| Check | Baseline (`48b7da3`) | Final (`hermes/skyhold-2d-modifiers`) |
|---|---|---|
| `npx tsc --noEmit` | PASS (0 errors) | **PASS (0 errors)** |
| `npm run lint` | PASS (0 errors) | **PASS (0 errors)** |
| `npm test` | 76 files passed (1 skipped) · **945 passed** (11 skipped) | **77 files passed** (1 skipped) · **965 passed** (11 skipped) |
| `npm run sim:balance` | **PASSED — 25/25 levels** (L1–L16 + `l1c` + `i01`–`i08`) | **PASSED — 25/25 levels** (unchanged) |
| `npm run build` | PASS | **PASS** |

---

## 4. What the UI Agent Needs to Add Next

1. **Briefing Card (`src/render2d/ui/briefing.ts` + `src/render2d/ui/worldMap.ts`):**
   - Call `availableChallenges(st.level.id, progress)` from `src/render2d/ui/modes2d.ts`:
     - When non-empty (`st.clears > 0`), render toggle switches for the two island challenges showing `name`, `description`, `bannedIcon` (if any), and `completed` badge (`Earned` vs `+1★`).
   - Call `canPlayEndless(st.level.id, progress)` from `src/render2d/ui/modes2d.ts`:
     - When `true`, render a **Campaign / Endless** mode switch (or an **Endless** start button) plus `st.bestEndlessWave` record (`Wave N` / medal tier via `endlessTier(st.bestEndlessWave, st.level.waves.length)`).
     - Note: Endless runs ignore challenge toggles (`buildRunHref2D(st.level.id, { endless: true })`).
   - Build the launch URL with `buildRunHref2D(st.level.id, { challenges, endless, intro: st.clears === 0 })`.
2. **Logbook (`src/render2d/ui/metaScreens.ts` → `openLogbook`):**
   - Optional: display per-island completed challenge badges (`p.challengeClears[i]`) and `p.bestEndlessWaves[i]` on island ledger rows now that both are recorded in `skyhold_isles_progress2d_v1`.
3. **End Panel (`src/render2d/endPanel.ts` / `main2d.ts`):**
   - Currently `EndPanel` shows campaign stars, lives/wave, and gold. `recordRunOutcome` in `inGame.ts` returns `{ win, daily, endless }`:
     - On challenge wins: call out `win.newChallenges` (`+N★` badge earned) and newly mastered status.
     - On Daily Squall wins: call out `+1★` daily reward, `daily.streak`, and optional share button (`dailyShareText` in `src/game/share.ts`).
     - On Endless defeat: show `endless.best` / `isNewBest` and active mutators (`endlessMutatorsAt`), instead of `Wave X/Y` defeat copy; optionally add a "Continue in Endless" button on normal Victory (`world.enterEndlessMode()`).
4. **In-Game HUD / Pause & Settings (`src/render2d/hud.ts`, `src/render2d/ui/metaScreens.ts`):**
   - Active abilities (`Meteor Strike` and `Overcharge`) have no 2D HUD buttons/aiming yet; once added, check `world.mods.abilitiesDisabled` (`Silent Skies` challenge already blocks `castMeteor` / `castOvercharge` in `SimWorld`).
   - Optional in-game Settings / Pause sheet (calling `game.refreshSettings()` on close) and a separate **Music volume** slider in `openSettings` wired to `getMusicVolume` / `setMusicVolume` (`src/audio/musicPrefs.ts`) — `audioSettings2d()` already reads `getMusicVolume()`.
5. **2D Audio Layer (future P6 audio pass):**
   - When connecting `SoundManager` / 2D audio to `main2d.ts` and `worldMap.ts`, read `audioSettings2d()` (from `src/render2d/settings2d.ts` or `game.audioSettings`) as the single source for `muted`, `masterVolume`, `musicVolume`, `effectiveSfxVolume`, and `effectiveMusicVolume`.

---

## 5. Doubts / Notes & Open Questions for the Owner

1. **Hand-picked challenge pairs for 2D island IDs (`l1c`, `i01`–`i08`):**
   - `ISLAND_CHALLENGES` in `src/data/challenges.ts` is keyed by the 3D campaign slugs (`sunlit-meadow`, `twin-bridge-cay`, …) and guarded by a test in `tests/game/challenges.test.ts` asserting every key in `ISLAND_CHALLENGES` belongs to `LEVELS`. Consequently, `challengesForLevel` on `LEVELS_2D` (`l1c`, `i01`–`i08`) currently uses `DEFAULT_BY_DIFFICULTY` (consistent across `modes2d.ts`, `progress2d.ts` mastery, and `metaScreens.ts` Logbook).
   - **Question for owner:** When `i01`–`i16` replace `LEVELS`, should `i01`–`i08` inherit their source 3D island's `ISLAND_CHALLENGES` pair (e.g. `i02` → `['quietGuns', 'galeForce']` instead of the `Challenging` default `['thaw', 'galeForce']`), or get freshly swept pairs for the plot layouts (especially a `noBarracks` ban)?
2. **`Silent Skies` (`abilitiesDisabled`) before 2D ability HUD lands:**
   - `SimWorld` enforces `abilitiesDisabled` today, but since 2D HUD does not yet expose Meteor Strike / Overcharge buttons, `Silent Skies` is effectively a free badge in 2D until active-ability buttons are added to the 2D HUD. Should `Silent Skies` remain in the 2D pool meanwhile or wait for 2D ability controls?
3. **2D Audio wiring:**
   - Should `SoundManager` (procedural WebAudio SFX + `MusicEngine` from `src/audio/soundManager.ts`) be connected directly to `Game2D` / `worldMap.ts` using `audioSettings2d()`, or is a new sample-based 2D sound layer planned for P6?
