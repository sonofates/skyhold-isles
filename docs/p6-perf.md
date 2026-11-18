# P6 2D frame pacing on i16

The `i16` wave-20 stress fixture (`2d.html?bench=150&level=i16&endless=1&wave=20`) exercises 26 active towers (archers, cannons, Tesla coils), ~150 simultaneous enemies across multiple lanes, projectiles, melee duels, particles, procedural music, and stereo SFX at a `915 × 412` CSS viewport (`deviceScaleFactor: 2.6`).

## Root causes of the ~580–1,000 ms frame spikes (Chrome Tracing + GL instrumentation)

Running `qa/p6-bench.mjs` alongside CDP `Tracing.start` (`devtools.timeline,v8.execute,v8,gpu`) and per-frame WebGL call counters exposed seven sources of stalls on `9c2caa2`:

1. **Lazy first-use GPU texture uploads & mipmap generation (`texImage2D` + `generateMipmap`):** Pixi v8 defers `gl.texImage2D` and `gl.generateMipmap` until a `TextureSource` is first drawn. Wave-20 enemy sheets (`shieldBearer`, `healer`, `necromancer`, `splitter`, `regenerator`, `tempest`), turret/attack sheets, and procedural FX textures uploaded mid-wave (20–26 `texImage2D` calls = ~20 MP + 15 `generateMipmap` calls in a single frame, stalling `1,129–1,383 ms` at startup and `116–233 ms` mid-wave when new enemy types spawned).
2. **First-use WebGL shader compilation & link (`GLES2Implementation::GetProgramiv`):** First frames drawing additive sprites (`blendMode = 'add'`), `Graphics` lightning/beam strokes, `NineSliceSprite`, and `Text` compiled and linked pipelines synchronously on the render path (`230–460 ms`).
3. **Mid-wave swapchain reallocations + unintended `@1.5x` map upgrade:** `Game2D` initialized `AdaptiveQuality` at `'high'` (`2379 × 1072`) even when `main2d.ts` pre-selected `'low'`, resetting `renderer.resolution` back to `2.6` on initial `onResize()`, triggering an asynchronous fetch + GPU upload of the `2769 × 1278` (`14.1 MB` RGBA) `@1.5x` map at `t ≈ 3.6 s`, and causing three multi-step swapchain reallocations (`high → med` `450 ms`, `med → low` `233 ms`, `low → 0.8125×` `117 ms`) during combat.
4. **4× MSAA resolve on software WebGL (`antialias: true`):** SwiftShader CPU-shaded and resolved a 4× multisampled backbuffer every frame and reallocated ~81 MB multisample renderbuffers on resize.
5. **OOP-GPU command-buffer & compositor swapchain backlog at `#boot` handoff:** In Chromium's out-of-process GPU architecture, `gl.finish()` flushes the client ring without waiting for SwiftShader rasterization; exposing gameplay before a `1 × 1` `gl.readPixels` barrier and initial compositor swaps spilled ~1.7 s of boot GPU work into the first gameplay frames.
6. **Per-frame HUD `PIXI.Text` re-rasterization & JS heap churn:** Rapid kill rewards changed `world.gold` nearly every tick, re-drawing a 2D `<canvas>` and calling `gl.texSubImage2D` every 2 frames; `TowerLayer.syncRing` allocated transient `RingSpec`, `SpriteFit`, and `AttackPlan` objects across 26 towers every frame; `Game2D` allocated `boltQueue` arrays/wrappers on Tesla shots; `assets2d.ts` created ~60 temporary `<canvas>` elements during boot alpha probing.
7. **Audio unlock & graph retention:** `SoundManager.createNoiseBuffer` generated `Math.random()` noise synchronously inside `unlock()`, and completed one-shot SFX/music `GainNode`s remained connected to destination/panner buses after `OscillatorNode.onended`.

## Fixes applied

