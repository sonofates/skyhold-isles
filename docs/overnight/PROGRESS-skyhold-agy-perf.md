# Skyhold Isles Overnight Progress — PERF (`skyhold-agy-perf`)

Branch: `hermes/skyhold-agy-perf` (base: `main`)

## Done

### 1. `?perf` Measurement Overlay & Telemetry Logging
- Added `?perf` URL flag support (alongside existing `?debug`) in `src/ui/debugWiring.ts` and `src/ui/debugPanel.ts` using existing `.debug-panel` CSS classes (zero edits to `src/style.css`).
- `?perf` stays visible across menus and gameplay and logs `[Skyhold Perf]` startup breakdown, quality tier transitions, and 5s periodic summaries (including `@<fps>fps` pacing suffixes when throttled, plus an interactive `Log Snapshot` button).
- Reports: rolling **FPS**, avg + **p95 frame ms**, CPU **work ms**, **draw calls**, **triangles**, **textures**, **geometries** (`renderer.info`), applied/native **DPR** & exact framebuffer pixel size (`getDrawingBufferSize`), **composer ON/OFF** + active post passes, **shadows ON/OFF + shadow map resolution**, **quality mode -> active tier** (including `[cap:TX]` if bounce-locked), **loop pacing mode**, and **startup time-to-menu** breakdown (`assetsMs`, `sceneSetupMs`, `warmupMs`, `timeToMenuMs`).
- Throttled `DebugPanel` DOM `textContent` updates to 5 Hz (`0.2s`), skipped updates while collapsed, and in `?perf` mode read `renderer.info.render` directly without calling `getRenderMetrics()` (`scene.traverseVisible`), eliminating measurement overhead.

### 2. Adaptive Quality Governor & `'auto'` Quality Default
- Added `'auto'` to `QualityLevel` (`'auto' | 'high' | 'low'`) in `src/core/types.ts`.
- Set `'auto'` as the default in `src/platform/storage.ts` while keeping `'high'` and `'low'` selectable and backward compatible with existing `localStorage` values.
- Created pure, zero-DOM/zero-Three `src/render/perfGovernor.ts`:
  - 6 quality tiers (`0`..`5`) controlling DPR scaling, shadow map resolution (`computeShadowMapSize`), N8AO (`full` Medium -> `half` Low `halfRes: true` -> `off`), SMAA, Bloom, Silhouette Outlines, Shadows, Composer, and low-quality decor counts.
  - Allocation-free `RollingFrameMetrics` (`Float64Array` circular buffer + zero-alloc `computeP95`).
  - Touch devices start at Tier `4` (`halfRes` N8AO `Low`, touch DPR capped `<= 1.5`, SMAA off, `1024x1024` shadow map); Desktop starts at Tier `5` (identical to existing `'high'`, `2048x2048` shadow map, DPR `<= 2.0`).
  - Dynamic shadow map resolution scaling (`computeShadowMapSize`): Desktop Tier 4–5 keep `2048`, Tier 1–3 step down to `1024` (4x fewer shadow texels); Touch Tier 2–4 use `1024`, Tier 1 steps down to `512` (4x fewer shadow texels); Tier 0 disables shadows and disposes `dirLight.shadow.map` + `depthTexture` to reclaim GPU memory.
  - Touch DPR cap is `<= 2.0` across all tiers and steps down (`1.5 -> 1.35 -> 1.15 -> 1.0 -> 0.85`) when slow.
  - Preserves `evalAccumSec` while waiting for `minSamples` on `<25fps` devices so severe step-downs trigger promptly instead of discarding partial eval windows.
