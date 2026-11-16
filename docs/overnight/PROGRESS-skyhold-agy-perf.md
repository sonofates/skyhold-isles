# Skyhold Isles Overnight Progress — PERF (`skyhold-agy-perf`)

Branch: `hermes/skyhold-agy-perf` (base: `main`)

## Done
- Added `'auto'` to `QualityLevel` (`'auto' | 'high' | 'low'`) in `src/core/types.ts` and made `'auto'` the default quality setting in `src/platform/storage.ts` while keeping saved `'high'` / `'low'` preferences backward compatible.
- Created pure, zero-DOM/zero-Three `src/render/perfGovernor.ts` with:
  - 6-tier quality ladder (`QUALITY_PRESETS` 0..5): scales DPR (touch capped `<= 2.0`, scaling down to `0.85`), toggles N8AO (`full` -> `half` -> `off`), SMAA, Bloom, Silhouette Outlines, Shadows, and Composer.
  - Allocation-free `RollingFrameMetrics` (`Float64Array` circular buffer + zero-alloc `computeP95`).
  - `PerfGovernor` state machine with warmup guard, ignored throttled/hidden/outlier frames, asymmetric hysteresis, severe-slow double step, exponential upgrade backoff, and permanent ceiling lock after bounce (`maxBouncesBeforeLock = 2`) so visuals never flip-flop.
- Added Vitest unit suite `tests/render/perfGovernor.test.ts` verifying DPR caps, p95 calculation, hysteresis, bounce lock, and manual `high`/`low` overrides.

## Governor Thresholds (`GOVERNOR_THRESHOLDS`)
- Rolling window: `90` unthrottled active frames (`minSamples = 20`, evaluated every `0.5s`, warmup `1.2s`, ignoring spikes `> 250ms`).
- Mild downgrade (`-1` tier): `avg >= 21.0 ms` or `p95 >= 26.5 ms` held for `2.0s` (`2.0s` cooldown).
- Severe downgrade: `avg >= 32.0 ms` or `p95 >= 42.0 ms` held for `1.0s` (`-2` tiers when `avg >= 36.0 ms` and `tier >= 2`).
- Upgrade (`+1` tier): `avg <= 17.6 ms` AND `p95 <= 20.0 ms` held for `12s` initially, doubling up to `48s` on bounce (`<= 25s` between upgrade and subsequent downgrade), and permanently locking the ceiling tier after `2` bounces.
- Initial tiers in `'auto'`: Desktop starts at Tier `5` (identical to `'high'`); Touch starts at Tier `4` (`halfRes` N8AO `Low`, touch DPR capped at `1.5`, SMAA off).

## Next
1. Wire `PostProcessingPipeline` (`src/render/postProcessing.ts`) and `SceneManager` (`src/render/sceneManager.ts`) to `PerfGovernor` + dynamic pass toggling + leak-free N8AO disposal + shader warm-up.
2. Add battery-aware frame pacing in `src/platform/browserLoop.ts` (hidden tab skip, lowered FPS when paused/modal/static menu, instant input wake) + unit tests.
3. Optimize startup in `src/render/kenneyAssets.ts` + `src/main.ts` (parallel `colormap.png`, skip redundant embedded texture/material loads per GLB, main-thread yield slices, shader warm-up before hiding loading screen) and measure startup/parse numbers.
4. Add `?perf` overlay & console logging in `src/ui/debugPanel.ts` & `src/ui/debugWiring.ts`.

## Decisions & Notes
- Kept `src/ui/settingsModal.ts` untouched to respect UI/mobile parallel work boundaries. **UI follow-up needed**: add an `'Auto'` button to the Quality segmented control in `src/ui/settingsModal.ts` (`Auto | High | Low`) matching `QualityLevel = 'auto' | 'high' | 'low'`.
