# PROGRESS — skyhold-n2-opus (Opus overnight UI/UX, branch hermes/skyhold-n2-opus, base art-2d)

(A pointer copy lives at docs/overnight/PROGRESS-skyhold-n2-opus.md — this file is the real one.)

## Backlog status
1. Skill tree fits / scrolls obviously — DONE (round 1)
2. Title screen + loading — DONE (round 1)
3. Credits screen + pause menu — DONE (round 1; the pause menu already had Resume / Restart /
   Settings / World Map, audited 0 problems, Credits also reachable from in-run Settings)
4. Keyboard / gamepad navigation — DONE (round 1)
5. Accessibility (colour-blind cues, UI scale, text size) — DONE (round 1)
6. Juice + feel pass — DONE (round 1): boot/veil transitions, level-up fanfare, wave-start ease
   (press feedback + star reveal already existed)
7. uiaudit + hudCheck after each change; shots into docs/overnight2/opus-shots/ — DONE for round 1:
   full uiaudit on a frozen build (468 screens = 39 × 6 sizes × EN/TR): **0 problems** (11 screenshot
   timeouts at load ~28 re-run clean: uiaudit-report-rerun.txt + brief-modes alone). Report
   `opus-shots/uiaudit-report.txt`, shots `opus-shots/audit/` (TR/EN, 2000x991 + 844x390).