- **Full GPU pre-warm & synchronous OOP-GPU barrier (`assets2d.ts`, `game2d.ts`, `main2d.ts`):** Added `collectArtTextureSources(art)` and `Game2D.prewarm()`. While `#boot` covers the stage, `prewarm()` pre-allocates pooled `EnemyLayer` (`160`), `ProjectileLayer` (`64`), and `FxLayer` (`96–160`) sprites, uploads every loaded and procedural `TextureSource` (`renderer.texture.initSource`), initializes all stage `Text` bitmaps (`renderPipes.text.initGpuText`), renders a tiny off-alpha warm batch covering `Sprite` (`normal` + `add`), `Graphics` (`normal` + `add`), and `NineSliceSprite`, synchronizes the GPU process via `gl.finish()` + `1 × 1` `gl.readPixels`, and presents 4 compositor warm frames before removing `#boot`. Post-boot gameplay executes **0** `texImage2D`, **0** `generateMipmap`, and **0** `compileShader` calls.
- **Software WebGL detection & boot quality calibration (`renderResolution.ts`, `game2d.ts`, `main2d.ts`):** `detectSoftwareWebGL()` probes a temporary `1 × 1` WebGL context (released immediately via `WEBGL_lose_context`) before `app.init` so software rasterizers (`SwiftShader`, `llvmpipe`, `Basic Render Driver`) disable 4× MSAA (`antialias: false`) while hardware GPUs keep `antialias: true`. `AdaptiveQuality.calibrateBoot()` measures real GPU-flushed frame time during `prewarm()` and settles the unlocked tier (`low` `732 × 330` at 1× CPU, `595 × 268` under 4× CPU throttle) before `#boot` is removed and before `upgradeMap()` checks map density, keeping the `@1x` (`1846 × 852`) bake and avoiding mid-wave swapchain resizes. `AdaptiveQuality.observe()` also fast-drops to `'low'` on two consecutive `> 85 ms` stalls.
- **Zero-allocation hot path & HUD gold rollup (`towerLayer.ts`, `game2d.ts`, `assets2d.ts`):** Reused per-tower `ringScratch`, `fitStatic`, `fitFrame`, and cached `AttackPlan` instances in `TowerLayer`; pooled `boltQueue` slots and `Vec3` points in `Game2D`; shared one `{ willReadFrequently: true }` probe canvas in `assets2d.ts`; throttled numeric HUD gold `Text` updates to `120 ms` during active combat waves (immediate on build/upgrade/sell/wave boundary/pause, steady `999 / 9999` in `endless` bench), eliminating per-frame `texSubImage2D` uploads.
- **Audio hot-path cleanup (`soundManager.ts`, `musicEngine.ts`):** Replaced synchronous `Math.random()` buffer generation during `unlock()` with a deterministic module-load `PREBAKED_NOISE` table (`fillNoiseChannel`), and disconnected one-shot `GainNode` tails in `onended` across `SoundManager` and `MusicEngine`.

## Before / After measurements

Node `22.21.1`, Playwright Core, headless WebGL with ANGLE SwiftShader (`--use-gl=angle --use-angle=swiftshader`), `915 × 412` landscape touch viewport at `deviceScaleFactor: 2.6`, production build (`npm run build`). Each `qa/p6-bench.mjs` run samples 12 s (or 30 s where noted) after a 6 s warm-up using raw `requestAnimationFrame` intervals.

### Before (P6 baseline recorded in `docs/p6-perf.md` & pre-fix `9c2caa2` re-verification)

| Run | CPU rate | Audio | Frames | Mean fps | Frame ms p50 / p95 / max | Draws p50 / p95 | Canvas |
| --- | ---: | --- | ---: | ---: | --- | --- | --- |
| Pre-P6 baseline (`854d34a`) | 1× | Silent | 88 | 7.4 | 133.3 / 233.3 / 283.4 | 50 / 76 | `2379 × 1071` |
| P6 Automatic → low (12 s) | 1× | Locked | 369 | 31.4 | 16.7 / 50.0 / 733.3 | 16 / 16 | `595 × 268` |
| P6 Automatic → low (12 s) | 1× | Playing | 291 | 25.0 | 33.2 / 100.0 / 799.9 | 16 / 16 | `595 × 268` |
| P6 Automatic → low (30 s) | 1× | Playing | 1,171 | 39.6 | 16.7 / 33.5 / 583.3 | 16 / 16 | `595 × 268` |
| P6 Low override (12 s) | 1× | Locked | 347 | 28.9 | 33.3 / 66.7 / 100.0 | 16 / 16 | `732 × 330` |
| P6 Medium override (12 s) | 1× | Locked | 158 | 13.2 | 66.7 / 150.0 / 233.3 | 16 / 16 | `1373 × 618` |
| P6 High override (12 s) | 1× | Locked | 55 | 4.6 | 216.5 / 416.7 / 466.7 | 42 / 74 | `2379 × 1071` |
| P6 Automatic → low (12 s) | 4× slowdown | Playing | 259 | 21.6 | 33.3 / 200.0 / 800.0 | 16 / 16 | `595 × 268` |

