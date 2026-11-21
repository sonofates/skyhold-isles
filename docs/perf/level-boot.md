# Entering a 2D level

## Background upload measurements

On i07, the final production build was interactive in **1.37 s** with a warm HTTP cache, 31 ms after the previously recorded 1.33 s median. All **227 unique sources** were GPU-confirmed resident **12.36 s after interactive**, or **13.75 s from navigation**. Each navigation opened the build ring with a real mouse click while uploads continued.

| Warm run | Interactive | Build ring open | All resident from navigation | Longest background slice |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1.365 s | 1.637 s | 14.817 s | 3.4 ms |
| 2 | 1.354 s | 1.558 s | 13.344 s | 5.2 ms |
| 3 | 1.388 s | 1.664 s | 13.749 s | 4.5 ms |

The fresh-browser navigation was interactive at 2.30 s and fully resident at 19.76 s. The warmer uploaded 200 sources per document. Initial rendering and normal draws covered the other 27. The same working tree before this follow-up measured 2.13 s median interactive under heavier shared-host load. The comparison above uses the earlier recorded warm baseline and the same Chromium, SwiftShader, viewport and cache configuration.

**Immediate wave 1 at 4×.** The wave started with 212 sources pending. Over 20.02 s the probe observed enemies, projectiles and 592 frame intervals. All textures were resident at 19.86 s from navigation. No interval spent over 50 ms inside synchronous WebGL texture calls. The largest background slice was 8.9 ms. One interval crossed 50 ms when measured upload time was included. The probe also saw 82 intervals over 50 ms overall, 73 of which contained texture calls.

| Wave observation | Time after wave start | Frame interval | Inside texture calls |
| --- | ---: | ---: | ---: |
| Most upload time, including a first-draw 3584 × 1024 sheet | 0.40 s | 25.0 ms | 22.8 ms |
| Longest frame interval | 8.12 s | 210.3 ms | 0.2 ms |
| Interval crossing 50 ms with upload time included | 13.84 s | 50.3 ms | 0.5 ms |

A GPU readback compared Pixi’s direct upload with the strip upload for the 3576 × 1536 crystal tower sheet. Every byte matched at all 12 mip levels. An odd-width transparent image also matched, including when a normal draw claimed it mid-transfer. In a separate visibility probe, 212 sources stayed pending for 12 forced-hidden animation frames. Returning to visible let the queue drain to zero.

## Original boot comparison

Local production builds, Chromium headless shell 153.0.8010.12, ANGLE SwiftShader, 1024 × 768 CSS pixels, DPR 1, Turkish, default quality and hero. Each build got one priming navigation and three new documents in the same browser context. The comparison below uses consecutive before/after batches. Each row is its own median, so phase medians may not sum to the total.

| Elapsed time from navigation | Before | After |
| --- | ---: | ---: |
| Interactive, warm | 2.40 s | **1.33 s** |
| Plot 5 clicked and build ring open, warm | 2.52 s | **1.53 s** |
| Interactive, first navigation in fresh browser | 4.62 s | 2.26 s |

| Warm boot phase | Before (ms) | After (ms) |
| --- | ---: | ---: |
| Navigation through JS entry | 83 | 79 |
| Resolve run, initialize renderer, get manifest | 80 | 94 |
| Load textures and sheets, including decode and pixel probes | 768 | 748 |
| Resolve art and hooks, construct scene, resize, prepare pools and HUD text | 103 | 171 |
| Explicit upload of the full texture catalog and mipmaps | **1,017** | **0** |
| Render first stage, flush shaders and calibrate resolution | 161 | 171 |
| Four additional render-frame waits | 66 | 0 |
| Finish installing controls and start ticker | 144 | 44 |

Warm interactive samples were 2.40 / 2.51 / 2.35 s before and 1.36 / 1.33 / 1.33 s after. The readiness mark fires with the input handlers installed, the initialized scene rendered and the ticker started. The plot measurement also includes Playwright dispatch, observation of the open ring and the next animation-frame callback.

The initial profiling pass on this shared machine took 3.44 s warm before changes, including 1.41 s loading art and 1.15 s submitting bulk uploads. The owner's production observation was about 10 s, with about 6 s after network completion. The local trace identifies where the renderer blocks and shows the relative savings on software GL. Attributing the full production interval requires a trace from that device. Resource Timing entries on the window also omit some worker fetches. Small HUD requests completed near the readiness mark even on the original build.

## Changes

