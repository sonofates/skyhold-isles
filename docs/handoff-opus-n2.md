# Handoff — Opus overnight UI/UX (n2)

Branch `hermes/skyhold-n2-opus` (base `art-2d` 59921e7). Not merged, nothing deployed.
Round log + decisions: `docs/overnight2/PROGRESS-skyhold-n2-opus.md`. Shots: `docs/overnight2/opus-shots/`.
Not touched: `src/sim/**`, `src/data/**`, `tools/**`, `public/art2d/**`, `towerLayer.ts`,
`enemyLayer.ts`, `src/platform/**`, `qa/bot/**`.

## What changed (player-facing)

| Area | Before | Now |
|---|---|---|
| Skill tree | Capstone cut off below the board (133 px at 2000x991, 183 px on phones) | Fits at every size: vertical tree with a node zoom where it fits, a left-to-right tree (branches as rows, capstone on a bracket at the right) on short screens |
| Launch | Straight into the world map; plain "Loading…" on flat green | Title screen: stand-in key art from the game's own paintings with depth parallax, the name lettered over the tagline ribbon, a painted loading bar, "Tap to start", Continue (isles + stars) / New game (confirm, keeps a backup) / Settings / Credits. Uses `paintedUi.title.{keyart, logo, logoTr}` as soon as they exist |
| Credits | — | Credits board (team placeholder, tools, Fredoka OFL, Kenney CC0) from the title, Settings → General, `?screen=credits` |
| Keyboard / controller | Mouse / touch only (a few hotkeys) | Every menu walks with arrows / WASD / D-pad / stick (gold focus ring), A / Enter press, B / Esc back, LB / RB tabs, Start pause. In battle a gold reticle (virtual mouse): plots, build ring, tower card, hero (Y) with road snap, abilities (LB / RB), hero skills (LT / RT), call wave (X). Listed in Settings → Controls |
| Accessibility | Flyer / boss told by backdrop colour only | Wing / shield / crown marks on wave chips and the foe card; Interface size 90–130 % (menus + battle HUD, live); small text floors at 10 px |
| Feel | Hard cuts between pages; boards vanished | Boot screen and a matching veil fade between map and battle; boards fade out; hero level-up burst on the end board; a soft camera breath when a wave starts (all off with Reduced motion) |

## How it is built
- `ui/heroScreens.ts` `fitTree` / `TREE_FIT_STEPS` (layout + zoom chosen by measuring, refits on resize).
- `ui/titleScreen.ts` (`runTitle`, `shouldShowTitle`: once per session; deep links, `?screen=`, `?title=0`
  and automated browsers skip it; `?title=1` forces), wired in `main2d.ts runTitleScreen`.
- `ui/navFocus.ts` (scope = topmost board / title / pause menu / map; spatial pick; Gamepad API loop),
  `ui/padCursor.ts` (synthetic pointer events on the canvas) + `Game2D.padTargets()` / `padClickPoint()`.
- `ui/foeMarks.ts`; `GraphicsSettings.uiScale` → `--ui-scale` + `uiLayout.setUserUiScale` (the phone
  floor 8.5 px / 0.5 is kept).
- `ui/transition2d.ts` (`navigateWithVeil`, `dismissBoot`), `EndPanel.drawLevelBurst`,
  `uiLayout.waveEaseZoom`.

## QA
- Gate (`python3 qa/gate.py`): GATE OK on every commit.
- New probes: `qa/treeprobe.mjs`, `qa/titleprobe.mjs`, `qa/navprobe.mjs` (fake gamepad),
  `qa/scaleprobe.mjs`, `qa/textsize.mjs`, `qa/lvlupshot.mjs`. uiaudit gained `title`, `title-fresh`,
  `credits`. Full audit report: `docs/overnight2/opus-shots/uiaudit-report.txt`.
- Unit tests: `tests/render/n2Ui.test.ts`.

## Open points
- Title key art / logo are stand-ins until Codex's paintings land (keys above).
- Credits team line is a placeholder; licences named from memory (PixiJS MIT, TypeScript Apache-2.0,
  Vite / Vitest / Capacitor / Electron / steamworks.js MIT) — verify before release.
- In software GL (headless QA) a run draws a few frames a second, so fake pad presses can fall
  between polls; `navprobe` falls back to `__p0.padClick()` to tell a missed poll from a bug.
- At 130 % interface size on phones the map shrinks more to keep the bigger HUD clear (coverage
  0.48–0.70); by design.
