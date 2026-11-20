# PROGRESS — skyhold-n2-agy (QA, Robustness, Platform)

- **Branch:** `hermes/skyhold-n2-agy` (base: `art-2d` @ `59921e7`)
- **Started:** 2026-11-19 ~23:43 UTC (02:43 TR) · **Deadline:** 10:00 TR (07:00 UTC)
- **Strict Ownership:**
  - **Ours:** `src/sim/heroSystem.ts`, `src/sim/soldierSystem.ts`, `src/sim/abilitySystem.ts`, `src/sim/waveSystem.ts`, `src/sim/world.ts` *(non-content parts)*, `src/core/**`, `src/platform/**`, `src/render2d/ui/progress2d.ts`, `src/render2d/ui/modes2d.ts`, `src/render2d/heroes2d.ts` *(logic only)*, `desktop/**`, `qa/bot/**`, `scripts/heroBalance.ts`, `scripts/qa*`, `tests/**`, `docs/overnight*/PROGRESS-skyhold-n2-agy.md`.
  - **Untouched:** `src/data/towers.ts`, `src/data/enemies.ts`, `src/data/levels2d/**`, `src/data/difficulty.ts`, `scripts/balanceSim.ts`, `scripts/difficultySim.ts`, any visual UI/render file, `src/i18n/**`, art.

---

## Done

- [x] **1. QA Bot Sweep on Everything New (`qa/bot/**`, `src/sim/{waveSystem,heroSystem}.ts`, `src/platform/{storage,saveCode}.ts`, `src/render2d/ui/progress2d.ts`, `tests/sim/qaSweepN2.test.ts`)**
  - **Expanded Headless QA Suite (`npm run qa:bot`):** **656/656 scenarios passed (`0` invariant violations)** across **19,970,369 sim ticks**, **28 full determinism replays**, **1,012 hero deaths / 962 hero respawns**, and **mid-progress campaign save sweep**:
    - `difficulty` (**82/82**): `Easy` × all 25 islands, `Normal` × all 25 islands, `Hard` × all 25 islands (including `0`-starting-gold openings on `l1c`/`i16` and boss `i24`), plus `Hard + Challenge` combinations (`bowless`, `ironTide`, `glassSanctuary`, `silentSkies`) across Ch1 & Ch2 islands.
    - `hero` (**387/387**): all 5 heroes (`bran`, `wren`, `mira`, `tobb`, `sela`) at L1/L10/L20 across 6 park modes (`merge`, `front`, `altLane`, `castle`, `roam`, plus new contested front-gate `gateContest` rally stress forcing repeated combat deaths, enemy-occupied retreat resolution, Hard `×1.25` respawn scaling, and `1.5 s` post-respawn invulnerability).
    - **Dual-Engine Replay Determinism (28 pairs):** Every `verifyDeterminism` run verifies scratch re-execution (`stateHash`, `ticks`, `outcome`, per-wave `waveHashes`), `SimReplayPlayer` (`serializeSimReplay` -> `parseSimReplay` + forward/backward `seekToTick` timeline scrubbing + `runToEnd()`), AND the 2D UI's `RunRecorder` + `ReplayCursor` (`src/render2d/ui/replay2d.ts`) to bit-exact 64-bit `hashWorldState` parity.
    - `daily` (**33/33**) & `endless` (**29/29**): Daily Squall across Ch1 + full-25-island Ch2 pools, plus 10 endless waves on all 25 islands and `startEndlessFromWave1` on `l1c`, `i04`, `i17`, `i24`.
    - **Mid-Progress Campaign Save/Load Sweep (`qa/bot/saveSweep.ts`):** Simulates `l1c` -> `i24` progression across Easy/Normal/Hard, Workshop purchases, hero unlocks/XP/skills/respec, `SKY2-...` save-code round-trips, 17→25 Chapter-Two island remapping, and Steam Cloud conflict hydration (`hydrateProgress2DFromCloud`).
  - **Logic Bugs Found & Fixed in Owned Area:**
    1. **Chapter-Two Endless Spotlights Missing (`src/sim/waveSystem.ts`):** `buildEndlessWaveDef` previously spawned only Chapter-One spotlight enemies on Chapter-Two islands (`i17`–`i24`) once past wave 14. Added `ENDLESS_CHAPTER2_SPOTLIGHTS`, `ENDLESS_SPOTLIGHT_TUNING` entries for `bellrunner`, `kilnback`, `reedpiper`, and `draftwing`, and WeakMap-cached `hasChapterTwoEnemies(level)` so Chapter-Two Endless waves cycle all 4 Chapter-Two archetypes (within `BALANCE.pools.maxEnemies = 360` up to wave 500+) while keeping 3D L1–L16 and Chapter-One `l1c`–`i16` 100% unchanged.
    2. **Partial/Corrupted Save `bestStars` & `clears` Recovery from `difficultyWins` (`src/platform/storage.ts`, `src/platform/saveCode.ts`):** `migrateProgress` and `mergeProgress` now reconcile `bestStars[i] >= max(easy[i], normal[i], hard[i])` before `clears[i]`, frontier walk, hero unlock checks, and `starWallet` affordability; `hasAnyProgress` checks `difficultyWins`; `decodeSaveCode` caps `levelIds` (`r.i`) at `512` entries.
    3. **Silent Hard-Ribbon Merge Summaries (`src/platform/saveCode.ts`):** `describeMergeGain` previously reported `"nothing new"` when importing a save that added Hard ribbons (`difficultyWins.hard`) without raising `bestStars` totals; now reports `+N Hard ribbon(s)` / `difficulty records`.
    4. **`recordWin2D` Difficulty Parity & Non-Clobbering Import Backups (`src/render2d/ui/progress2d.ts`, `src/platform/storage.ts`):** Added optional `difficulty` parameter to `recordWin2D` matching `applyRunResult2D` (Easy 1★ cap, no Easy challenge badges, preserved `bestLives`), and prevented `importSaveCode2D` / `backupProgressBeforeImport` from clobbering an existing real backup when the current save is empty.
    5. **Closure Elimination (`src/sim/heroSystem.ts`, `src/sim/waveSystem.ts`):** Removed per-call `mkSkill` closure in `HeroSystem.getRuntimeState` (called every HUD frame) and inter-wave `onAwardGold` wrapper closure in `WaveSystem.update`.

