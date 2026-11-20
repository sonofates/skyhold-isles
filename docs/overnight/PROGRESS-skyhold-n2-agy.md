# PROGRESS — skyhold-n2-agy (QA, Robustness, Platform)

- **Branch:** `hermes/skyhold-n2-agy` (base: `art-2d` @ `59921e7`)
- **Started:** 2026-11-19 ~23:43 UTC (02:43 TR) · **Deadline:** 10:00 TR (07:00 UTC)
- **Strict Ownership:**
  - **Ours:** `src/sim/heroSystem.ts`, `src/sim/soldierSystem.ts`, `src/sim/abilitySystem.ts`, `src/sim/waveSystem.ts`, `src/sim/world.ts` *(non-content parts)*, `src/core/**`, `src/platform/**`, `src/render2d/ui/progress2d.ts`, `src/render2d/ui/modes2d.ts`, `src/render2d/heroes2d.ts` *(logic only)*, `desktop/**`, `qa/bot/**`, `scripts/heroBalance.ts`, `scripts/qa*`, `tests/**`, `docs/overnight*/PROGRESS-skyhold-n2-agy.md`.
  - **Untouched:** `src/data/towers.ts`, `src/data/enemies.ts`, `src/data/levels2d/**`, `src/data/difficulty.ts`, `scripts/balanceSim.ts`, `scripts/difficultySim.ts`, any visual UI/render file, `src/i18n/**`, art.

---

## Done

- [x] **1. QA Bot Sweep on Everything New (`qa/bot/**`, `src/sim/{waveSystem,heroSystem}.ts`, `src/platform/{storage,saveCode}.ts`, `src/render2d/ui/progress2d.ts`, `tests/sim/qaSweepN2.test.ts`)** — commit `2009ebd`
  - **Expanded Headless QA Suite (`npm run qa:bot`):** **656/656 scenarios passed (`0` invariant violations)** across **19,970,369 sim ticks**, **28 full determinism replays**, **1,012 hero deaths / 962 hero respawns**, and **mid-progress campaign save sweep** (`difficulty` 82/82, `hero` 387/387, `daily` 33/33, `endless` 29/29, `challenge`, `abilities`, `greedy`, `weak`).
  - Fixed Chapter-Two Endless spotlight omission (`ENDLESS_CHAPTER2_SPOTLIGHTS` + tuning for `bellrunner`/`kilnback`/`reedpiper`/`draftwing`), partial-save `bestStars` recovery from `difficultyWins`, Hard-ribbon summaries in `describeMergeGain`, `recordWin2D` difficulty parity, non-clobbering import backups, and closures in `HeroSystem.getRuntimeState` / `WaveSystem.update`.

- [x] **2. Steam Achievements Refresh (`desktop/achievements.json`, `src/platform/achievements.ts`, `src/platform/index.ts`, `tests/platform/steamAdapter.test.ts`)** — commit `c97c63d`
  - Preserved all **28** original Steam achievement IDs verbatim at indices `0..27` and expanded the catalog to **58** data-driven achievements synced 1-to-1 with `desktop/achievements.json`: Chapter Two (`CHAPTER_TWO_LANDING`, `CHAPTER_TWO_CLEARED`, `CHAPTER_TWO_THREE_STARS`), Boss `i24` (`BOSS_I24_CLEARED`), all 25 islands 3★ (`STARS_ALL_25_ISLANDS`), all 5 heroes L10 & L20 + full roster (`HERO_ALL_ROSTER`, `HERO_*_LV10`, `HERO_*_LV20`, `HERO_ALL_LV20`), Hard ribbons (`HARD_FIRST_RIBBON`, `HARD_FIVE_RIBBONS`, `HARD_TEN_RIBBONS`, `HARD_BOSS_I24`, `HARD_ALL_ISLANDS`), Endless milestones (`ENDLESS_BRONZE_MEDAL`, `ENDLESS_SILVER_MEDAL`, `ENDLESS_DEEP_20`, `ENDLESS_FIVE_GOLDS`), and Daily Squall streaks (`DAILY_FIRST_WIN`, `DAILY_STREAK_7`, `DAILY_STREAK_14`, `DAILY_TOTAL_20`).

