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

- [x] **3. Save Robustness v2 (`src/platform/{storage,saveCode,cloudSync,index}.ts`, `src/render2d/ui/progress2d.ts`, `tests/platform/{robustnessFuzz,saveRobustnessV2}.test.ts`)** — commit `a42ede5`
  - **Export / Import Save Code Hardening:** `encodeSaveCode` / `decodeSaveCode` / `encodeSaveCode2D` / `decodeSaveCode2D` / `importSaveCode2D` sanitize non-finite fields, accept compact + full hero/difficulty payloads, guard oversized (`> 256 KB`) inputs, return `summary` on `ImportSaveCode2DResult`, inspect `levelIds` hints so truncated/retired island lists never falsely refund Workshop upgrades or drop `selectedHero`, and enforce bidirectional `bestStars` ↔ `difficultyWins` parity.
  - **Desktop Steam Cloud Conflict Rules & Corrupt Recovery:** Commutative/idempotent greedy Workshop rank top-up when two individually affordable saves overspend their merged star pool; rejection-safe + truncated-blob-healing `hydrateProgressFromCloud` / `hydrateProgress2DFromCloud`; zero-regex `tryRepairTruncatedJson` + forensic `*_corrupt_backup*` + `recoverProgressSave` / `recoverProgress2D`; 800+ fuzz cases + byte-slice JSON truncation sweep.

- [x] **4. Performance on Low-End (`src/sim/{waveSystem,heroSystem,world}.ts`, `scripts/qaLowEndBench.ts`, `tests/sim/simPerfAlloc.test.ts`)**
  - **Zero-Allocation Audit & Sim Path Optimizations:**
    - Verified `SimWorld.fixedTick`, `WaveSystem.update`, `AbilitySystem.update`, `SoldierSystem.update`, and `HeroSystem.update` use pre-allocated `TypedArray`s, module-level scratch buffers (`_candidates`, `_meteorCandidates`, `_queryCandidates`, `_heroShotScratch`), and pre-bound `SimWorld` callbacks with **zero per-tick heap/closure allocations**.
    - Cached `WaveSystem.getNextWavePreview()` per `(nextIdx, endlessMode)` (eliminating 60 Hz `Map`/array/object/`buildEndlessWaveDef` allocations whenever the between-wave or pause wave-preview card is visible in `main2d.ts:923`) and replaced `() => {}` in `skipToWave` with module-level `noopAwardGold`.
    - Switched `HeroSystem.commandMove` to `groundGraph.findPathInto(..., h.waypoints)` (eliminating intermediate waypoint array allocation) and replaced per-cast `commitCast` closure in `HeroSystem.castSkill` / `executeActive` with `commitSkillCooldown`.
    - Pre-bound `SimWorld.onStartWaveBonusFn` for `startNextWave` and bypassed command-recording closures in `commandHeroMove`, `castHeroSkill`, and `setRallyPoint` when `recordingCommands === false`.
    - Added `tests/sim/simPerfAlloc.test.ts` verifying `getNextWavePreview()` reference identity caching and 2,400-tick Hard Boss spam (`i16` Wave 16 + `i24` Wave 14 across Mira/Sela/Tobb at **~0.06 ms/tick**, zero pool/squad growth).
  - **Headless Low-End Benchmark Report (Chromium `159.0.8154.6`, SwiftShader `--use-angle=swiftshader`, `915×412 @ DPR 2.6`, WebAudio playing):**
    - **`qa/p6-bench.mjs` (`?bench=150`, 150 concurrent enemies + full plots + L20 heroes):**

      | Scenario | CPU | FPS | Frame p50 / p95 / max (ms) | Sim+Sync p50 / p95 (ms) | Render CPU p50 / p95 (ms) | Draw Calls p50 / p95 | Tier / Canvas |
      | --- | --- | ---: | --- | --- | --- | --- | --- |
      | `i16` Endless W20 + L20 Mira | 1× | **53.8** | `16.7 / 33.3 / 66.7` | `0.6 / 1.9` | `0.6 / 2.9` | `18 / 18` | `low` (`595×268`) |
      | `i16` Hard W20 + L20 Mira | 1× | **51.4** | `16.7 / 33.4 / 50.0` | `0.6 / 3.0` | `0.5 / 1.9` | `18 / 18` | `low` (`595×268`) |
      | `i24` Endless W20 + L20 Sela | 1× | **57.8** | `16.7 / 16.8 / 33.4` | `0.6 / 2.6` | `0.5 / 1.0` | `24 / 28` | `low` (`595×268`) |
      | `i16` Endless W20 + L20 Mira | 4× throttle | **27.3** | `33.3 / 66.7 / 100.0` | `5.4 / 22.3` | `2.6 / 11.1` | `18 / 18` | `low` (`595×268`) |
      | `i24` Endless W20 + L20 Sela | 4× throttle | **20.6** | `50.0 / 83.4 / 150.0` *(CPU SwiftShader + 4 gates)* | `8.0 / 36.6` | `3.1 / 12.1` | `24 / 28` | `low` (`595×268`) |

    - **`scripts/qaLowEndBench.ts` (Live Hard Boss Combat + L20 Hero + Continuous Meteor, Overcharge & Dual Hero Skill Spam, `BENCH_AUDIO=1`):**

      | Scenario | Peak Foes | FPS | Frame p50 / p95 / max (ms) | Draw Calls p50 / p95 | Casts (Meteor / Overcharge / H0 / H1 / Move) | Budget Gate (`<= 100 ms`) |
      | --- | ---: | ---: | --- | --- | --- | --- |
      | `i16-boss-hard-mira20-spam` (W16 Boss) | 30 | **59.9** | `16.7 / 16.7 / 33.3` | `14 / 18` | `1 / 1 / 2 / 2 / 13` | **PASS (`33.3 ms`)** |
      | `i16-boss-hard-bran20-spam` (W16 Boss) | 30 | **57.1** | `16.7 / 16.8 / 50.0` | `12 / 15` | `1 / 1 / 3 / 2 / 12` | **PASS (`50.0 ms`)** |
      | `i24-boss-hard-sela20-spam` (W14 Tempest Boss) | 35 | **47.5** | `16.7 / 33.4 / 66.8` | `22 / 63` | `1 / 1 / 2 / 2 / 11` | **PASS (`66.8 ms`)** |
      | `i24-boss-hard-tobb20-spam` (W14 Tempest Boss) | 35 | **54.5** | `16.7 / 33.3 / 50.1` | `20 / 69` | `1 / 1 / 2 / 2 / 11` | **PASS (`50.1 ms`)** |

