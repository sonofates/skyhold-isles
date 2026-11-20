# PROGRESS — skyhold-n2-opus (Opus overnight UI/UX, branch hermes/skyhold-n2-opus, base art-2d)

(A pointer copy lives at docs/overnight/PROGRESS-skyhold-n2-opus.md — this file is the real one.)

## Backlog status
1. Skill tree fits / scrolls obviously — DONE (round 1)
2. Title screen + loading — DONE (round 1)
3. Credits screen — DONE (round 1); pause menu consistency — NEXT (a pause menu already exists:
   `runControls2d.ts mountPauseMenu` Resume / Restart / Settings / World Map under the Paused plate —
   check it against the title/credits look, keyboard focus, phone layout)
4. Keyboard / gamepad navigation — todo (title menu already walks with arrows/WASD + Enter)
5. Accessibility (colour-blind cues, UI scale, text size) — todo
6. Juice + feel pass — todo
7. uiaudit + hudCheck after each change; shots into docs/overnight2/opus-shots/ — ongoing

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

## Problems / notes
- Env: `npm ci` needed in a fresh worktree; `npm install --no-save playwright` for QA. Gate:
  `python3 qa/gate.py`. QA via `python3 qa/withPreview.py --port=4417 node qa/x.mjs`.
- Build notes: only the two old INEFFECTIVE_DYNAMIC_IMPORT notes (levels2d, codex2d).

## Requests for other agents
- Codex (art): title paintings are read from `paintedUi.title = { keyart, logo, logoTr }` (paths
  relative to /art2d/, like the rest of paintedUi) — flat `title-keyart` / `title-logo` /
  `title-logoTr` keys also work. Key art: landscape, the centre-bottom ~40 % stays calm (menu sits
  there), top ~30 % calm-ish for the logo. Logo: transparent PNG/WebP, wide (≈ 2.6:1).
