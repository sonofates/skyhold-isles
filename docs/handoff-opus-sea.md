# Handoff — living world-map sea (Opus, branch `hermes/skyhold-sea`, base `art-2d`)

Owner ask: the world-map sea looked flat; make it alive with light, continuous motion (no video),
calm and readable, light on phones, with Codex's painted sea sprites (`paintedUi.sea`) dropping in
automatically when they land.

## What it does

Bottom to top, everything **under** the route and the island medallions (they and their labels
stay on top, untouched):

| layer | what | how |
|---|---|---|
| water | the painted `ui/sea.webp` with a slow 3-layer noise displacement (≤ ~2.5 css px), soft swell light, drifting cloud shadows, foam flecks that swell and fade on the painted whitecaps, sun glints twinkling in light patches | one WebGL pass (`seaWater.ts`), one full-screen triangle, 4 small textures, no per-frame allocation, drawn at 30 fps on every tier |
| life | 1–3 soft clouds drifting with a parallax (they pan 1.22× the chart, so they read as nearer), each with its own shadow on the water; gull flights (1–3 birds, a few wing beats then a glide, with a faint shadow) every ~7–18 s; a whale tail rising, hanging and diving far from the islands every ~70–140 s (first after 22–42 s) with foam rings and drips | 2D canvas (`seaLife.ts`), dirty-rect clears only (no full-canvas clear), painted sprites when present else drawn stand-ins (`seaSprites.ts`) |
| islands | medallions bob (≈2 % of their size, each on its own phase); the frontier island has a ripple ring; the frontier ship bobs and rocks, its pennant flutters, its sail breathes | CSS (`seaLife.css`); the pennant/sail are clipped copies of `ship.webp` (the hull has an evenodd hole where the pennant was, the sail copy only grows from mast and yard so the painting never peeks) |

Both canvases sit **inside** the scrolling world, one viewport + 20 % margin each side wide, and are
moved (translate3d) only when the view leaves them — native scrolling / flings carry them with the
chart, no lag. The CSS sea painting stays underneath (first paint, fallback, flings past the margin);
the water fades in over it once its first frame is drawn.

**Seamless loop:** the water clock wraps every `SEA_PERIOD` = 240 s and every periodic term
(noise drifts, foam pulse, glint rates) completes whole cycles in it (unit-tested by parsing the
shader). Life events are random (seeded; `?seaseed=N` for QA).

**Restraint / readability:** a calm mask (world space, 1/8 res) darkens foam + glints around every
island, its name plaque, its stars, and lightly along the route; the title band and the hint's
rectangle are calm too. Whales spawn only ≥ 1.25 island-diameters from every island, ≥ 0.75 from the
route, inside the view, never under a cloud. Gulls fly between the title band and the hint. Clouds,
gulls and the whale are below the medallions and the route, so labels are never covered.

## Settings / tiers

`seaMotion.ts` → `seaConfig()` (pure, unit-tested):

- **Reduced motion** (Settings → Reduced motion, default from `prefers-reduced-motion`): one still
  water frame, no loop, no gulls/whale, clouds parked, no bob / ripple / ship motion. Applies live
  (`skyhold:graphics` event).
- **Tier**: `?quality=` > Quality preset > Auto (desktop high, touch med, software WebGL low).
  - high: water ≤ 2 px/css px (capped by the device and the painting's own texel density — at
    1080 css px tall that is 1.0), life canvas ≤ 2 (4 MP budget), display rate (or the fps cap).
  - med (phones on Auto): water ≤ 1.5, 30 fps loop.
  - low: water ≤ 0.75 with `sea@0.5x`, 30 fps, 60 % effects, only the frontier island bobs, no sail
    breathing.
- **Effects density** (Low / Normal / High) scales gulls, clouds, glints, painted foam/sparkles.
- **Auto + software rasteriser** (SwiftShader / llvmpipe — a machine without a usable GPU): the WebGL
  water stays off (the painting stays), clouds / gulls / whale / CSS motion still run. Measured:
  a full-screen shader pass costs SwiftShader a whole CPU core per frame.
- **Governor** (Auto only): two slow 2 s windows (> 1.6× the target interval) step high → med →
  low, and as the last step turn the water off.
- **Hidden tab**: the loop stops, CSS animations pause; resumes without a time jump (dt clamped).
- **Sheet open** (briefing, settings, …): the sea idles at ≤ 20 fps.

## Painted sprites (Codex, `paintedUi.sea`) — what the loader accepts

`seaSprites.ts` reads, per key `gull, whale, foam, cloud, cloudShadow, sparkle, ripple, shipSail`:
`paintedUi.sea.<key>` (or kebab `cloud-shadow`, or flat `sea-<key>` / `sea/<key>`), each value an
image path, a strip `.json` path (with `image` inside), an object
`{ image|file|src, json|sheet, frameW, frameH, count, cols, fps, anchor }`, or an array of those
(variants — e.g. several clouds). Strip json = the animation strips' format
(`{frameW, frameH, count, cols, fps, anchor?, image?}`), or `frames: [{x,y,w,h}|{frame:{…}}]`. An
image without json is cut only if it is a row of ≥ 3 square frames; clouds / cloudShadow are never
cut. A wide strip registered without json gets `<same name>.json` fetched.

