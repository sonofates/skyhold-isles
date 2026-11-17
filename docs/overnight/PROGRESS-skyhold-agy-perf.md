# Skyhold Isles Overnight Progress — PERF (`skyhold-agy-perf`)

Branch: `hermes/skyhold-agy-perf` (base: `main`)

## Done

### 1. `?perf` Measurement Overlay & Telemetry Logging
- Added `?perf` URL flag support (alongside existing `?debug`) in `src/ui/debugWiring.ts` and `src/ui/debugPanel.ts` using existing `.debug-panel` CSS classes (zero edits to `src/style.css`).
- `?perf` stays visible across menus and gameplay and logs `[Skyhold Perf]` startup breakdown, quality tier transitions, and 5s periodic summaries (including `@<fps>fps` pacing suffixes when throttled, plus an interactive `Log Snapshot` button).
- Reports: rolling **FPS**, avg + **p95 + max frame ms**, CPU **work avg + p95 ms**, **draw calls**, **triangles**, **textures**, **geometries**, **shader programs** (`renderer.info`), applied/native **DPR** & exact framebuffer pixel size (`getDrawingBufferSize`), **composer ON/OFF** + active post passes, **shadows ON/OFF + shadow map resolution**, **quality mode -> active tier** (including `[cap:TX]` if bounce-locked and tier transition count), **loop pacing mode**, **startup time-to-menu** breakdown (`assetsMs`, `sceneSetupMs`, `warmupMs`, `timeToMenuMs`), and startup WebGL2 / GPU capability summary.
- Throttled `DebugPanel` DOM `textContent` updates to 5 Hz (`0.2s`), skipped updates while collapsed, and in `?perf` mode read `renderer.info.render` directly without calling `getRenderMetrics()` (`scene.traverseVisible`), eliminating measurement overhead.
- Added `SceneManager.resetDisplayMetrics()` and updated `main.ts` pacing transitions so entering/switching throttled modes (`menu`/`modal`/`paused`) updates the `?perf` FPS readout immediately (skipping the stale transition delta) without disturbing `PerfGovernor` state, and exiting any throttled mode (including `'wake'`) resets display metrics + short `0.4s` settle cleanly.
- Fixed `DebugPanel` boot readout (`update(0)` before loop start so `?perf` never shows a synthetic `4.0 fps / 250ms` initial sample).

### 2. Adaptive Quality Governor & `'auto'` Quality Default
- Added `'auto'` to `QualityLevel` (`'auto' | 'high' | 'low'`) in `src/core/types.ts`.
- Set `'auto'` as the default in `src/platform/storage.ts` while keeping `'high'` and `'low'` selectable and backward compatible with existing `localStorage` values.
- Created pure, zero-DOM/zero-Three `src/render/perfGovernor.ts`:
  - 6 quality tiers (`0`..`5`) controlling DPR scaling, shadow map resolution (`computeShadowMapSize`), N8AO (`full` Medium -> `half` Performance `halfRes: true` -> `off`), SMAA, Bloom, Silhouette Outlines, Shadows, Composer, and low-quality decor counts.
  - Allocation-free `RollingFrameMetrics` (`Float64Array` circular buffer + zero-alloc `computeP95`).
  - Touch devices start at Tier `4` (`halfRes` N8AO `Performance` with 8 AO samples + 4 denoise samples, touch DPR capped `<= 1.5`, SMAA off, `1024x1024` shadow map); Desktop starts at Tier `5` (identical to existing `'high'`, `2048x2048` shadow map, DPR `<= 2.0`).
  - Dynamic shadow map resolution scaling (`computeShadowMapSize`): Desktop Tier 4–5 keep `2048`, Tier 1–3 step down to `1024` (4x fewer shadow texels); Touch Tier 2–4 use `1024`, Tier 1 steps down to `512` (4x fewer shadow texels); Tier 0 disables shadows and disposes `dirLight.shadow.map` + `depthTexture` to reclaim GPU memory.
  - Touch DPR cap is `<= 2.0` across all tiers and steps down (`1.5 -> 1.35 -> 1.15 -> 1.0 -> 0.85`) when slow.
  - Preserves `evalAccumSec` while waiting for `minSamples` on `<25fps` devices so severe step-downs trigger promptly instead of discarding partial eval windows.