---

## In Progress

- [ ] **2. Steam Achievements Refresh (`desktop/achievements.json`, `src/platform/achievements.ts`)**

---

## Next (in order)

1. **Steam achievements refresh** (`desktop/achievements.json`, `src/platform/achievements.ts`): cover chapter two, each hero to level 10/20, Hard wins, boss `i24`, all islands 3★, endless milestones, daily streaks — data-driven from progress; unit tests; keep IDs stable for existing 28 achievements.
2. **Save robustness v2**: export/import save code covers heroes, difficulty records, Workshop; cloud merge (desktop) conflict rules tested; corrupted/partial save recovery; version migration fuzz.
3. **Performance on low-end**: headless bench (`qa/p6-bench.mjs`) on `i16` and `i24` boss at Hard with heroes + abilities spam; no frame > 100 ms after first wave, no per-tick allocations in owned sim paths; report in PROGRESS.
4. **Desktop build sanity**: Linux AppImage still builds and launches (`npm run desktop:build:linux`, Xvfb smoke) with the current game; fix packaging issues.

---

## Decisions

- **Chapter-Two Endless Spotlights Scoped to Chapter-Two Islands (`i17`–`i24`):** `hasChapterTwoEnemies(level)` activates `ENDLESS_CHAPTER2_SPOTLIGHTS` only on islands whose story waves introduce Chapter-Two enemies (`i17`–`i24`). This keeps Chapter-One Endless runs free of unencountered Chapter-Two Bestiary spoilers and preserves 100% byte-identical outputs on `sim:balance`, `i16` `p6-bench`, and 3D `LEVELS`.
- **Dual PROGRESS Path Mirroring:** Runner header specifies `docs/overnight/PROGRESS-skyhold-n2-agy.md` while task body mentions `docs/overnight2/PROGRESS-skyhold-n2-agy.md`; keeping both identical avoids any path mismatch.

---

## Problems / Known Issues

- None blocking in owned area (`sim:balance` 41/41 byte-identical, `qa:bot` 656/656 passing).
- Note for Step 5 (`desktop/main.cjs`, owned by us): `SKYHOLD_SMOKE_TEST=1` currently polls `window.__p0.artcheck()`, which only mounts on gameplay scenes (`?level=...`), whereas `2d.html` with no query now boots the World Map (`mountWorldMap`). Will fix in `desktop/main.cjs` during Step 5 so both World Map and gameplay smoke launches pass cleanly.

---

## Requests for Other Agents

1. **Opus (`src/render2d/heroLayer.ts:628-630`):** While `hero.state === 'dead'`, `HeroLayer.drawBars` still draws the respawn countdown ring at `(h.spawnX, h.spawnZ)` (the castle gate), even though heroes now respawn at their rally point or castle-side chokepoint (`h.hasRallyPoint ? { x: h.rallyX, z: h.rallyZ } : world.heroSystem.getFallbackRespawnPoint()`), and `h.invulnTimer > 0` (`1.5 s` post-respawn immunity) is available if you want a brief shield/alpha shimmer.
2. **Opus (`src/render2d/main2d.ts:258,481,682`):** `heroSelection = resolveHeroForRun(...)` is computed once at page load; if a player levels up a hero on Victory/Defeat (`recordRunOutcome` writes new XP to `localStorage`) and clicks **Retry** / **Restart** without returning to the World Map, `game.newRun()` re-uses the pre-run `hooks.hero` level instead of re-reading `resolveHeroForRun(loadProgress2D(), ...)` (note: keep `hooks.hero` snapshot unchanged when `replay` is passed to `newRun(replay)` so Watch Replay stays deterministic!).