- Normal play draws the visible stage under the boot screen. Once controls are live, the ticker warms the remaining catalog. The stress benchmark still uploads all sources before sampling. Pixi applies each source’s original sampling and mipmap settings in both paths.
- The queue uses unique sources from `collectArtTextureSources`, the procedural textures and the rally flag. Enemy art follows its first spawn in the level, including flying and manifest fallbacks. Tower art follows in tier order across all tower types, then projectiles, FX and the remaining art. A normal draw can claim any queued source first.
- Each visible ticker slice checks for pending input, targets 3 ms of CPU time and submits at most 256 Ki pixels of strip data. On WebGL2, large RGBA image bitmaps upload in strips of about 64 Ki pixels into one temporary texture. Pixi takes ownership of the complete image and generates its configured mipmaps. If the game draws the source first, Pixi can upload it immediately and the warmer discards the partial copy. Other source types and WebGL1 use Pixi’s normal upload path. A single GL call can exceed the slice budget.
- The ticker skips hidden frames and unregisters after completion. The pass temporarily protects the catalog from idle eviction so a slow pass can finish. At the end it checks every source and polls a WebGL2 fence with zero timeout. Pixi then resumes its usual eviction policy.
- Successful textures go straight through Pixi's loader, which already supports worker-backed image bitmap decoding. A failed load checks for a permanent 404 or HTML fallback. Transient failures retain bounded retries. Enemy base, attack, death and directional sheet loads can proceed together.
- The browser preloads the manifest from the HTML. Fonts, the level HUD module and art can finish in parallel. The loading screen leaves when controls are installed. The four extra frame waits and the 290 ms wait before starting a page navigation are gone.
- Opening an unlocked island briefing warms the HTTP cache for its expected map variant, gate fronts, plot and core HUD images. The level still chooses its final variant from its actual WebGL limits. The boot screen uses the existing island painting, the localized tip and a progress bar updated by renderer setup, completed art jobs and final scene readiness.

## Reproduce

Build with `npm run build`. To match the warm-cache experiment, serve that build with Vite preview and a temporary freshness header. From the repository root run

```sh
node --input-type=module -e "import { preview } from 'vite'; (await preview({ preview: { headers: { 'Cache-Control': 'public, max-age=3600' } } })).printUrls()"
```

In another shell run `node qa/levelBoot.mjs http://127.0.0.1:4173` with Playwright available to Node. The harness also accepts `CHROMIUM_PATH` for an existing Chromium executable. With the default `npm run preview` headers, repeat navigations also exercised HTTP revalidation. Separate three-run batches measured 3.47 s median interactive before and 2.07 s after. The freshness override above applies only to the local preview.

For individual traces, open `/2d.html?level=i07&lang=tr&boottrace=1`. The first console table ends at interactive. The second adds `boot:all-textures-resident` with elapsed time since interactive and navigation. The marks and measures are also in the Performance panel. In the console, `window.__p0.textureWarmup()` returns the catalog size, current pending count, background upload count, longest CPU slice, completion timestamp and GPU-fence status. On WebGL2, completion includes the final fence. On WebGL1 it records Pixi submission.

The harness runs a separate warm-cache combat document. On the first interactive frame it builds an archer and frost tower on i07, starts wave 1 at 4× and samples 20 seconds of wall time. It checks that enemies and projectiles appeared and that uploads were pending at wave start. It times WebGL texture allocation, image transfer and mipmap calls on the game’s actual context, then reports the five longest frame intervals and the five with the most synchronous texture time. It fails if texture calls alone consume over 50 ms in an interval. The report lists intervals that cross 50 ms when their measured upload time is included and identifies time spent uploading ambient video. These timings include normal draws, HUD changes and background uploads. Asynchronous GPU work can affect later frames.

## Verification and follow-up

- The i07 before/after art matrix matched across all 101 present cells. Map resolution, both gate fronts, plot coordinates, HUD geometry, initial gold and lives matched in a fixed-quality comparison.
- World-map Play opened the first island's intro and then the playable map. Chromium reused prefetched art across the navigation. A recorded eight-command run replayed to the same result at tick 3,070. A touch viewport with a hero also booted with one simulated 503 and one optional image returning HTML. The transient texture recovered and the missing tier used its fallback.
- Keep full navigation for now. The world map, sea animation, game input, resize listeners, ticker and HUD use document-lifetime state. An in-place transition needs explicit teardown plus repeat-entry and browser Back checks. A production trace on the owner's desktop is the next measurement.
