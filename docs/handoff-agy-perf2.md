# Handoff — `agy-perf2` (`hermes/skyhold-perf2`)

Base revision: `9c2caa2` (`art-2d`). All work lives on `hermes/skyhold-perf2` with zero modifications to `src/render2d/ui/**`, `hud.ts`, `buildRing.ts`, `endPanel.ts`, `codex2d.ts`, `src/i18n/**`, `public/art2d/**`, `tools/**`, or `design/**`.

## What was done

### 1. 2D frame-spike elimination (`docs/p6-perf.md`)
- **Diagnosed via `qa/p6-bench.mjs` + Chrome DevTools Tracing (`devtools.timeline,v8.execute,v8,gpu`) + WebGL upload/shader counters:**
  - Lazy first-use `gl.texImage2D` + `gl.generateMipmap` uploads for Wave-20 enemy sheets, turret/attack sheets, and procedural textures (`1,129–1,383 ms` on boot frames and `116–233 ms` mid-wave when new enemy kinds entered).
  - First-use WebGL shader compilation/linking (`GLES2Implementation::GetProgramiv`, `230–460 ms`) for additive `Sprite`s, `Graphics` strokes, `NineSliceSprite`, and `Text`.
  - Premature `onResize()` resetting `app.renderer.resolution` back to `'high'` (`2379 × 1072`), triggering an async `@1.5x` (`2769 × 1278`, `14.1 MB` RGBA) map texture fetch/upload at `t ≈ 3.6 s` and three multi-step swapchain reallocations (`high → med → low → 0.8125×`: `450 ms`, `233 ms`, `117 ms`).
  - 4× MSAA backbuffer shading/resolve (`antialias: true`) on SwiftShader CPU rasterization.
  - Chromium OOP-GPU command-buffer + compositor swapchain backlog spilling into Frame 1 because `gl.finish()` alone does not block on OOP rasterization.
  - Per-frame HUD `PIXI.Text` re-rasterization (`gl.texSubImage2D` every 2 frames from kill-gold ticks) and per-frame object allocations in `TowerLayer.syncRing`, `Game2D.boltQueue`, and `assets2d.ts` alpha probes.
  - Synchronous `Math.random()` noise generation inside `SoundManager.unlock()` and un-disconnected completed `GainNode` tails in `SoundManager` / `MusicEngine`.
- **Fixes implemented:**
  - Added `collectArtTextureSources(art)` (`src/render2d/assets2d.ts`) and `Game2D.prewarm()` (`src/render2d/game2d.ts`): pre-allocates `EnemyLayer` (`160`), `ProjectileLayer` (`64`), and `FxLayer` (`96–160`) sprite pools; uploads every loaded and procedural `TextureSource` (`initSource`); initializes stage `Text` bitmaps (`initGpuText`); renders an off-alpha warm pass covering `Sprite` (`normal`/`add`), `Graphics` (`normal`/`add`), and `NineSliceSprite`; drains the OOP-GPU queue via `gl.finish()` + `1 × 1` `gl.readPixels`; and presents 4 compositor warm frames while `#boot` still covers the canvas (`src/render2d/main2d.ts`). Post-boot gameplay executes **0** `texImage2D`, **0** `generateMipmap`, and **0** `compileShader` calls.
  - Added `detectSoftwareWebGL()` (`src/render2d/renderResolution.ts`) to disable 4× MSAA (`antialias: !softwareWebGL`) on software rasterizers while preserving `antialias: true` on hardware GPUs, plus `AdaptiveQuality.calibrateBoot()` and emergency 2-frame severe-stall fast-drop (`> 85 ms`). Sequenced `game.prewarm()` before `upgradeMap()` so calibrated low-tier runs keep the `@1x` map bake.
  - Removed per-frame heap allocations in `TowerLayer.syncRing` (`ringScratch`, `fitStatic`, `fitFrame`, cached `AttackPlan`) and `Game2D.boltQueue`, shared one `{ willReadFrequently: true }` probe canvas in `assets2d.ts`, and throttled HUD combat gold `Text` updates to `120 ms` (immediate on build/upgrade/sell/wave/pause, steady `999 / 9999` in `endless` bench).
  - Pre-baked a deterministic module-load noise table (`PREBAKED_NOISE` / `fillNoiseChannel` in `src/audio/soundManager.ts`) so `unlock()` copies via `TypedArray.set`, and disconnected one-shot `GainNode` tails on `onended` in `src/audio/soundManager.ts` and `src/audio/music/musicEngine.ts`.
- **Before / After (`qa/p6-bench.mjs` on SwiftShader, `915 × 412 @ DPR 2.6`):**
  - **12 s Automatic (1× CPU, Audio Locked):** `31.4 fps` (`16.7 / 50.0 / 733.3 ms`) → **`59.7 fps` (`16.7 / 16.8 / 50.0 ms`)**
  - **12 s Automatic (1× CPU, Audio Playing):** `25.0 fps` (`33.2 / 100.0 / 799.9 ms`) → **`59.8 fps` (`16.7 / 16.7 / 33.4 ms`)**
  - **30 s Automatic (1× CPU, Audio Playing):** `39.6 fps` (`16.7 / 33.5 / 583.3 ms`) → **`60.0 fps` (`16.7 / 16.7 / 16.8 ms`)**
  - **12 s Automatic (4× CPU slowdown, Audio Playing):** `21.6 fps` (`33.3 / 200.0 / 800.0 ms`) → **`60.0 fps` (`16.7 / 16.7 / 16.8 ms`)**
  - **20 s `i16` Autoplay from Wave 1 start (`?level=i16&autoplay=1`, Audio Playing):** **`60.0 fps` (`16.7 / 16.8 / 16.8 ms` across 1,201 frames)**
  - Full table and reproduction commands are recorded in `docs/p6-perf.md`.