- [x] **3. Save Robustness v2 (`src/platform/{storage,saveCode,cloudSync,index}.ts`, `src/render2d/ui/progress2d.ts`, `tests/platform/{robustnessFuzz,saveRobustnessV2}.test.ts`)**
  - **Export / Import Save Code Hardening:**
    - `encodeSaveCode` / `decodeSaveCode` / `encodeSaveCode2D` / `decodeSaveCode2D` / `importSaveCode2D` sanitize non-finite fields, accept both compact (`{ e, n, h }`, `{ s, r }`) and full (`{ easy, normal, hard }`, `{ selectedHero, roster }`) difficulty/hero payloads, guard non-string and oversized (`> 256 KB`) inputs, and return `summary: describeMergeGain(previous, merged)` on `ImportSaveCode2DResult`.
    - Added `inspectSaveCodeHints` + full-source sizing in `decodeSaveCode2D` / `importSaveCode2D` / `remapProgress` so truncated `levelIds` or retired islands never prematurely refund legitimate Workshop upgrades or drop unlocked `selectedHero` choices when merged, while still blocking cheated Workshop ranks that exceed the source save's own earned stars.
    - Bidirectional `bestStars` ↔ `difficultyWins` reconciliation in `migrateProgress`, `mergeProgress`, and `encodeSaveCode` guarantees `max(easy[i], normal[i], hard[i]) === bestStars[i]` across all partial/legacy/merged saves.
  - **Desktop Steam Cloud Conflict Rules (`hydrateProgressFromCloud`, `hydrateProgress2DFromCloud`, `mergeProgress`):**
    - When two genuine affordable cross-device saves spend the same star pool on different Workshop branches such that their union overspends `starWallet(merged).earned`, `mergeProgress` now keeps all of `primaryWorkshop` and deterministically tops up affordable rank steps from `secondaryWorkshop` in canonical `WORKSHOP_UPGRADES` order (strictly commutative & idempotent, zero unspent star loss).
    - Hardened `hydrateProgressFromCloud` and `hydrateProgress2DFromCloud` against throwing `cloudSave.read` / `cloudSave.write` adapters (never rejects, never overwrites remote Steam Cloud on transient `read` failure) and added truncated-JSON cloud blob salvage that merges surviving cloud progress before writing healed JSON back.
  - **Corrupted / Partial Save Recovery:**
    - Added bounded zero-regex `tryRepairTruncatedJson` in `src/platform/storage.ts` to salvage power-loss / quota-truncated JSON objects in `loadProgress`, `loadProgress2D`, `hydrateProgressFromCloud`, and `hydrateProgress2DFromCloud`, preserving forensic copies once in `PROGRESS_CORRUPT_BACKUP_KEY` / `PROGRESS_2D_CORRUPT_BACKUP_KEY`.
    - `loadProgress2D` handles double-encoded `Stored2D` wrappers and automatically recovers/merges from the local cloud mirror (`skyhold_isles_cloud_progress2d`) if `PROGRESS_2D_KEY` is corrupted; added explicit multi-source `recoverProgress2D` and `recoverProgressSave` helpers covering `primary`, `cloud`, `importBackup`, `migrationBackup`, `corruptBackup`, and optional `resetBackup`.
  - **Version Migration & Algebraic Fuzzing:** Expanded `tests/platform/robustnessFuzz.test.ts` (500 cases incl. `difficultyWins` & 25-island invariants) and added `tests/platform/saveRobustnessV2.test.ts` (300 cross-version `v0`/`v1`/`v2`/`v3`/`v99` 25-island migration + save-code round-trip + commutativity/idempotence/monotonicity fuzz cases, 150 bit-flipped/truncated save codes, and systematic byte-slice JSON truncation recovery sweep).

---

## In Progress

- [ ] **4. Performance on Low-End (`qa/p6-bench.mjs`, `scripts/qaLowEndBench.mjs`, owned `src/sim/**` allocation audit & tests)**