**Heads-up:** `paintedUi.sea` is today the sea *texture* path (`'ui/sea.webp'`). If Codex turns it
into the sprite group, the texture falls back to `ui/sea.webp` (or `paintedUi['sea-texture']`) —
handled and tested.

How each painting is used (sizes are relative to the island diameter `d`):

| key | used as | when present, replaces |
|---|---|---|
| gull | strip played by wing beat (frame 0 = glide), ~1.15·0.2d wide, mirrored when flying west (paint it facing east) | the drawn gull + its drawn shadow |
| whale | strip played once over the ~4.5 s surfacing (anchor = water line), or a single image rising out of the water | the drawn tail, foam, drips |
| foam | short-lived patches fading in/out in open water (strip played over its life) | the shader foam |
| sparkle | twinkles (strip played over ~1.2 s) | the shader glints |
| cloud | the parallax clouds (variants) | the drawn clouds |
| cloudShadow | each cloud's shadow on the water | the drawn cloud shadows + the shader cloud shadows |
| ripple | the whale's rings and the frontier island's ring (single image: scaled + faded by CSS; strip: frames) | the drawn rings |
| shipSail | strip over the whole ship box (same framing as `ship.webp`, 160×160), played on the frontier ship | the clipped pennant/sail copies |

Verified with synthetic stand-in sprites served through Playwright (`qa/seaFakeArt.py` makes them,
`qa/seashots.mjs --fakeart=<dir>` registers them; shot: `docs/sea-shots/1920x1080-high-painted-standins.jpg`): all eight keys load and draw, including a strip with
json beside it, a `.json`-only entry, an inline-frames object, variant arrays, an un-jsoned strip,
and the `paintedUi.sea` string → object switch.

## Files

- `src/render2d/ui/seaMotion.ts` — config / tiers, loop clock, whale + gull placement (pure)
- `src/render2d/ui/seaWater.ts` — WebGL water (shader, tileable noise, context-loss handling)
- `src/render2d/ui/seaSprites.ts` — manifest reader, strip parser, drawn stand-ins
- `src/render2d/ui/seaLife.ts` + `seaLife.css` — the controller, life layer, island/ship DOM motion
- `src/render2d/ui/worldMap.ts` — mounts the sea, decorates nodes, passes the layout
- `src/render2d/ui/paintedUi.css` — old ship rule moved to seaLife.css
- `tests/render/seaLife.test.ts` — 19 tests
- `qa/seashots.mjs` (perf + shots + `--fakeart`, `--reduced`, `--killanim` cost probe), `qa/seaFakeArt.py`, `qa/seacheck.mjs` (behaviour), `qa/seaprobe.mjs`
  (running-animations probe), `qa/withPreview.py` gained `--outDir=` (preview another build)
- `docs/sea-shots/` — screenshots, frame sequences, perf json

`seaPainter.ts` (old procedural placeholder sea) was already unused; left alone.

QA params: `?seawhale=1` (whale after 2 s, every 9 s), `?seaseed=N`, `?seadebug=nowater,nolife,nobg`
(cost probes), `window.__sea.stats() / resetStats() / whaleNow()`.

## Performance (Playwright, headless Chromium, **SwiftShader = no GPU**)

Before (`af30fa0`, built to /tmp) and after, **interleaved in the same time window, 2 rounds each**
(the machine was shared: load average 11–19 on 8 cores, so read trends, not decimals). 5 s per
config after 2.5 s settle, save at island 7. `main` = renderer main-thread busy (CDP TaskDuration),
`gpu-proc` = CPU of Chrome's GPU process (where SwiftShader rasterises and composites), % of one
core. Raw: `docs/sea-shots/perf-{before,after}-r{0,1}.json`.

| config | build | fps | p95 ms | main ms/s | gpu-proc % | sea |
|---|---|---|---|---|---|---|
| 1920x1080 DPR1 Auto | before | 59.7 / 59.7 | 16.8 | 17 / 21 | 339 / 358 | — |
| | after | 58.4 / 58.9 | 16.8 | 34 / 37 | 334 / 408 | low, water off (software), draw 0.26 ms |
| 1920x1080 DPR2 Auto | before | 59.6 / 59.8 | 16.7 | 25 / 20 | 203 / 399 | — |
| | after | 59.9 / 59.7 | 16.8 | 37 / 35 | 436 / 431 | low, water off, draw 0.25 ms |
| 844x390 DPR3 phone Auto | before | 59.7 / 59.8 | 16.8 | 19 / 19 | 3 / 3 | — |
| | after | 59.7 / 60.0 | 16.7 | 36 / 37 | 223 / 257 | low, water off, draw 0.32 ms |
| 844x390 phone `quality=low` | before | 59.7 / 59.9 | 16.8 | 20 / 17 | 3 / 3 | — |
| | after | 59.8 / 59.9 | 16.8 | 35 / 40 | 311 / 328 | low, **water on** 887x293 @30 fps, draw 0.32 ms |
| 1920x1080 `quality=low` (forced) | before | 59.7 | 16.7 | 21 / 20 | 284 / 427 | — |
| | after | 18.4 / 17.6 | 200–233 | 16 / 20 | 412 / 372 | water on 2016x810 |
| 1920x1080 `quality=high` (forced) | before | 59.8 / 59.9 | 16.8 | 22 / 21 | 259 / 357 | — |
| | after | 12.9 / 13.0 | 217–233 | 19 / 25 | 397 / 401 | water on 2688x1080 |
| 1920x1080 DPR2 `quality=high` | after | 11.9 / 11.7 | 250 | 19 / 17 | 391 / 385 | water on 2688x1080 |
| 844x390 `quality=high` | after | 18.9 / 20.4 | 100–133 | 33 / 37 | 397 / 397 | water on 2364x780 |

