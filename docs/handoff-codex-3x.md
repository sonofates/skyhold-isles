# 3× maps for 4K and HiDPI desktops

All 17 islands have a 5538 × 2556 WebP and matching gate fronts. At 3840 × 2160 DPR 1 and 1920 × 1080 DPR 2, the renderer draws 2.535 device pixels per layout pixel. Both profiles now have enough map detail to cover the framebuffer.

| New runtime art | Files | Bytes |
| --- | ---: | ---: |
| Maps | 17 | 18,285,364 |
| Gate fronts | 42 | 2,169,574 |
| **Total** | **59** | **20,454,938 (19.51 MiB)** |

The 24 QA PNGs add 4,569,401 bytes. Total working-tree growth including code, documentation and screenshots is **25.04 MB**.

Individual maps range from 875,474 bytes (i14) to 1,252,310 bytes (i03). The bake starts at WebP quality 90 and enforces a 3,000,000-byte ceiling per map.

## Bake and layout

The compositor renders roads, edges, foliage decals and landmarks at 3× from their sources. It preserves the master's road-edge noise pattern, seeded placement and crossing exclusions. Each front samples the saved layout rectangle from the new composite, including fractional pixel boundaries.

The delivery used `/usr/bin/python3 tools/map-compose/rebake_all.py --only-3x --jobs 2`. Each island passed the compositor's `--keep-plots` checks. All 17 layout files match the branch base byte for byte, including paths, plots, gate rectangles and depth keys. A separate L1c rebake reproduced the master, 1× and 1.5× WebPs byte for byte. For a full rebuild, omit `--only-3x` to run the master and smaller bakes before the native 3× pass.

## Renderer

The selector uses the fitted map scale multiplied by the actual framebuffer resolution. A desktop can request 3× above 2.0 device pixels per layout pixel if the active WebGL context can fit the texture. At boot it paints the master first. Once the map and every required gate front have decoded, it swaps them together at the existing sprite positions and releases the replaced textures. Resizing during a download rechecks the current fit. A failed gate download leaves the complete master visible.

| Viewport | DPR | Device pixels per layout pixel | Settled bake |
| --- | ---: | ---: | --- |
| Phone, 844 × 390 | 3 | 1.37 | 1.5× |
| 1920 × 1080 | 1 | 1.27 | 1.5× |
| 1920 × 1080 | 2 | 2.54 | 3× |
| 2560 × 1440 | 2 | 3.38 | 3× |
| 3840 × 2160 | 1 | 2.54 | 3× |
| 3840 × 2160 | 2 | 5.07 | 3× |
| 3840 × 2160, 4096-pixel texture limit | 1 | 2.54 | 2× master |

At 4K DPR 2, demand still exceeds the largest bake by 1.69×. A resident 3× map uses about 54 MiB of RGBA texels. The phone and a desktop with a simulated 4096-pixel texture limit each made zero 3× requests in Playwright. A separate run held a download across a resize, returned to 3×, shrank to 1.5× and grew back to 3×. The missing-front test retained the master and all three L1c fronts.

## Visual review

The 24 PNGs contain 12 before/after comparisons at native device resolution. The before crops came from the branch base and the after crops from a production build. Both viewports rendered a 3840 × 2160 framebuffer. The L1c cave timber, castle window and banner outlines are a little clearer. On i16 the difference is easiest to see in the roadside grass blades beside the plot and the lit castle stonework. The plot ring and gate openings stay registered. These observations come from Chromium using SwiftShader. Physical GPU upload latency on the owner's desktop is unmeasured. [All crops](3x-shots/) · [L1c castle before](3x-shots/l1c-1920x1080-dpr2-castle-before.png) · [after](3x-shots/l1c-1920x1080-dpr2-castle-after.png) · [i16 plot before](3x-shots/i16-3840x2160-dpr1-plot-before.png) · [after](3x-shots/i16-3840x2160-dpr1-plot-after.png)

To reproduce the comparison against a local preview, run `node qa/map3xshots.mjs` in the project's Playwright environment. The script holds the 3× requests while it captures the master, then verifies the mounted map and front widths before taking the second set.

## Gate

Node 22.21.1, branch `codex/maps-3x`, base `c1a549f`.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed, 0 problems |
| `npm test` | 1,102 passed, 11 skipped across 84 passing files and 1 skipped file |
| `npm run sim:balance` | 33 levels passed. All 49,607 bytes of stdout match the pre-change run. SHA-256 `bdcd01f68a5e77a8bde921df202745b5143c10875687bdf0723118b7aebac33e` |
| `npm run build` | Passed with the Vite chunk-size advisory |

## Files touched

- Bake and art delivery in `tools/map-compose/{compose,ground,rebake_all}.py`, `public/art2d/manifest.json` and the 59 new `public/art2d/*@3x.webp` files.
- Variant choice, texture lifetime, gate sprites and mirrored map edges in `src/render2d/{mapVariant,assets2d,main2d,mapView,gateLayer,game2d,abScene}.ts`.
- Coverage in `tests/render/mapGates.test.ts`, `tests/sim/campaignIslands2d.test.ts`, `qa/map3xshots.mjs` and `docs/3x-shots/`.

The working tree is uncommitted for the orchestrator. There are no open owner decisions.