- Updated `src/render/postProcessing.ts` (`PostProcessingPipeline`):
  - Dynamic pass reconfiguration (`applyConfig`) to switch N8AO (`full` / `half` / `off`), toggle Bloom & Silhouette Outlines on `compositePass`, and toggle `smaaPass`.
  - Explicitly forced `autoDetectTransparency = false` on `N8AOPostPass` (setting `transparencyAware = false` alone is ignored by N8AO's config `Proxy` when already `false`), preventing N8AO from accidentally enabling 2 extra full-scene transparency render passes + 4 scene traversals per frame.
  - Allocated `N8AOPostPass` directly at `getDrawingBufferSize()` dimensions instead of CSS size followed by immediate resize.
  - Added replacement `compositePass` before removing the old one in `applyConfig` so `EffectComposer` preserves `depthRenderTarget` without destroying and reallocating 3 GPU depth textures on Bloom/Outline toggles.
  - Added `disposeN8aoPass()` to explicitly dispose N8AO's internal render targets, quads, materials, `depthCopyPass`, and blue-noise texture (`N8AOPostPass` does not override `Pass.dispose()`), preventing GPU memory leaks when disabling N8AO or composer.
- Integrated `PerfGovernor` into `src/render/sceneManager.ts` and hooked `effectiveStateListener` in `src/main.ts` to keep `materials.setOutlineAlphaEnabled` and `decorBuilder.setQuality` synced without modifying `renderWorld.ts` or `decorBuilder.ts`.
- Hardened `SceneManager` & `PostProcessingPipeline` transitions and device detection:
  - Added `detectPrimaryTouchDevice()` in `src/render/sceneManager.ts` (`(pointer: coarse)` vs `(pointer: fine) and (hover: hover)`) so Windows touchscreen laptops with mice/trackpads preserve Desktop Tier 5 fidelity instead of falling back to Touch Tier 4.
  - Guarded `SceneManager.setQuality(quality)` against unchanged quality modes and re-synced `eff.outlineEnabled` / `eff.decorLow` in `main.ts`'s `onSettingsChange` so dragging the volume slider or toggling audio/shake settings in `'auto'` mode never resets the learned governor tier, bounce lock, or Tier 0/1 flags.
  - Restored `renderer.autoClear = true` in `SceneManager.applyPreset` whenever stepping down to direct rendering (`!preset.composer`, since `EffectComposer` sets `renderer.autoClear = false`).
  - Passed an empty scratch `THREE.Scene` into `new N8AOPostPass(...)` before disabling `autoDetectTransparency` and assigning the real scene, avoiding N8AO's constructor scene traversal and transient allocation+disposal of two full-res HalfFloat transparency render targets + DepthTexture.
  - Avoided reading `canvas.clientWidth/clientHeight` inside `SceneManager.render()` (uses cached `lastWidth`/`lastHeight`).

### 3. Battery-Saving Frame Pacing (`src/platform/browserLoop.ts`)
- Tab hidden (`document.hidden`): stops scheduling `requestAnimationFrame` completely (`0 fps` / zero GPU work) and resets timestamps + governor warmup on visibility restore.
- Dynamic frame pacing via `computeRenderPacingTarget`:
  - Active gameplay (`simActive && !paused && !modalOpen`): uncapped native VSync (`null`).
  - Static Main Menu showcase: `30 fps` (keeps slow diorama orbit, water waves, clouds, and crystal smooth at ~50% GPU cost).
  - Level Select / Modals (Pause, Settings, Victory, Defeat): `15 fps` (keeps background alive at ~75% lower GPU cost).
  - Idle paused gameplay: `20 fps`, instantly waking (`wakeRender(0.75)`) to full native VSync on pointer move/down, wheel, keydown, or camera motion.
  - Pointer movement/scroll inside Main Menu, Level Select, or open Modals stays capped at `30 fps` / `15 fps` (wake applies strictly to paused gameplay).
- Throttled frames and the single boundary frame emerging from a throttled sleep interval (`resumedFromThrottle`) are flagged and ignored by `PerfGovernor`, and `main.ts` resets display metrics + applies a short `0.4s` settle warmup when resuming active gameplay from a throttled state (without overwriting the full `1.2s` warmup on level/view changes).
- Added `resolveRenderPacing` callback on `GameLoop` evaluated before the frame-cap gate so unpausing, closing modals, or entering gameplay from menus renders on the very next RAF tick without a 1–4 frame (`33–66ms`) stale-cap drop.

### 4. Startup Optimization & Measurements
- `src/render/kenneyAssets.ts`:
  - Fetches & harmonizes `Textures/colormap.png` in parallel with `.glb` model downloads instead of blocking all 40 model fetches on an initial RTT.
  - Disposes `colormapTexture` if parallel model preloading rejects after `colormap.png` resolves.
  - Registers a `SKYHOLD_GEOMETRY_ONLY` `GLTFLoader` plugin (`loadMaterial`) so parsing the 40 `.glb` files does not fetch/decode `Textures/colormap.png` 40 extra times or allocate 40 transient `THREE.Texture` + `MeshStandardMaterial` instances that are immediately disposed.
  - Raised preload concurrency (`6 -> 10`), added cooperative `setTimeout(0)` yields when synchronous parse/merge work reaches `10ms`, and coalesced concurrent worker yields into a single shared promise so parallel GLB workers never queue staggered redundant timer turns.
- `src/render/sceneManager.ts` + `src/main.ts`:
  - Added `SceneManager.warmUp(camera, options?)` (syncs laid-out viewport size, `compileAsync` with `compile` fallback + initial composer/shadow frame) before `loadingScreen.hide()`, pre-compiling deferred gameplay-only materials (`materials.kenneyTower` instanced shader with `aHighlight` + `materials.ghostInvalidMaterial`) alongside the diorama scene to eliminate both menu-reveal and first-tower placement shader hitches.
  - Added `nextAnimationFrame()` yields (bypassed cleanly if `document.hidden` so background-tab loads never stall) and accurate `41/43` -> `42/43` -> `43/43` progress stages between preload -> diorama setup -> shader warm-up so `LoadingScreen` status text paints smoothly.

#### Measured Benchmark Numbers (Node v22 CPU/Load Simulation on Repo Assets)
- **Kenney GLB assets**: `40` files (`1,328.6 KB` total, `14,076` triangles total).
- **Pure GLB parse + normalize + merge CPU (geometry-only plugin)**: `45.7 ms` total across 40 files; max single GLB `11.49 ms` (`detail-crystal-large.glb`).
- **Simulated preload comparison** (4 ms network RTT + 2 ms simulated per-GLB texture decode for baseline, `concurrency 6` sequential colormap vs `concurrency 10` parallel + `SKYHOLD_GEOMETRY_ONLY` + 10 ms yield slice):
  - Baseline: `159.88 ms`, max slice `44.67 ms`, `40` redundant textures + `40` redundant materials created & discarded.
  - Optimized: `55.52 ms` (**2.88x faster**), max slice `24.65 ms`, `0` redundant textures/materials.
- Live browser `timeToMenuMs` (`assetsMs` / `sceneSetupMs` / `warmupMs`) is instrumented and printed in `?perf` overlay and `[Skyhold Perf]` console log.

### 5. Unit Tests
- `tests/render/perfGovernor.test.ts`: 16 tests covering `computeTargetDpr`, `computeShadowMapSize`, `computeP95`, `RollingFrameMetrics`, `PerfGovernor` hysteresis, severe double-step, `<25fps` eval accumulation, `setTouch` ceiling updates, warmup/outlier/throttle ignoring, bounce ceiling lock, manual `high`/`low` overrides, `detectPrimaryTouchDevice`, and `formatPerfLogLine`.
- `tests/core/browserLoopPacing.test.ts`: 8 tests covering `computeRenderPacingTarget` across hidden, active, wake, menu, levelSelect/modal (including wake suppression while in menus/modals), paused states, `GameLoop` `resolveRenderPacing` zero-drop unpause/resume + throttle-boundary sleep-delta flagging, `getPacingInfo` wake reporting, and backward-compatible `loadSettings` quality parsing.

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
  - **TOWERS (`src/render/towerMeshes.ts`)**: `syncTowers` allocates `${t.type}_${t.tier}` template strings per tower every frame (line 124). Indexing buckets by numeric `typeIndex * 3 + (tier - 1)` removes per-frame string allocations.
  - **MOBILE / UI (`src/render/towerBadges.ts`)**: `sync()` allocates `const tierCounts = [0, 0, 0]` each frame and re-uploads all tier matrices even when towers and camera haven't moved; dirty-checking `(towersVersion, cameraZoom, cameraQuaternion)` would skip redundant matrix rebuilds/uploads.
  - **ISLANDS (`src/render/mapBuilder.ts` & `src/render/decorBuilder.ts`)**: Consider dropping `castShadow` on small decor trees or reducing `createWaterDiscGeometry` segment counts when `decorLow`/Low quality is active, and check `groundDetails.ts` instance draw-call counts on larger maps.
  - **MOBILE / RENDER (`src/render/renderWorld.ts`)**: Projectile trail particles in `render()` (`Math.random() > trailChance`) could skip/halve emission on Tier `<= 1` (or when `sceneManager.getPerfSnapshot().activeTier <= 1`), and `getRenderMetrics()` runs `scene.traverseVisible` which could cache shadow-caster counts per level load instead of walking the scene graph on every `?debug` telemetry poll.

## Verification
All checks passed after the final edit:
- `npx tsc --noEmit`
- `npm run lint`
- `npm test` (11 test files, 76 tests)
- `npm run build`
- `npm run sim:balance` (9 levels, Greedy & Weak targets passed)