### 2. Pause on background (`platform.onPause` + `document.visibilitychange`)
- Added `bindBackgroundLifecycle2D` in `src/render2d/audio2d.ts` combining `getPlatform().onPause` / `onResume` / `onOverlayChange` (Capacitor iOS/Android & Steam) with `document.visibilitychange`, `pageshow`, and `pagehide`.
- Updated `Audio2D` (`src/render2d/audio2d.ts`) and `SoundManager` (`src/audio/soundManager.ts`) so audio suspends when either native app state or document visibility goes inactive, ignores gesture `unlock()` while backgrounded, and only resumes audio once both native and DOM states are foregrounded again.
- Added `Game2D.pauseForBackground()` (`src/render2d/game2d.ts`) and wired `bindBackgroundLifecycle2D` in `Game2D.attachInput` + `onBackgroundChange` in `src/render2d/main2d.ts`: backgrounding sets `stepper.paused = true`, resets the fixed-step accumulator, closes any open build ring, ducks music, stops `app.ticker` on non-debug scenes, updates the HUD immediately to the existing `'Paused'` banner/icon state, and latches `codexWasPaused = true` / `introWasPaused = true` so play stays paused on resume until the player explicitly unpauses.

### 3. Exclude no-effect challenges in 2D (`Silent Skies` free-badge fix)
- Fixed `isNeutralRun` (`src/data/runModifiers.ts`) to check `!m.championWaves`, and added `hasModifierEffectIn2D(patch)` which evaluates whether a `RunModifierPatch` alters any rule active in 2D (ignoring `abilitiesDisabled` and `abilityCooldownMul` because 2D has no active abilities).
- Added data-driven `isChallengeEffectiveIn2D(challenge)` and `CHALLENGE_IDS_2D` in `src/data/challenges.ts`, and updated `challengesForLevel(level)` to filter out challenges with no 2D effect whenever `level.layout2d` is present while keeping 3D levels unchanged. Because `availableChallenges`, `recordWin2D`, `islandStates` mastery, and Logbook badge totals all delegate to `challengesForLevel(level)`, `silentSkies` is excluded across all 17 2D islands with no free badges or stars.
- Enforced `!this.grid.isPlotMode` in `SimWorld.canUseAbilities()` (`src/sim/world.ts`) so `castMeteor` / `castOvercharge` cannot fire on 2D plot maps.
- Added optional `challengePool` parameter to `dailyChallengeFor` (`src/data/daily.ts`) defaulting to `CHALLENGE_IDS`.

## Files touched

- `src/audio/soundManager.ts`
- `src/audio/music/musicEngine.ts`
- `src/data/runModifiers.ts`
- `src/data/challenges.ts`
- `src/data/daily.ts`
- `src/sim/world.ts`
- `src/render2d/assets2d.ts`
- `src/render2d/audio2d.ts`
- `src/render2d/enemyLayer.ts`
- `src/render2d/fxLayer.ts`
- `src/render2d/game2d.ts`
- `src/render2d/main2d.ts`
- `src/render2d/projectileLayer.ts`
- `src/render2d/renderResolution.ts`
- `src/render2d/towerLayer.ts`
- `tests/audio/audio2d.test.ts`
- `tests/render/modifiers2d.test.ts`
- `tests/render/renderResolution.test.ts`
- `docs/p6-perf.md`
- `docs/handoff-agy-perf2.md`

## Gate numbers

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **PASS** (0 errors) |
| `npm run lint` | **PASS** (0 errors, 0 warnings) |
| `npm test` | **PASS** — **82 test files passed** (1 skipped), **1,071 tests passed** (11 skipped, 0 failed) |
| `npm run sim:balance` | **PASS** — **33/33 levels PASS**, 645-line output **byte-for-byte identical** (`0` diff vs `9c2caa2`) |
| `npm run build` | **PASS** (Vite production bundle built cleanly on Node `22.21.1`) |

## Anything left undone or doubtful

- **Physical mobile device verification:** SwiftShader frame pacing (`60.0 fps`, `p95 = 16.7 ms`, `max <= 50 ms`) and Chromium `visibilitychange` / mock native `onPause` transitions are verified locally, but physical 4 GB Mali Android GPU pacing and real Capacitor iOS/Android OS task-switcher transitions remain unverified on hardware.
- **2D Daily Squall challenge pool in `src/render2d/ui/modes2d.ts`:** Per file-ownership rules, `src/render2d/ui/modes2d.ts` was not edited. Island challenge lists, URL sanitization, badge awards, and island mastery already exclude `silentSkies` automatically via `challengesForLevel(level)`, and `dailyChallengeFor(day, cleared, CHALLENGE_IDS_2D)` is ready in `src/data/daily.ts` + `src/data/challenges.ts` for the `ui/**` owner to pass in `dailyForToday` if 2D Daily Squall should also avoid rolling `silentSkies`.

## Open questions for the owner

1. After `hermes/skyhold-ui3` lands, should `dailyForToday()` in `src/render2d/ui/modes2d.ts` pass `CHALLENGE_IDS_2D` to `dailyChallengeFor(...)` so 2D Daily Squall never pairs a real modifier with `silentSkies` (or is cross-mode 3D/2D daily seed parity preferred)?
2. Master-tier 2D islands (`i08`–`i16`) previously inherited `DEFAULT_BY_DIFFICULTY.Master = ['silentSkies', 'ironTide']` and now cleanly offer `['ironTide']` (1 effective challenge instead of 1 real + 1 free badge). Would you like a second non-ability challenge (e.g. `championHost` or a tower ban) paired onto Master 2D islands in a future balance pass?
