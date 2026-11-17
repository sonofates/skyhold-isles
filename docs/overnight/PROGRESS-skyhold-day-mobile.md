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

## Next
- Backlog 4: HUD polish on phones (wave preview / ability buttons / toasts overlaps at 360x640, 844x390; safe-area), settings
  modal at 390 wide with 4 quality buttons (check screenshot), tablet HUD.
- Save before/after screenshots of all islands into docs/overnight/mobile-shots/ (< 5 MB total).
- Pinch-zoom feel check, `?perf`-style frame-time readout (optional), Lighthouse-style sanity check.
- Run `npm run sim:balance` once at the end (no gameplay/data changes were made).

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
