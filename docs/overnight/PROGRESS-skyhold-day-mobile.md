# PROGRESS — skyhold-day-mobile (MOBILE FEEL & PERFORMANCE)

Branch `hermes/skyhold-day-mobile`. Preview port 4302. Deadline 21:00 TR.

## Tooling notes (for later rounds)
- `npm ci` is needed in a fresh worktree (no node_modules).
- Screenshot harness lives in `.shots-tool/` (gitignored; recreate with `npm i --prefix .shots-tool playwright-core`).
  Scripts there (not committed): `shoot.mjs <outDir> 1-13 p390x844,l844x390,p360x640,t820x1180,d1440x900`,
  `sheet.mjs` (contact sheet), `dumpRects.mjs` (HUD rects per size), `touch.mjs` (tap/pan/double-tap/long-press smoke),
  `pwaCheck.mjs` (offline reload), `icons.mjs` (SVG -> PNG icons). Needs `npx vite preview --port 4302 --host 127.0.0.1`
  started with a long timeout (background tasks die after 10 min by default).
  Chromium: `~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`
  (launch with `--use-angle=swiftshader --enable-unsafe-swiftshader`). Seeds save so all islands are unlocked.
- Software GL is slow (~1 s per CDP call): real double-tap timing cannot be tested via CDP touch events; the smoke script
  dispatches synthetic PointerEvents inside the page instead.
- Compound shell commands (`a && b`, `a; b`), heredocs containing `{...'...}`, `env X=1 cmd`, `curl`, `sleep` trigger
  permission blocks in this sandbox — issue one simple command per Bash call, write files with the Write tool.

## Done
- Round 1
  - **Backlog 1 (framing)**: `src/render/occlusionFit.ts` (pure) + `CameraController.setHudRects`: the default zoom/target now
    keeps >=88% of playable tiles (weighted; spawn/goal must be visible with extra margin) clear of the *measured* HUD rects
    (`src/ui/hudRects.ts`, measured on level start and on every resize). Zoom never exceeds the legacy fill zoom.
    Regression test `tests/render/frameCoverage.test.ts` runs all 13 islands x 5 viewports with HUD rects measured in a real
    browser; it also writes `.shots-tool/framing-report.txt`. Result: coverage up everywhere (e.g. L5 portrait 0.83 -> 0.99,
    spawn/goal always visible), zoom unchanged except L5/L9 (-8..-15%) where spawn/goal sat on the screen edge.
    Future islands are covered automatically (the test iterates `LEVELS`).
  - **Backlog 2 (touch)**: soft pan limits in camera-plane space (`panLimits.ts`; the auto-fit target is always reachable),
    fling inertia, double-tap on empty map = recentre (also `C` key), long-press on a tower = info card, tap slop already
    10px, haptics (`platform/haptics.ts`, Settings toggle "Haptics", per-kind patterns, rate-limited), `setPointerCapture`
    guarded. Ground-first tap resolution (existing `tapResolution.ts`) already makes tiles beside/behind towers tappable.
  - **Backlog 3 (quality)**: `QualityLevel = auto|high|medium|low`; `render/qualityGovernor.ts` (windowed frame-time
    governor: warm-up, 2 slow windows or 1 very slow -> step down, 20 s smooth -> step up, bounce-lock, 30 Hz-cap guard),
    `render/qualityTiers.ts` (high = unchanged desktop look, DPR<=2; medium = no AO/SMAA, 1024 shadows, DPR<=1.5, fx 0.75;
    low = old Low), `platform/qualityController.ts`. Settings v2 (`v:2` in saved JSON): legacy unversioned touch `low`
    migrates to `auto`; new `haptics` flag. Defaults: touch -> auto (starts at medium), desktop -> high.
    `visibilitychange`: loop stops, play auto-pauses, audio suspends; resume re-arms governor warm-up.
  - **Backlog 5 (PWA)**: `public/manifest.webmanifest` (fullscreen), icons (`public/icons/*`), theme-color + apple meta in
    `index.html`, `vite.config.ts` plugin emitting `dist/sw.js` (template `pwa/sw.template.js`, version = hash of all shipped
    files + template), network-first navigation, cache-first assets, `ignoreVary`, explicit update flow (new worker waits ->
    "New version ready / Reload" pill (`ui/updatePrompt.ts`, CSS in `ui/styles/updatePrompt.css`) -> SKIP_WAITING -> reload).
    `vercel.json` sends `no-cache` for `/sw.js`. Verified offline reload in Chromium.

  - **Backlog 4 (HUD)**: toasts were shrinking to half width (abs-positioned at left:50%) and covering the rotate buttons on
    portrait phones -> `width:max-content` + left-aligned, clear of the right column; toast close target 44px; settings modal
    with 4 quality buttons checked at 390/844x390/360 (fits, 44px targets). Wave preview (many chips, L13 w16) fits at 360 and 667x375.
  - Before/after contact sheets for all 13 islands: `docs/overnight/mobile-shots/{before,after}-*.jpg` (portrait 390x844,
    phone 360x640, landscape 844x390, tablet 820x1180; desktop 1440x900 after only). Software-GL, Low quality, all unlocked.
  - README: touch controls / quality / PWA notes. Debug overlay shows `auto→medium @1.50x`.
  - Checks at end of round 1: tsc, lint, 461 vitest tests, build, `sim:balance` all green (no gameplay/data change).