*(Same-host pre-fix `9c2caa2` check on Chromium `159.0.8154.6` also reproduced `28.2 fps`, `33.3 / 66.7 / 216.6 ms` over 30 s at 1× with audio, `22.8 fps`, `33.4 / 116.6 / 266.6 ms` at 4× CPU with audio, and `1,383.3 ms` / `450.0 ms` startup + resize stalls before 6 s.)*

### After (Chromium `159.0.8154.6`, SwiftShader, post-fix)

| Run | CPU rate | Audio | Frames | Mean fps | Frame ms p50 / p95 / max | Draws p50 / p95 | Canvas |
| --- | ---: | --- | ---: | ---: | --- | --- | --- |
| Automatic → low (12 s) | 1× | Locked | 716 | **59.7** | **16.7 / 16.8 / 50.0** | 16 / 16 | `732 × 330` |
| Automatic → low (12 s) | 1× | Playing | 717 | **59.8** | **16.7 / 16.7 / 33.4** | 16 / 16 | `732 × 330` |
| Automatic → low (30 s) | 1× | Playing | 1,800 | **60.0** | **16.7 / 16.7 / 16.8** | 16 / 16 | `732 × 330` |
| Low override (12 s) | 1× | Locked | 720 | **60.0** | **16.7 / 16.7 / 16.8** | 16 / 16 | `732 × 330` |
| Medium override (12 s) | 1× | Locked | 394 | **32.8** | **33.3 / 49.9 / 66.7** | 16 / 16 | `1373 × 618` |
| High override (12 s) | 1× | Locked | 132 | **11.0** | **83.4 / 150.0 / 183.3** | 54 / 81 | `2379 × 1071` |
| Automatic → low (12 s) | 4× slowdown | Playing | 720 | **60.0** | **16.7 / 16.7 / 16.8** | 16 / 16 | `595 × 268` |
| `i16` Wave-1 start (`?level=i16&autoplay=1`, 20 s from wave 1 start) | 1× | Playing | 1,201 | **60.0** | **16.7 / 16.8 / 16.8** | — | `732 × 330` |

Both targets are met with wide margin in SwiftShader:
- **Worst frame after Wave 1 starts:** `16.8–50.0 ms` across all automatic runs (`< 100 ms` target; down from `583.3–800.0 ms`). Even from `t = 0` including the initial `AudioContext` unlock gesture, worst frame was `66.7 ms`.
- **p95 in `qa/p6-bench.mjs`:** `16.7–16.8 ms` across 12 s, 30 s, and 4× CPU-throttled runs (`< 33 ms` target; down from `33.5–200.0 ms`).
- Physical 4 GB Mali Android phone and iOS Safari hardware telemetry remain recommended for device sign-off.

## Reproduce

Open `2d.html?level=i16&bench=150&endless=1&wave=20` for the interactive fixture. Append `&quality=low`, `&quality=med` or `&quality=high` to force a tier.

```sh
export PATH=/usr/local/lib/node22/bin:$PATH
npm run build
node qa/p6-bench.mjs
BENCH_AUDIO=1 SECONDS_TO_SAMPLE=30 node qa/p6-bench.mjs
CPU_RATE=4 BENCH_AUDIO=1 node qa/p6-bench.mjs
BENCH_QUERY='level=i16&bench=150&endless=1&wave=20&quality=high' node qa/p6-bench.mjs
```

If Playwright is installed outside the project, set `PLAYWRIGHT_MODULE` to the absolute ESM entry of `playwright` or `playwright-core` and `CHROME_BIN` to the Chromium executable.
