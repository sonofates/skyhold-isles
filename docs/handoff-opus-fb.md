# Handoff — owner feedback 2026-11-18 (`hermes/skyhold-fb-fixes`, Opus)

Owner played the preview on a desktop PC (Chrome, ~2000x1034) and sent `docs/feedback/2026-11-18/`.
All five points are addressed. Sim behaviour and balance are unchanged: `sim:balance` stdout is
byte-identical to base `381548d` (641 lines, same SHA-256), and every layout JSON differs from base
only in its gate fields.

## 1. Desktop blur / pixelation (root cause found)

**Cause:** the map bake was not the problem. The adaptive quality tier was. Boot calibration
(`AdaptiveQuality.calibrateBoot`) and the 1 s frame windows (`observe`) drop the tier on a slow
frame, and the `med` / `low` tiers set the **whole canvas** resolution by a pixel budget
(1.05 MP / 0.25 MP). On a 2000x1034 window that is 0.71x (med) and then 0.35x (low). The game,
HUD text included, was drawn into a ~700x360 framebuffer and stretched. That matches the owner's
screenshot, where the HUD text is soft too. The tier never recovered during the visit.

**Fix (`renderResolution.ts`, `game2d.ts`, `main2d.ts`):**
- `isDesktopClient()` treats a fine, hovering primary pointer as a desktop. `?desktop=1|0`
  forces it for QA.
- On desktops the tier only trims effects (particles). Canvas resolution uses
  `AdaptiveQuality.resolutionTier`, which is always `high` unless `?quality=` locks a tier.
- Desktop emergency path: the framebuffer may drop to 0.75x only when the tier is already `low`
  **and** the 1 s average stays under 20 fps for 4 s in a row. It returns to 1x after 5 s above
  40 fps. That cycle can happen at most twice per visit, so it cannot oscillate. On a desktop the
  effects tier also climbs back one step after 10 smooth seconds (also at most twice).
- Phones and tablets keep the previous behaviour exactly; the P6 perf work is untouched.
- Unit tests were added in `tests/render/renderResolution.test.ts`.

**Measured** (`node qa/fbprobe.mjs`, headless Chromium + SwiftShader; canvas px after boot / after
8–10 s of wave 1):

| Viewport | Before | After |
| --- | --- | --- |
| 1920x1080 DPR1 | tier low, res 0.35, canvas **667x375** | res 1.00, canvas **1920x1080** |
| 1920x1080 DPR2 | res 0.28, canvas 542x305 | res 2.00, canvas 3840x2160 (SwiftShader <20 fps → 0.75x emergency = 2880x1620) |
| 2560x1440 DPR1 | res 0.21, canvas 542x305 | res 1.00, canvas 2560x1440 (SwiftShader → 0.75x after 4 s) |
| 2000x1034 DPR1 (owner) | boot med 0.71 (1425x737) → low 0.35 (695x360) | res 1.00, canvas 2000x1034 throughout |
| 844x390 DPR3 phone | low 0.8 (675x312) | unchanged (phone path) |

Map variant: 1920x1080 DPR1 needs 1.27 texels/layout px and gets the 1.5x bake. 2560x1440 and
any DPR 2 desktop get the master (2x). At 1920x1080 DPR 2 the need is 2.54, so the master is
magnified 1.27x. That is the largest bake there is; see the open question below. The 0.75x
emergency in the table happens only because SwiftShader renders on the CPU at single-digit fps.
A real GPU stays at 1x. `qa/fbprobe.mjs` logs variant, resolution, tier, canvas and texture size.

## 2. Settings in-game

- `src/render2d/settingsButton2d.ts` adds a painted round kit button captioned "Settings" /
  "Ayarlar" in the HUD's top-right row, left of Guide/Codex. `hudButtonsLayout.settingsX` places
  it, and the build ring's keep-out covers it.
- A Settings plank sits under the "Paused" plate whenever the player has paused.
- Both open the world map's Settings view (`metaScreens.openSettings`, new in-game variant) as an
  overlay. The run pauses while it is open and the previous pause state comes back on close.
  Settings are re-read on close (shake / damage numbers / haptics).
- The in-game variant has no "reset progress" or store rows. The language row says "Changing it
  restarts this island": switching reloads the island with `&settings=1`, so Settings reopens in
  the new language.
- Space / N / 1 / 2 / Escape no longer act on the game while any sheet is open (this also fixes
  the Codex).
- Verified in Playwright (EN + TR, 1920x1080 and phone):
  - Opening from the plank: paused while open, still paused after close.
  - Opening from the button: paused while open, resumes after close.
- New i18n keys: `hud.settings`, `set.languageNoteInGame`.

## 3. Wave banner text

The text was placed at 47% of the banner art's height. The red cloth body in `ui-banner.webp`
runs from 36% to 86% (the rope fills the top), so the text now sits at the cloth middle (60%) plus
a small descender nudge (`hud.ts`, `BANNER_CLOTH_MID`).

Measured from pixels (`qa/fbshots.mjs banner`), lettering centre vs cloth centre at 844x390,
1600x900, 1920x1080 and 2560x1080:
- EN: 0.5–2 px.
- TR: 3.5–5 px, only because the "g" descender in "Dalga" extends the measured box; the letter
  bodies sit like EN.

Crops: `docs/fb-shots/banner-*.png`.