- Round 2: re-verified tree is green (tsc, lint, 461 tests, build). Draw-call check on L13 landscape (`?debug=1`, 300 enemies
  active via debug spawn, Medium tier): **45 draws (w/ shadows) + 38 (no shadows), ~227k tris** — well under the ~100 budget;
  draws stay flat as enemy count grows (instanced buckets). No code change needed. Reviewed the after-portrait / after-landscape
  contact sheets again: all 13 islands fill the screen, spawn/goal visible, HUD clear.

- Round 3: **auto yaw on portrait phones** (`CameraController.pickAutoYaw`): evaluates the 4 quarter-turn views and uses
  another one only when it frames the island >=1.2x larger (HUD-aware). Today only L5 qualifies (zoom 0.39 -> 0.56; all other
  islands keep the designed angle; landscape/tablet/desktop never rotate). Stops once the player presses rotate
  (`autoYaw=false`); reset per level. `viewYawIndex` getter + 3 tests in `tests/render/cameraController.test.ts`.
  Screenshot checked (`L05` portrait: spawn + goal visible, left edge of the island cropped, HUD clear).

- Round 5: tree green (tsc, lint, tests, build). Notch check: overrode `--safe-t/b/l/r` (portrait 47/34/0/0, landscape 0/21/47/47)
  on L13 at 390x844 and 844x390 (`.shots-tool/notch.mjs`): top bar, wave chip, rotate/pause column, ability gems and Start
  button all stay inside the insets, nothing clipped. No code change needed.

## Next
- Real-device verification is impossible here: governor thresholds (22 ms slow / 18.5 ms smooth, 60-frame windows) and the
  Auto start tier (medium on touch) are educated guesses -> a later round could add an opt-in `?perf` log or tune from reports.
- Optional: portrait could crop big islands (L13 frames at zoom 0.38 = whole island) if the lead prefers bigger tiles.
- Optional: Lighthouse-style audit if a Lighthouse binary becomes available (manifest/SW/theme-color/viewport are in place).
- Landscape: bottom tip of some islands still sits under the ability gems (spawn/goal/coverage are guaranteed, edges are not).

## Decisions
- Did not change camera yaw for portrait (tried `yaw=0`: flat, ugly); islands stay at the 45 deg diamond view.
- Medium tier rebuilds the post pipeline (drop AO + SMAA) rather than toggling passes (renderToScreen on the last pass).
- Update prompt is player-driven (no auto skipWaiting) so a running game never swaps under the player.

## Known issues
- Governor thresholds are untested on real devices (only unit tests + software GL).
- Portrait L13 still frames at zoom 0.38 (whole island ~ screen width); pinch to zoom in.

## Cross-area changes
- `src/audio/soundManager.ts`: `suspendForBackground()/resumeFromBackground()` (tiny).
- `src/core/types.ts`: `QualityLevel` widened, `QualityTier`, `GameSettings.haptics`.
- `src/platform/gameSession.ts` / `main.ts` / `settingsModal.ts` / `radialMenu.ts` (`openTowerInfo`): wiring only.
- `src/style.css`: `.setting-seg*` sizes (4 quality buttons, 44px touch target).

- Round 4: re-verified everything green (tsc, lint, 464 tests, build, sim:balance PASSED 13 levels). Re-reviewed landscape contact sheet: all 13 islands fill the frame, spawn/goal visible, ability gems only clip island tips. No code change needed; backlog 1-5 complete. Remaining items are the optional ones under "Next" (real-device tuning, Lighthouse).

- Round 6: tree green (tsc, lint, 464 tests, build). Small hardening in `src/style.css` (html/body): `overscroll-behavior: none` (no pull-to-refresh / rubber-band when a drag reaches the page edge) and `-webkit-touch-callout: none` (no iOS long-press callout; the long-press tower info card is ours). No gameplay/data change, sim:balance not needed. Not verifiable on a real device here.

- Round 7: tree green (tsc, lint, 464 tests, build). Backlog 1-5 complete; no further code change. Remaining items need real devices (governor tuning) or a Lighthouse binary.

- Round 8: tree green (tsc, lint, 464 tests, build). Backlog 1-5 complete; no code change. Open items still need real devices (governor tuning) or a Lighthouse binary.

- Round 9: tree green (tsc, lint, 464 tests, build). Backlog 1-5 complete; no code change. Trial merge check against campaign/content branches (git merge-tree) was blocked by sandbox permission, so merge conflicts in src/style.css / src/ui are unchecked; lead should expect to resolve those by hand if any. Open items still need real devices (governor tuning) or a Lighthouse binary.

- Round 10: tree green (tsc, lint, 464 tests, build). Backlog 1-5 complete; no code change. Open items still need real devices (governor tuning) or a Lighthouse binary.

- Round 11: tree green (tsc, lint, 464 tests, build). Backlog 1-5 complete; no code change. Open items still need real devices (governor tuning) or a Lighthouse binary.

- Round 12: tree green (tsc, lint, 464 tests, build). Backlog 1-5 complete; no code change. Open items still need real devices (governor tuning) or a Lighthouse binary.

- Round 13: tree green (tsc, lint, 464 tests, build). Backlog 1-5 complete; no code change. Open items still need real devices (governor tuning) or a Lighthouse binary.

- Round 14: tree green (tsc, lint, 464 tests, build). Backlog 1-5 complete; no code change. Open items still need real devices (governor tuning) or a Lighthouse binary.