## Round 2 (quality passes)
- Settings → Controls: controller caps (round coloured A / B / X / Y, dark pills for LB/RB/LT/RT,
  D-pad, stick, Start); sections flow in balanced CSS columns (Keyboard, Mouse, Replay | Menus,
  Controller, Controller in battle) instead of a grid with holes. `qa/ctlshot.mjs` (top + scrolled
  end, column heights). uiaudit settings-controls 12/12 0 problems. Shots opus-shots/*controls*.
- Title stand-in logo → painted lettering (`titleLetters`, `letterArc` in titleScreen.ts): one span
  per letter on an arc, dark-gold body with a stroke outline (`paint-order: stroke fill`) + carved
  extrude, cream→gold gradient face (`::after` with background-clip text), staggered drop-in.
  Perf trap found: `animation-fill-mode: both` kept 15 letter layers alive → 218 ms/frame under an
  open board in SwiftShader; `backwards` → 17 ms. `qa/titleperf.mjs` measures it.
  uiAuditLib: one word's tilted `data-c` letters are exempt from overlap/overflow (false positives).
  titleprobe 0 problems at 2000x991, 1366x768, 932x430, 844x390 × EN/TR × save/fresh.
- Pause: warm shade (`PAUSE_DIM`, alpha 0.3) over the battlefield under the canvas HUD while the
  "Paused" plate shows (hud.ts `pauseDim`). uiaudit hud-pause 6/6 0 problems.

- Daily board: the four counters (reward / streak / best / wins) are parchment tokens with a rim,
  the reward one gold; the difficulty · date line no longer comes out as big as the name on phones.
  uiaudit daily + end-daily 24/24 0 problems.
- Keyboard / pad reachability. New `qa/navsweep.mjs`: on every board (map, title, credits, briefings,
  workshop, heroes, hero picker, logbook ×2, daily, settings ×4, store, story book, Codex) walks the
  arrow-key focus graph breadth-first and lists controls no arrow path reaches; checks ↓ scrolls a
  long board to its end and Esc closes it. Found + fixed:
  - Logbook isles (25 rows), Controls tab, Credits had no way to scroll by keys/pad (no buttons in
    the text) → `navMove`: ↑/↓ at the edge scroll the scope's main scroller (`scopeScroller`, half
    a screen per press, smooth unless reduced motion).
  - Phone briefing: the hero chip's Change / Skills were unreachable (Play's same-row neighbour 3 px
    higher counted as "up") → `pickInDirection` first tries boxes beyond the edge (¼ overlap
    allowed), then falls back to centres.
  - Phone map: islands i11+ unreachable (the pan arrow sat between islands and swallowed →) → pan
    arrows get `data-nav-skip`; a focused island scrolls to the middle (`inline: 'center'`).
  Result: 0 problems at 1920x1080, 1366x768, 844x390 (TR); navprobe still 0.

- Workshop: the effect line reserves two lines → the three columns' cards line up in rows; card
  spacing trimmed so the board (with its "invested · earned" line) fits 2000x991 without a scroll.
- End board: the glowing medallion (`primaryEndAction`) is Retry after a defeat (was always Next
  isle, which glowed even on a loss); gold retry arrow on it. Pad: when the board appears the
  reticle jumps to that button (`EndPanel.primaryAction`, padTargets lists it first); navprobe
  checks won + lost.

- Codex: the foe detail shows the kind marks (crown / wing / shield, `foeMarks`) before its tags —
  the place to learn them. uiaudit gained `hud-codex` (in-run Codex board): 12/12 0 problems.
  `qa/codexmarks.mjs` (boss → crown+shield, flyer → wing, brute → shield).
- Title: with a controller connected the prompt says "Press A to start" / "Başlamak için A tuşuna
  bas" (`gamepadconnected` or a pad already listed); navprobe checks it.
- Battle loading screen (2d.html boot while a level loads): "Course set for <island>" / "Rota:
  <ada>" and a parchment "Tip" card with one of 13 tips (`LOAD_TIPS`, `loadtip.1..13`, facts taken
  from the Codex tower/foe texts, the Workshop and hero texts). Not for `bench` / `ab`. Shots
  opus-shots/loading-*. `qa/bootshot.mjs` holds the map painting back to catch the screen.
- World map juice: a newly reached island unveils once (padlock tips off, fog swells away, a flash
  grows into a gold halo, medal bump) and stars won since the last visit drop onto their island one
  by one. localStorage `skyhold2d_map_unlock_seen_v1` / `skyhold2d_map_stars_seen_v1`; nothing on a
  first visit (so every QA script with a fresh profile sees the plain map), nothing with reduced
  motion. Overlays clean up on the burst's `animationend`. `qa/unveilshot.mjs` freezes the
  animations at set times (strip: opus-shots/map-stars-unveil-strip.png). Unit tests.
- Full uiaudit re-run on a frozen build (`/tmp/n2opus-audit-dist`, port 4418) started 04:30 — see
  below for the result.

## Next ideas
- Swap in Codex's title paintings when they land (keys in Requests); re-shoot the title.
- Wave-start ease / boot fade / veil: only checked by code + unit tests, not filmed (headless frames
  are too slow to judge motion) — worth a look on a real device.

## Done
- **Skill tree fit** (round 1). Was cut by 133 px at 2000x991, 183 px on 844x390.
  `heroScreens.ts` `fitTree` / `pickTreeFit` / `TREE_FIT_STEPS`: tries the vertical tree at node
  zoom `--tz` 1 → 0.83, then an **across** layout (one row per branch, tiers left→right, capstone at
  the right end on a bracket, JS places the bracket at the medal centres) at 1.15 → 0.74. Scale-
  corrected measurements (the board pops in with a scale animation). Refits on window resize.
  Node text keeps ≥ 90 % size (`--nt`). Branch head = icon beside the name, blurb reserved 2 lines
  (the three columns' tier 1 line up). Picked-node outline no longer touches the name.
  Result (`qa/treeprobe.mjs`, 9 sizes × EN/TR, bran + mira): everything fits, no scroll — desktop
  16:9 uses `down` at 0.88–1, 1024x768 `down` 1, phones `across` 0.93–1.15.
  uiaudit heroes + heroes-node (6 sizes × 2 langs): 0 problems. Shots: docs/overnight2/opus-shots/tree-*.
  Tests: tests/render/n2Ui.test.ts.
- **Title screen + loading** (round 1). `src/render2d/ui/titleScreen.ts/.css`, wired in `main2d.ts`
  (`runTitleScreen`). Shown once per browser session on a plain `2d.html` launch (sessionStorage
  `skyhold2d_title_seen_v1`; back from an island → straight to the map). Skipped by game deep links
  (`?level=` etc. — checked before), `?screen=` / `?store=` / `?mockislands=`, `?title=0` and
  **automated browsers (`navigator.webdriver`)** so every existing QA script keeps landing on the map;
  `?title=1` forces it, `&titlemenu=1` jumps to the menu (QA), `window.__title.state()`.
  Key art: `paintedUi.title.keyart` (or flat `title-keyart`) when Codex adds it (slow swell + pointer
  parallax); until then a stand-in from the game's own paintings — sea, keep isle (l1c), windmill isle
  (i05), two far isles (i02, i14, desaturated), a sailing ship, three drifting clouds, each layer with
  its own depth. Logo: `paintedUi.title.logo` / `logoTr` (TR first in Turkish) else big Fredoka
  lettering + tagline on the painted ribbon (padding fitted to the ribbon's cloth in JS).
  Loading: plank-framed gold bar with a sheen, weighted tasks (manifest, worldMap chunk, the title's
  and the map's first paintings + 8 isle thumbs), min ~0.9 s so it never flashes. Then
  "Tap to start" (touch) / "Click or press any key" (desktop) → menu: Continue (with "N isles
  cleared · N stars") + New game (confirm board "Start over?" — resetProgress2D keeps the backup) or
  just "Set sail" on a fresh save; Settings, Credits. Arrows/WASD walk the menu. Touch bug caught by
  the probe and fixed: the tap that opens the menu no longer presses the plank under the finger.
  A language switch made in the title's Settings reloads into the title with Settings open
  (`SettingsContext.reloadTo`). Reduced motion stops every drift/bob/parallax.
  QA: `qa/titleprobe.mjs` (loading → tap → menu → Credits → New game confirm → Continue → map, 5
  sizes × EN/TR × save/fresh): 0 problems; uiaudit `title`, `title-fresh`, `credits`,
  `settings-general`, `map` (6 sizes × EN/TR): 0 problems.
- **Credits** (round 1). `src/render2d/ui/credits2d.ts/.css`: team (placeholder), painted art, tools
  (PixiJS, TypeScript/Vite/Vitest, Capacitor/Electron/steamworks.js), lettering (Fredoka © 2016 The
  Fredoka Project Authors, SIL OFL 1.1 — from node_modules/@fontsource-variable/fredoka/LICENSE; the
  'Fredoka TR' faces, same licence), Kenney Tower Defense Kit CC0 (from CREDITS.md). From the title,
  Settings → General ("Credits — Show") and `?screen=credits`.

- **Keyboard / gamepad navigation** (round 1).
  Menus: `src/render2d/ui/navFocus.ts` (installed once in main2d). Scope = topmost board
  (`.pu-overlay`), else the title, else the pause menu, else the world map. Arrows / WASD = spatial
  focus move (`pickInDirection`), Enter / Space press; first key lands on the scope's default
  (`data-nav-default` — the map's next island —, the glowing primary plank, a confirm's safe choice).
  Sliders and `data-nav-keep` rows (briefing difficulty) keep ← →. Space in the pause menu only
  resumes. Painted gold focus ring only in key/pad mode (`html.pu-kbd`, off on any pointer press);
  map islands use an `::after` ring under their name tag / stars (outline was hidden by children).
  Gamepad API polling (standard mapping): D-pad / left stick (repeat 380 ms then 110 ms) move,
  A press (presses the default when nothing is focused), B = Esc, LB / RB = prev / next tab
  (`[role=tablist]`), Start = pause / press.
  In battle: `src/render2d/ui/padCursor.ts` — a gold reticle that is a **virtual mouse** (synthetic
  pointer events on the canvas), so ring / tower card / hero / rally / ability + hero-skill aiming /
  end board all work through their existing handlers. `Game2D.padTargets()` gives snap targets
  (plots + hero; ring tokens when open; end board buttons) or free mode (hero move, rally, aiming:
  analog stick glide, arrows step). `Game2D.padClickPoint()` snaps a hero move order onto the
  nearest road. Pad: A click, B back, X wave, Y hero (reticle jumps to it), LB / RB Meteor /
  Overcharge, LT / RT hero skills, Start pause. Keyboard in battle: arrows move the reticle, Enter
  clicks (WASD stay ability/hero keys). A real mouse / finger hides it.
  Settings → Controls lists Menus, Controller, Controller in battle, and the battle cursor keys.
  QA: `qa/navprobe.mjs` (map, briefing, Settings tabs/slider/back with a fake pad, title, pause,
  in-run ring/build/hero glide/move, keyboard cursor): 0 problems. Note: in software GL a run
  renders at a few fps, so a short fake press can fall between two polls — the probe holds presses
  250–450 ms and falls back to `__p0.padClick()` to tell a missed poll from a logic bug.
  Tests: n2Ui.test.ts (pickInDirection, keyDir, stickDir, repeatDue).

- **Accessibility** (round 1). Shape marks (`ui/foeMarks.ts`: crown boss / wing flyer / shield
  armour ≥ 5) on the next-wave chips and the foe card face — the blue / red backdrops no longer carry
  it alone (elites already had a star). New SVG glyphs `wing`, `shield` (paintedIcons.ts).
  **Interface size** 90–130 % (Settings → General slider, `GraphicsSettings.uiScale`, live): CSS `--s`
  via `--ui-scale` on <html>, and the same factor in `uiLayout.uiScale`, `hudDock.uiUnit`,
  `hudButtonsKeepOut`, `laneMarks2d.kitUnit` (`setUserUiScale`). Never below the phone floor
  (8.5 px unit / 0.5 layout) — going under it made chips collide. `qa/scaleprobe.mjs`: 130 % at
  2000x991 / 1366x768 / 844x390 × i02, i09, l1c → hudCheck overlaps 0, outside 0, canvas text 0, DOM
  0 (map shrinks to keep the bigger HUD clear: phone coverage 0.48–0.70). Tree at 130 % phone: extra
  across zoom steps down to 0.5. Text size: `qa/textsize.mjs` — floors at 10 px for the level badge
  digits, XP bar text, the tree's "N of N spent" (was 7.1 px on a phone).
- **Juice** (round 1). `ui/transition2d.ts`: 2d.html boot is now the sea gradient + gold spinner ring
  (was plain "Loading…" on flat green) and fades out (`dismissBoot`, renames `#boot` at once so QA
  waits are unchanged); map → battle / battle → map / Next isle / Daily go through
  `navigateWithVeil` (same look fades in first, bfcache-safe). End board: gold ring + 12 sparkles
  burst from the hero portrait when the XP bar crosses a level (`drawLevelBurst`, not with reduced
  motion; `qa/lvlupshot.mjs`). Wave start: `waveEaseZoom` — 1.2 % breath of `map.root` over 0.9 s
  about the screen centre (HUD unaffected; off with camera shake off or reduced motion).

## Decisions
- Round 1: PROGRESS file lives in docs/overnight2/ (backlog says so); the runner header names
  docs/overnight/ — a pointer file there points here.
- Skill tree: switching to a left-to-right layout on short screens beats shrinking the vertical tree
  below ~0.83 (text would get tiny on phones).
- Title once per session (not every map visit), automation skips it — keeps all agents' QA stable.
- No company/brand name in the credits (owner's brand question is open per global notes): the team
  line is a placeholder "The Skyhold Isles team".
- Licences named from memory and not re-verified online: PixiJS MIT, TypeScript Apache-2.0, Vite /
  Vitest / Capacitor / Electron / steamworks.js MIT (worth a check before release).

- Pad B in battle sends a synthetic Esc: it closes ring / hero / aim but never pauses (game2d only
  pauses on a trusted Esc) — Start pauses. Documented as "Back / close".
- Hero-move / skill / ability aim hints: in key/pad mode the second line explains the cursor
  (`hero.moveHintPad`, `hero.aimHintPad`).
- Pad reticle snap targets also include the HUD's DOM buttons (Settings, Codex, hero portrait,
  skills, abilities, wave chips) and the canvas horn / pause / speed; A / Enter over a DOM button
  presses it (so the Codex is reachable by pad).
- Boards now fade + shrink out on close (0.16 s, `.pu-overlay.closing`, skipped by navFocus; none
  with reduced motion).

## Problems / notes
- Env: `npm ci` needed in a fresh worktree; `npm install --no-save playwright` for QA. Gate:
  `python3 qa/gate.py`. QA via `python3 qa/withPreview.py --port=4417 node qa/x.mjs`.
- Build notes: only the two old INEFFECTIVE_DYNAMIC_IMPORT notes (levels2d, codex2d).

## Requests for other agents
- Codex (art): title paintings are read from `paintedUi.title = { keyart, logo, logoTr }` (paths
  relative to /art2d/, like the rest of paintedUi) — flat `title-keyart` / `title-logo` /
  `title-logoTr` keys also work. Key art: landscape, the centre-bottom ~40 % stays calm (menu sits
  there), top ~30 % calm-ish for the logo. Logo: transparent PNG/WebP, wide (≈ 2.6:1).
