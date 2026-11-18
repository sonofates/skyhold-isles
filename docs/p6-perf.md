# P6 2D frame pacing on i16

The baseline and the adaptive renderer both ran the i16 wave-20 fixture with 26 towers and about 150 enemies. The median WebGL draw count fell from 50 to 16 and p95 fell from 76 to 16. At a 915 × 412 CSS viewport, the original framebuffer was 2379 × 1071. The low override drew 732 × 330 and the automatic controller reached 595 × 268 under sustained load.

## Measurements

Node 22.21.1, Playwright Core 1.65.1, Chromium 153.0.8010.0, headless WebGL with ANGLE SwiftShader, landscape touch viewport, device scale factor 2.6. Each launch used a fresh browser and the production build. The table covers 12 seconds after a 6-second warm-up. Frame times are raw animation-frame intervals. Draw percentiles count GL submissions per interval. The maximum includes stalls.

| Run | CPU rate | Audio | Frames | Mean fps | Frame ms p50 / p95 / max | Draws p50 / p95 |
| --- | ---: | --- | ---: | ---: | --- | --- |
| Baseline, revision `854d34a` | 1× | Silent | 88 | 7.4 | 133.3 / 233.3 / 283.4 | 50 / 76 |
| Automatic → low | 1× | Locked | 369 | 31.4 | 16.7 / 50.0 / 733.3 | 16 / 16 |
| Automatic → low | 1× | Playing | 291 | 25.0 | 33.2 / 100.0 / 799.9 | 16 / 16 |
| Low override | 1× | Locked | 347 | 28.9 | 33.3 / 66.7 / 100.0 | 16 / 16 |
| Medium override | 1× | Locked | 158 | 13.2 | 66.7 / 150.0 / 233.3 | 16 / 16 |
| High override | 1× | Locked | 55 | 4.6 | 216.5 / 416.7 / 466.7 | 42 / 74 |
| Automatic → low | 4× slowdown | Playing | 259 | 21.6 | 33.3 / 200.0 / 800.0 | 16 / 16 |

A separate 30-second automatic run with audio on recorded 1,171 intervals and averaged **39.6 fps** at 1× CPU. Frame time was **16.7 / 33.5 ms p50 / p95**, the maximum was **583.3 ms**, and draw counts were **16 / 16**. It finished on wave 20 with 150 enemies.

The baseline used the numeric enemy-count route and the existing QA wave jump. The final route starts the same wave from the URL. The baseline and fixed-tier probe also read the existing rolling stats getter each frame. The final automatic probe reads it at startup and completion. All frame-time and draw columns come from the same animation-frame and GL counters. The fixed-tick sim and the benchmark's repeating lane, enemy and tower pattern determine the workload. The benchmark suppresses damage numbers, camera shake and the end panel, replenishes enemies and tops up lives and gold. The mix emphasizes archers, cannons and Tesla bolts. It exercises wave-20 spawns alongside the synthetic crowd. Individual runs cover different numbers of sim ticks when the host stalls.

Wall time varied substantially on this shared server. During tuning, an earlier automatic run at 732 × 330 had 58.3 fps, 16.7 / 16.8 ms p50 / p95, an 83.3 ms maximum and 16 / 16 draws. At 4× with audio, a forced 595 × 268 run averaged 38.7 fps (50.0 ms p95), compared with 29.7 fps (66.6 ms p95) in the adjacent 732 × 330 run. Those measurements motivated the last automatic resolution reduction. The worst intervals in the final sweep were longer than the baseline maximum. The software tests did not sustain a 30 fps floor. They establish the reduction in pixel workload and draw submissions. Sustained 60 fps and the worst frame on a physical Mali Android phone remain unverified.

## What changed the cost

- At full density the framebuffer had 2.55 million pixels. The low override has 0.24 million pixels on this viewport, and the last automatic reduction has 0.16 million. The high tier retains the original density, particle count, blend ordering and attack effects.
- Smoke, trails and additive flashes previously interleaved across pooled slots. Reduced tiers group additive particles, thin bursts and space trail samples farther apart. New particle admissions stop at 144 on medium and 64 on low, compared with 360 on high. Particles already in flight expire normally after a downgrade.
- The renderer allocates particle sprites up to actual demand. Reduced tiers visit active particle slots. Enemy special placement uses a reusable scratch object. Projectiles interpolate screen positions without an object per flight per frame. Enemy flashes and projectile shadows allocate their sprites on first use.
- The automatic controller steps down one tier after two consecutive one-second windows averaging over 19 ms per frame. On low, two further windows averaging over 33.3 ms reduce the framebuffer dimensions by another 19%. Hidden frames clear the pressure history. The tier holds through quiet build phases. Explicit `quality=low`, `quality=med` and `quality=high` lock both resolution and FX. Forced tiers apply before map-variant selection.

## Reproduce

Open `2d.html?level=i16&bench=150&endless=1&wave=20` for the interactive fixture. Append `&quality=low`, `&quality=med` or `&quality=high` to force a tier. The rolling `window.__bench` snapshot includes sim/update and render-submission CPU time. Its legacy frame-time field uses Pixi's capped ticker delta. The timed runner measures stalls beyond that cap.

With Playwright and its Chromium already available to the QA environment, run the following inside the checkout.

```sh
export PATH=/usr/local/lib/node22/bin:$PATH
npm run build
node qa/p6-bench.mjs
CPU_RATE=4 BENCH_AUDIO=1 SECONDS_TO_SAMPLE=30 node qa/p6-bench.mjs
BENCH_QUERY='level=i16&bench=150&endless=1&wave=20&quality=high' node qa/p6-bench.mjs
```

If Playwright is installed outside the project, set `PLAYWRIGHT_MODULE` to the absolute ESM entry of `playwright` or `playwright-core` and `CHROME_BIN` to the Chromium executable. The runner opens a loopback preview on an ephemeral port, launches SwiftShader, prints one JSON result, and closes both processes. The result includes frame count, actual wave, enemy and tower counts, canvas dimensions, quality, draw and frame percentiles, and particle-pool counters.