---

## In Progress

- [ ] **5. Desktop Build Sanity (`desktop/**`, `npm run desktop:build:linux`, Xvfb smoke test)**

---

## Next (in order)

1. **Desktop build sanity**: Linux AppImage still builds and launches (`npm run desktop:build:linux`, Xvfb smoke) with the current game; fix packaging issues.
2. **Post-backlog deep audit**: re-run full `qa:bot` + `sim:heroes` + audit owned files to raise quality further.

---

## Decisions

- **Chapter-Two Endless Spotlights Scoped to Chapter-Two Islands (`i17`–`i24`):** `hasChapterTwoEnemies(level)` activates `ENDLESS_CHAPTER2_SPOTLIGHTS` only on islands whose story waves introduce Chapter-Two enemies (`i17`–`i24`), keeping Chapter-One Endless free of unencountered Bestiary spoilers and preserving 100% byte-identical outputs on `sim:balance`, `i16` `p6-bench`, and 3D `LEVELS`.
- **3D Bundle Isolation in `src/platform/achievements.ts`:** `achievements.ts` inspects `levels` passed by the caller rather than statically importing `LEVELS_2D`, keeping 25 island layouts out of the 3D chunk.
- **Non-Destructive Corrupt Save Handling:** `loadProgress` / `loadProgress2D` preserve raw corrupted JSON once under `*_corrupt_backup*`, salvage truncated JSON prefixes when `hasAnyProgress` holds, and never auto-read `*_reset_backup*` unless explicitly requested via `recoverProgress2D(..., { includeResetBackup: true })`.
- **Dual PROGRESS Path Mirroring:** Both `docs/overnight/PROGRESS-skyhold-n2-agy.md` and `docs/overnight2/PROGRESS-skyhold-n2-agy.md` are maintained identically.

---

## Problems / Known Issues

- None blocking in owned area (`sim:balance` 41/41 byte-identical, `qa:bot` 656/656 passing, all Hard Boss low-end benches `<= 66.8 ms`).

---

## Requests for Other Agents

1. **Opus (`src/render2d/heroLayer.ts:628-630`):** While `hero.state === 'dead'`, `HeroLayer.drawBars` still draws the respawn countdown ring at `(h.spawnX, h.spawnZ)` (the castle gate), even though heroes now respawn at their rally point or castle-side chokepoint (`h.hasRallyPoint ? { x: h.rallyX, z: h.rallyZ } : world.heroSystem.getFallbackRespawnPoint()`), and `h.invulnTimer > 0` (`1.5 s` post-respawn immunity) is available if you want a brief shield/alpha shimmer.
2. **Opus (`src/render2d/main2d.ts:258,481,682`):** `heroSelection = resolveHeroForRun(...)` is computed once at page load; if a player levels up a hero on Victory/Defeat (`recordRunOutcome` writes new XP to `localStorage`) and clicks **Retry** / **Restart** without returning to the World Map, `game.newRun()` re-uses the pre-run `hooks.hero` level instead of re-reading `resolveHeroForRun(loadProgress2D(), ...)` (keep `hooks.hero` snapshot unchanged when `replay` is passed to `newRun(replay)` so Watch Replay stays deterministic).
3. **Opus (`src/render2d/ui/metaScreens.ts:460-517`):** 2D Settings → General currently exposes `resetProgress2D()` but not Copy/Load Save Code buttons yet; `exportSaveCode2D()`, `importSaveCode2D(code)` (`{ ok, progress, previous, summary }` covering all 5 heroes, Hard ribbons, and Workshop), and `recoverProgress2D()` in `src/render2d/ui/progress2d.ts` are ready to wire.
4. **Opus (`src/render2d/heroLayer.ts:253-264,951-978` & `src/render2d/ui/{abilityBar2d,heroHud2d}.ts` — low-end perf polish):**
   - `HeroLayer.icon(key)` lazily calls `Assets.load<Texture>({ autoGenerateMipmaps: true })` on the **first cast** of each hero skill; preloading the active hero's 2 skill icons during `loadArt` / `HeroLayer` init avoids a one-time WebP decode + mipmap spike on the first cast on low-end GPUs.
   - `HeroLayer.syncGizmos` allocates `new Set<number>()` per frame and puts 3 dynamic `Graphics` objects (`timer.clear().arc().stroke()`, `base`, `barrel`) into y-sorted `layers.actors`, breaking enemy sprite batching when Tobb's turret is deployed (`drawCalls` p95 rises from `~22` to `~69` on `i24`). Pre-baking `base` + `barrel` to textures (like `AbilityFx`) and using a tinted `wring` sprite for the timer keeps `layers.actors` single-batched.
   - `abilityBar2d.ts:513` and `heroHud2d.ts:486` re-assign `s.frame.src = ...` ~200 times per cooldown (`Math.round(frac * 200)`); guarding `if (s.frame.dataset.hi !== hiKey)` avoids redundant `HTMLImageElement` attribute/style invalidation.