## 4 + 5. Caves and castle (fixed at the source; all 17 islands re-baked)

**Cause:**
- Side gates (E/W, 3/4-view art) were anchored at the *back-right corner* of the dark mouth (the
  exit band's 92nd-percentile floor). The road centre met the back door post and half the road
  ran under the cave front. This is the "cave sits left of the road".
- For the castle, the road's round end cap (half a road width) stuck out below the door. The
  ground had only a generic ellipse shadow, and the door was a flat near-black hole.

**Fix (`tools/map-compose/gates.py`, `compose.py`):**
- `mouth_threshold()` measures the opening's floor line between the posts.
- New default `--gate-seat threshold`: the road centreline is aimed through the threshold
  midpoint and the path end sits inside the dark on the same line. If a road arrives from above
  the floor line (some castles), placement falls back to halfway, then to the opening centre.
- `clip_road_at_gate()` cuts the painted road flush with the floor line, so no end cap shows
  under the gate.
- With `--keep-plots`, a gate only moves as far toward its seat as the kept plots, the HUD
  corners and the safe area allow. The bake log prints `seated <blend>` per gate.
- `contact_shadow()`: every gate casts its own silhouette shadow, so it sits on the ground.
- `light_interior()`: the castle door gets a warm depth gradient, lighter toward the floor where
  the road runs in. Caves stay dark, because raiders come out of the darkness.
- The safe-area bleed check now measures painted pixels, not the sprite rect. `--gate-bleed`
  sets the limit (default 0.6 road widths, unchanged).
- S-facing caves keep the old anchor. They already looked right (road straight in from below).
- `tools/map-compose/rebake_all.py` re-bakes all 17 islands with the documented recipe and fails
  if any non-gate field of any layout changed. Result: all 17 report "gameplay fields unchanged",
  and plots / paths / entrances / goal are identical.
- Blend per gate (1 = fully seated): most are 0.55–1.0. i02, i08 and i10 castles are 0.00: the
  old position is kept because a kept plot sits right beside them, but they still get the road
  clip, contact shadow and door interior. i09 cave A is 0.10 (a plot is next to it).
- Sheets: `docs/fb-shots/gates-{caves,castles}-{before,after}.jpg` (every gate on every island).
  Native in-game crops: `docs/fb-shots/gate-<island>-<gate>-{1920x1080-dpr2,phone-844x390-dpr3}.jpg`.

## Screenshots (`docs/fb-shots/`, `node qa/fbshots.mjs [play|banner|hud|all]`)

- `play-{l1c,i05,i12,i16}-{1920x1080-dpr1,1920x1080-dpr2,2560x1440-dpr1,phone-844x390-dpr3}.jpg`
  (wave 1 running)
- gate crops, before/after gate sheets
- `banner-{en,tr}-{844x390,1600x900,1920x1080,2560x1080}.png`
- `hud-*`, `paused-*`, `settings-*` (EN/TR, desktop + phone)

## Files touched

- `src/render2d/renderResolution.ts`, `game2d.ts`, `main2d.ts`, `mapView.ts`, `hud.ts`,
  `uiLayout.ts`, `settingsButton2d.ts` (new), `ui/metaScreens.ts`, `ui/paintedUi.css`
- `src/i18n/en.ts`, `src/i18n/tr.ts`
- `tests/render/renderResolution.test.ts`
- `tools/map-compose/gates.py`, `compose.py`, `gate_sheet.py` (new), `rebake_all.py` (new)
- `src/data/levels2d/*.json` (gate fields only)
- `public/art2d/map-*-layered*.webp` + gate fronts (17 islands)
- `qa/fbprobe.mjs`, `qa/fbshots.mjs`, `docs/fb-shots/`, this file

## Gate (Node 22.23.4)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npm run lint` | pass (0 problems) |
| `npm test` | **1093 passed, 11 skipped** (84 files passed, 1 skipped) |
| `npm run sim:balance` | **PASSED across 33 levels**; stdout byte-identical to base `381548d` |
| `npm run build` | pass (Vite chunk-size advisory only) |

## Left undone / doubtful

- Not checked on a real GPU. Headless Chromium here is SwiftShader (CPU). The desktop policy
  should keep 1x on any real GPU; the owner should confirm on the same PC. If that PC's Chrome
  has hardware acceleration off, it renders on the CPU too. It would then stay sharp but run
  slowly, and drop to 0.75x only if under 20 fps.
- The phone in headless SwiftShader still calibrates to the `low` tier (0.8x). That is the
  unchanged phone path; real phones with a GPU stay high. It was not in scope.
- `qa/p6-bench.mjs` was not re-run. The phone path it measures did not change.
- `docs/fb-shots/` is about 12 MB of JPEG/PNG.

## Questions for the owner

1. At 1920x1080 on a HiDPI (DPR 2) screen, and at 4K, the 2x master bake is magnified about
   1.27x. Should we ship a 3x master (about 5.5k px wide, roughly +2–3 MB per island), or is the
   current look acceptable?
2. Three castles (i02, i08, i10) keep their old placement because a build plot sits right next
   to them. Moving a plot would change the sim, so it is your call whether to move those plots
   in a balance pass.
3. Should switching language in-game really restart the island (current behaviour, with a note
   in the row), or should it apply after the run ends?