How to read it:
- **What a GPU-less machine gets (Auto)**: 60 fps everywhere, same frame times as before. The sea
  adds ~15 ms/s of main thread (≈1.5 % of a core: life canvas + JS, 0.25–0.32 ms per drawn frame).
  The GPU-process % is SwiftShader *compositing* any change on screen in software: the old map
  already paid ~340 % at 1920 for its rocking ship; the phone baseline was idle (3 %) and now
  composites 30 fps of clouds/gulls/bobbing — on a real phone GPU that composite is cheap.
- **Forcing the WebGL water on in SwiftShader** costs ~a CPU core per frame at 1920 (13–18 fps) —
  that is why Auto turns the water off on software rasterisers and the governor's last step turns
  it off too. On a real GPU it is one full-screen pass with 7 texture reads at 30 fps (≈ 1–3 Mpx per
  frame); **I could not measure a real GPU here** (no GPU on hermes) — worth one check on a phone and
  a laptop (Chrome DevTools → Performance, map idle 10 s, `window.__sea.stats()`).
- Two fixes came out of measuring: the pennant/sail copies were clipped with `clip-path`, which put
  their animation on the main thread (main 70–99 → 33–38 ms/s after switching to `overflow` windows,
  `qa/seashots.mjs --killanim=` found it); and the medallion bob keyframes no longer use `var()`.
  The water draws at 30 fps on every tier (it moves slowly), halving its GPU work on 60 Hz screens.

## Checks run

- `qa/seacheck.mjs` — **21/21 ok, problems 0**: WebGL water live on high; loop draws; bob / ship /
  pennant / sail / ripple animations run; hidden tab → 0 frames, resumes; sheet open → ≤ 20 fps
  (5 fps measured); live Reduced motion → still; Reduced motion from start → 1 still frame, no CSS
  motion, panned to the end still covered; low phone → tier low, water 887x293 (≤ 0.75), 30.0 fps,
  only the frontier bobs; panning 0/25/50/75/100 % → the water layer always covers the viewport;
  Auto + software → water off (canvas hidden, painting stays), life still moves.
- `qa/seashots.mjs --fakeart` — all 8 painted keys load and draw, problems 0.
- Frame-difference sheets (6 frames, 0.5 s apart): open water changes by ~4 levels (of 255) per
  0.5 s after tuning (was 12–17 with the first foam pass — too busy, toned down).
- Gate: `npx tsc --noEmit` ok · `npm run lint` ok · `npm test` 99 files / **1315 passed**, 11 skipped
  (+19 new in `tests/render/seaLife.test.ts`) · `npm run sim:balance` PASSED (41 levels) ·
  `npm run build` ok.

## Shots — `docs/sea-shots/`

- `1920x1080-high.jpg`, `1920x1080-high-seq0..5.jpg` (+ `-seq.gif`): water live, clouds, gulls, whale
  (`?seawhale=1` so it shows up in the 3 s window).
- `844x390-med.jpg`, `844x390-med-seq0..5.jpg` (+ `-seq.gif`): what phones get on Auto.
- `844x390-low.jpg`, `1920x1080-auto-software.jpg` (water off), `1920x1080-high-reduced-motion.jpg`,
  `1920x1080-high-painted-standins.jpg` (loud synthetic sprites, proves the painted path).

## Open / for the owner

- **Real-GPU frame time not measured** (see above). If a phone struggles, `seaConfig` is the knob:
  e.g. phones' `waterMaxScale` 1.5 → 1, or the water off on `med`.
- The drawn stand-ins (clouds, gulls, whale tail) are placeholders until Codex's set lands; they
  switch automatically. If Codex's json uses a different shape than the strips format, `stripFields`
  in `seaSprites.ts` is the one place to extend. A painted `shipSail` strip is assumed to be framed
  like `ship.webp` (whole ship box, overlaid on it); if it is the sail only, change `.pu-ship-strip`
  placement in `seaLife.css`.
- Clouds pass **under** the islands (sky islands above clouds, and labels never covered). If the
  owner wants true foreground clouds over the islands, that would need a layer above the nodes and
  a rule to keep them off labels — deliberately not done for legibility.
- `seaPainter.ts` is dead code from before the painted sea; can be deleted in a cleanup.