- Updated `src/render/postProcessing.ts` (`PostProcessingPipeline`):
  - Dynamic pass reconfiguration (`applyConfig`) to switch N8AO (`full` / `half` / `off`), toggle Bloom & Silhouette Outlines on `compositePass`, and toggle `smaaPass`.
  - Switched `'half'` N8AO (`Tier 4` Touch default & Desktop first step-down) to `getN8aoQualitySettings('half')` (`Performance` 8 AO samples + `halfRes: true`), halving AO fragment taps while preserving 2-pass Poisson smoothing so phones hold Tier 4 cleanly without dropping AO.
  - Inserted replacement `compositePass` in-place before removing the old one in `applyConfig` so `EffectComposer` preserves `depthRenderTarget` without destroying/reallocating 3 GPU depth textures AND leaves any trailing `smaaPass` untouched without removing/re-initializing SMAA.
  - Added `whenReady()` on `PostProcessingPipeline` (awaiting `SMAAEffect` async LUT `searchImage`/`areaImage` load event with 50ms fallback) so `SceneManager.warmUp` uploads SMAA LUT textures before the menu appears.
  - Explicitly forced `autoDetectTransparency = false` on `N8AOPostPass` (setting `transparencyAware = false` alone is ignored by N8AO's config `Proxy` when already `false`), preventing N8AO from accidentally enabling 2 extra full-scene transparency render passes + 4 scene traversals per frame.
  - Allocated `N8AOPostPass` directly at `getDrawingBufferSize()` dimensions instead of CSS size followed by immediate resize.
  - Added `disposeN8aoPass()` to explicitly dispose N8AO's internal render targets, quads, materials, `depthCopyPass`, and blue-noise texture (`N8AOPostPass` does not override `Pass.dispose()`), preventing GPU memory leaks when disabling N8AO or composer.
  - Fixed `N8AOPostPass` `EffectCompositer` missing `#define ORTHO` in `'full'` mode (`Tier 5` desktop, where `halfRes` stays `false` so the proxy never re-invokes `configureEffectCompositer` with `ortho = true`).
  - Added `releaseDisabledPasses()` on `PostProcessingPipeline` and ordered `SceneManager.applyPreset()` as `releaseDisabledPasses -> resize -> applyConfig` so disabled passes are never resized before disposal and newly enabled passes allocate once at the final `drawingBufferSize`.
- Integrated `PerfGovernor` into `src/render/sceneManager.ts` and hooked `effectiveStateListener` in `src/main.ts` to keep `materials.setOutlineAlphaEnabled` and `decorBuilder.setQuality` synced without modifying `renderWorld.ts` or `decorBuilder.ts`.
- Hardened `SceneManager` & `PostProcessingPipeline` transitions and device detection:
  - Added `detectPrimaryTouchDevice()` in `src/render/sceneManager.ts` (`(pointer: coarse)` vs `(pointer: fine) and (hover: hover)`) so Windows touchscreen laptops with mice/trackpads preserve Desktop Tier 5 fidelity instead of falling back to Touch Tier 4.
  - Guarded `SceneManager.setQuality(quality)` against unchanged quality modes and re-synced `eff.outlineEnabled` / `eff.decorLow` in `main.ts`'s `onSettingsChange` so dragging the volume slider or toggling audio/shake settings in `'auto'` mode never resets the learned governor tier, bounce lock, or Tier 0/1 flags.
  - Restored `renderer.autoClear = true` in `SceneManager.applyPreset` whenever stepping down to direct rendering (`!preset.composer`, since `EffectComposer` sets `renderer.autoClear = false`).
  - Passed an empty scratch `THREE.Scene` into `new N8AOPostPass(...)` before disabling `autoDetectTransparency` and assigning the real scene, avoiding N8AO's constructor scene traversal and transient allocation+disposal of two full-res HalfFloat transparency render targets + DepthTexture.
  - Avoided reading `canvas.clientWidth/clientHeight` inside `SceneManager.render()` (uses cached `lastWidth`/`lastHeight`).
  - Added `webglcontextlost`/`webglcontextrestored` handlers on `canvas` (with `dispose()` cleanup) so mobile OS context losses restore cleanly without black frames or stale governor stats, and reset governor warmup (`0.65s`) on window resize/orientation changes in `main.ts`.
  - Added WebGL extension capability guards (`canUseHalfResN8ao` requiring WebGL2 + `EXT_color_buffer_float` for N8AO's `R32F` downsample MRT, falling back cleanly to `'Performance'` full-res `AO-P` while preserving `#define ORTHO`; and `canUseHalfFloatComposer` requiring `EXT_color_buffer_half_float` or `EXT_color_buffer_float` before enabling `EffectComposer`), plus `disposeShadowMap()` cleanup inside `SceneManager.dispose()` and `smaaReadyCancel` cleanup on SMAA pass release/disposal.

### 3. Battery-Saving Frame Pacing (`src/platform/browserLoop.ts`)
- Tab hidden (`document.hidden`): stops scheduling `requestAnimationFrame` completely (`0 fps` / zero GPU work), clears any pending wake timer, and resets timestamps + governor warmup on visibility restore.
- Dynamic frame pacing via zero-allocation frozen `computeRenderPacingTarget` presets:
  - Active gameplay (`simActive && !paused && !modalOpen`): uncapped native VSync (`null`).
  - Static Main Menu showcase: `30 fps` (keeps slow diorama orbit, water waves, clouds, and crystal smooth at ~50% GPU cost).
  - Level Select / Modals (Pause, Settings, Victory, Defeat): `15 fps` (keeps background alive at ~75% lower GPU cost).
  - Idle paused gameplay: `20 fps`, instantly waking (`wakeRender(0.75)`) to full native VSync on pointer move/down, wheel, keydown, or camera motion (`getPacingInfo()` reports `'wake'` consistently whenever paused wake is active).
  - Pointer movement/scroll inside Main Menu, Level Select, or open Modals stays capped at `30 fps` / `15 fps` (wake applies strictly to paused gameplay). Fixed `GameLoop.tick` so an active paused `wakeUntilMs` timer never overrides `resolveRenderPacing`'s `15fps`/`30fps` modal/menu cap when transitioning into a modal/menu.
- Throttled frames and the single boundary frame emerging from a throttled sleep interval (`resumedFromThrottle`) are flagged and ignored by `PerfGovernor`, while `sleepBoundary` (4th arg on `onAfterRender`) + `skipNextDisplayFrame` on level/view and throttled-mode switches prevent stale sleep/load deltas from polluting `?perf` `displayMetrics` right after `resetDisplayMetrics()`.
- Passed unclamped `actualFrameDt` (5th arg on `onAfterRender`) from `GameLoop.tick` to `SceneManager.recordFrame` while keeping `stepper.step` and `onRender` safely clamped to `0.1s`, activating `PerfGovernor`'s `>250ms` OS-stall outlier filter and accurate `?perf` `maxMs` reporting; guarded `main.ts` camera-wake check with `!overlays.isModalOpen()` so modals never arm `wakeRender`.
- Added `resolveRenderPacing` callback on `GameLoop` evaluated before the frame-cap gate so unpausing, closing modals, or entering gameplay from menus renders on the very next RAF tick without a 1–4 frame (`33–66ms`) stale-cap drop.

### 4. Startup Optimization & Measurements
- `src/render/kenneyAssets.ts`:
  - Fetches & harmonizes `Textures/colormap.png` in parallel with `.glb` model downloads instead of blocking all 40 model fetches on an initial RTT.
  - Disposes `colormapTexture` if parallel model preloading rejects after `colormap.png` resolves.
  - Registers a `SKYHOLD_GEOMETRY_ONLY` `GLTFLoader` plugin (`loadMaterial`) so parsing the 40 `.glb` files does not fetch/decode `Textures/colormap.png` 40 extra times or allocate 40 transient `THREE.Texture` + `MeshStandardMaterial` instances that are immediately disposed.
  - Strips unused vertex attributes (`tangent`, present on all `48/48` GLTF mesh parts) before `src.toNonIndexed()` in `normalizeMeshGeometry`, avoiding ~675 KB of transient Float32 allocations and cutting normalization CPU (`14.67 ms -> 10.98 ms` across 40 GLBs).
  - Skips `applyMatrix4(worldMatrix)` in `normalizeMeshGeometry` when the mesh world transform is already the identity matrix.
  - Raised preload concurrency (`6 -> 10`), added cooperative yields (preferring `scheduler.yield()` when available to avoid 4ms nested `setTimeout` browser clamping) when synchronous parse/merge work reaches `10ms`, and coalesced concurrent worker yields into a single shared promise so parallel GLB workers never queue staggered redundant timer turns.
- `src/render/sceneManager.ts` + `src/main.ts`:
  - Added `SceneManager.warmUp(camera, options?)` (syncs laid-out viewport size via `renderWorld.resize`, creates `PostProcessingPipeline` first when composer is enabled, binds `composer.inputBuffer` as the render target during `compileAsync` so Three.js compiles the exact `'srgb-linear'` scene + deferred gameplay shaders once instead of compiling `'srgb'` variants and synchronously recompiling `'srgb-linear'` on first draw, awaits `postProcessing.whenReady()` in parallel for SMAA LUT textures, then renders the initial composer/shadow frame) before `loadingScreen.hide()`. Pre-compiles deferred gameplay-only materials (`materials.kenneyTower` instanced shader with `aHighlight` + `materials.ghostInvalidMaterial`) for `EffectComposer` so both menu-reveal and first-tower placement avoid shader compile hitches.
  - Added `nextAnimationFrame()` yields (bypassed cleanly if `document.hidden` so background-tab loads never stall) and dynamic `KENNEY_MODEL_LIST.length + 3` monotonic progress reporting (`0 -> 41/43 -> 42/43 -> 43/43`) so `LoadingScreen` status text paints smoothly even if new models are added later.

#### Measured Benchmark Numbers (Node v22 CPU/Load Simulation on Repo Assets)
- **Kenney GLB assets**: `40` files (`1,328.6 KB` total, `14,076` triangles total, `48/48` indexed parts with `tangent` attribute stripped pre-deindex).
- **Pure GLB parse + normalize + merge CPU (geometry-only plugin)**: `45.7 ms` total across 40 files (normalization step reduced `14.67 ms -> 10.98 ms` by stripping `tangent` before `toNonIndexed()`); max single GLB `11.49 ms` (`detail-crystal-large.glb`).
- **Scene setup CPU breakdown in Node (after GLB preload)**: `MaterialLibrary` `1.34 ms`, `TowerGeometryCache` (lazy) `0.03 ms`, `EnemyRenderer` `74.73 ms`, `MapBuilder` L1 `86.34 ms` / L9 `79.58 ms`, `DecorBuilder` `1.24 ms`.
- **Simulated preload comparison** (4 ms network RTT + 2 ms simulated per-GLB texture decode for baseline, `concurrency 6` sequential colormap vs `concurrency 10` parallel + `SKYHOLD_GEOMETRY_ONLY` + 10 ms yield slice):
  - Baseline: `159.88 ms`, max slice `44.67 ms`, `40` redundant textures + `40` redundant materials created & discarded.
  - Optimized: `55.52 ms` (**2.88x faster**), max slice `24.65 ms`, `0` redundant textures/materials.
- Live browser `timeToMenuMs` (`assetsMs` / `sceneSetupMs` / `warmupMs`) + framebuffer pixel resolution is instrumented and printed in `?perf` overlay and `[Skyhold Perf]` console log.

### 5. Unit Tests
- `tests/render/perfGovernor.test.ts`: 18 tests covering `computeTargetDpr`, `computeShadowMapSize`, `computeP95`, `RollingFrameMetrics` (including `maxMs` sliding-window tracking), `PerfGovernor` hysteresis, severe double-step, `<25fps` eval accumulation, `setTouch` ceiling updates, warmup/outlier/throttle ignoring, bounce ceiling lock, manual `high`/`low` overrides, `detectPrimaryTouchDevice`, `getN8aoQualitySettings` (`'half'` -> `'Performance'` + `halfRes: true`, `'half'` fallback -> `halfRes: false`, `'full'` -> `'Medium'` + `halfRes: false`), `canUseHalfResN8ao`, `canUseHalfFloatComposer`, and `formatPerfLogLine` (with `maxFrameMs`, `workP95Ms`, `programs`, `tierTransitions`).
- `tests/core/browserLoopPacing.test.ts`: 11 tests covering `computeRenderPacingTarget` across hidden, active, wake, menu, levelSelect/modal (including wake suppression while in menus/modals), paused states, `GameLoop` `resolveRenderPacing` zero-drop unpause/resume + `sleepBoundary` vs `throttled` distinction + modal `15fps` cap retention even with an active wake timer + unclamped `actualFrameDt` outlier guard for `PerfGovernor`, `getPacingInfo` wake reporting, `visibilitychange` RAF cancellation + wake cleanup + restore, and backward-compatible `loadSettings` quality parsing.

## Governor Thresholds (`GOVERNOR_THRESHOLDS` in `src/render/perfGovernor.ts`)
- Rolling window: `90` unthrottled active frames (`minSamples = 20`, evaluated every `0.5s`, initial/upgrade warmup `1.2s`, post-downgrade warmup `0.65s`, outlier clamp `> 250ms` ignored).
- Mild downgrade (`-1` tier): `avgMs >= 21.0` OR `p95Ms >= 26.5` sustained for `2.0s` (`2.0s` cooldown).
- Severe downgrade: `avgMs >= 32.0` OR `p95Ms >= 42.0` sustained for `1.0s` (`-2` tiers if `avgMs >= 36.0` and `tier >= 2`).
- Upgrade (`+1` tier): `avgMs <= 17.6` AND `p95Ms <= 20.0` sustained for `12.0s` initially; if downgraded within `25.0s` of an upgrade, hold duration doubles (`12s -> 24s -> 48s`) and after `2` bounces at a tier the ceiling locks permanently for the session.

## Cross-area Changes & Notes for Other Agents
- **Cross-area edits kept minimal**:
  - `src/core/types.ts`: added `'auto'` to `QualityLevel` union (`'auto' | 'high' | 'low'`).
  - `src/render/kenneyAssets.ts`: optimized `preload` / `disposeSceneResources` and failure texture cleanup without touching `KENNEY_MODEL_LIST`.
- **UI follow-up needed (`src/ui/settingsModal.ts` — untouched per lock)**:
  - Add an `'Auto'` button to the Quality segmented control (`Auto | High | Low`) so players who switch to `'High'` or `'Low'` can switch back to `'Auto'`, and so `'Auto'` highlights as active when selected by default.
- **Suggestions for other render owners (not edited by PERF)**:
  - **TOWERS (`src/render/towerMeshes.ts` & `src/render/effectsRenderer.ts`)**: `syncTowers` allocates `${t.type}_${t.tier}` template strings per tower every frame (line 124) — indexing buckets by numeric `typeIndex * 3 + (tier - 1)` removes per-frame string allocations. Also in `EffectsRenderer`, `shardMesh`, `particleMesh`, and `pulseRingMesh` never call `setColorAt(...)` in their constructor (`instanceColor` starts `null`), causing `SceneManager.warmUp` to compile them without `USE_INSTANCING_COLOR` and triggering 3 shader recompiles on first tower build/kill; pre-seeding `setColorAt(0, ...)` in the constructor eliminates those mid-game hitches.
  - **MOBILE / UI (`src/render/towerBadges.ts`)**: `sync()` allocates `const tierCounts = [0, 0, 0]` each frame and re-uploads all tier matrices even when towers and camera haven't moved; dirty-checking `(towersVersion, cameraZoom, cameraQuaternion)` would skip redundant matrix rebuilds/uploads.
  - **ISLANDS (`src/render/mapBuilder.ts` & `src/render/decorBuilder.ts`)**: `MapBuilder.build` takes `~80–86 ms` synchronously on desktop CPU (`~160–250 ms` on mobile); consider dropping `castShadow` on small decor trees or reducing `createWaterDiscGeometry` segment counts when `decorLow`/Low quality is active, and check `groundDetails.ts` instance draw-call counts on larger maps.
  - **ENEMIES (`src/render/enemyMeshes.ts`)**: `EnemyRenderer` constructor takes `~74.7 ms` synchronously during boot (`ExtrudeGeometry` bevel triangulation + `setColorAt` across 7 `InstancedMesh` layers); pre-merging/simplifying or reducing `curveSegments`/bevels would cut mobile startup `sceneSetupMs` significantly.
  - **MOBILE / RENDER (`src/render/renderWorld.ts`)**: Projectile trail particles in `render()` (`Math.random() > trailChance`) could skip/halve emission on Tier `<= 1` (or when `sceneManager.getPerfSnapshot().activeTier <= 1`), and `getRenderMetrics()` runs `scene.traverseVisible` which could cache shadow-caster counts per level load instead of walking the scene graph on every `?debug` telemetry poll.

## Verification
All checks passed after the final edit:
- `npx tsc --noEmit`
- `npm run lint`
- `npm test` (11 test files, 81 tests)
- `npm run build`
- `npm run sim:balance` (9 levels, Greedy & Weak targets passed)