---

## Next (in order)

1. **Performance on low-end**: headless bench (`qa/p6-bench.mjs`) on `i16` and `i24` boss at Hard with heroes + abilities spam; no frame > 100 ms after first wave, no per-tick allocations in owned sim paths; report in PROGRESS.
2. **Desktop build sanity**: Linux AppImage still builds and launches (`npm run desktop:build:linux`, Xvfb smoke) with the current game; fix packaging issues.

---

## Decisions

- **Chapter-Two Endless Spotlights Scoped to Chapter-Two Islands (`i17`–`i24`):** `hasChapterTwoEnemies(level)` activates `ENDLESS_CHAPTER2_SPOTLIGHTS` only on islands whose story waves introduce Chapter-Two enemies (`i17`–`i24`), keeping Chapter-One Endless free of unencountered Bestiary spoilers and preserving 100% byte-identical outputs on `sim:balance`, `i16` `p6-bench`, and 3D `LEVELS`.
- **3D Bundle Isolation in `src/platform/achievements.ts`:** `achievements.ts` inspects `levels` passed by the caller rather than statically importing `LEVELS_2D`, keeping 25 island layouts out of the 3D chunk.
- **Non-Destructive Corrupt Save Handling:** `loadProgress` / `loadProgress2D` preserve raw corrupted JSON once under `*_corrupt_backup*`, salvage truncated JSON prefixes when `hasAnyProgress` holds, and never auto-read `*_reset_backup*` (which represents an intentional user reset) unless explicitly requested via `recoverProgress2D(..., { includeResetBackup: true })`.
- **Dual PROGRESS Path Mirroring:** Both `docs/overnight/PROGRESS-skyhold-n2-agy.md` and `docs/overnight2/PROGRESS-skyhold-n2-agy.md` are maintained identically.

---

## Problems / Known Issues

- None blocking in owned area (`sim:balance` 41/41 byte-identical, `qa:bot` 656/656 passing, 1,357 unit tests passing).
- Note for Step 5 (`desktop/main.cjs`, owned by us): `SKYHOLD_SMOKE_TEST=1` currently polls `window.__p0.artcheck()`, which only mounts on gameplay scenes (`?level=...`), whereas `2d.html` with no query now boots the World Map (`window.__map`). Will update `desktop/main.cjs` in Step 5 so both World Map and gameplay smoke launches pass cleanly.

---

## Requests for Other Agents

1. **Opus (`src/render2d/heroLayer.ts:628-630`):** While `hero.state === 'dead'`, `HeroLayer.drawBars` still draws the respawn countdown ring at `(h.spawnX, h.spawnZ)` (the castle gate), even though heroes now respawn at their rally point or castle-side chokepoint (`h.hasRallyPoint ? { x: h.rallyX, z: h.rallyZ } : world.heroSystem.getFallbackRespawnPoint()`), and `h.invulnTimer > 0` (`1.5 s` post-respawn immunity) is available if you want a brief shield/alpha shimmer.
2. **Opus (`src/render2d/main2d.ts:258,481,682`):** `heroSelection = resolveHeroForRun(...)` is computed once at page load; if a player levels up a hero on Victory/Defeat (`recordRunOutcome` writes new XP to `localStorage`) and clicks **Retry** / **Restart** without returning to the World Map, `game.newRun()` re-uses the pre-run `hooks.hero` level instead of re-reading `resolveHeroForRun(loadProgress2D(), ...)` (note: keep `hooks.hero` snapshot unchanged when `replay` is passed to `newRun(replay)` so Watch Replay stays deterministic!).
3. **Opus (`src/render2d/ui/metaScreens.ts:460-517`):** 2D Settings → General currently exposes `resetProgress2D()` but not Copy/Load Save Code buttons yet; `exportSaveCode2D()`, `importSaveCode2D(code)` (which now returns `{ ok, progress, previous, summary }` covering all 5 heroes, Hard ribbons, and Workshop), and `recoverProgress2D()` in `src/render2d/ui/progress2d.ts` are ready to wire whenever you want Save Code UI in 2D Settings.
