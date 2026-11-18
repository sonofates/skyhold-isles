# Handoff — P3 UI (2D world map, story panels, meta screens) — branch `hermes/skyhold-p3-ui`

Base: `art-2d`. UI only: no changes to `src/sim`, `src/data`, `tools`, tower layers, `src/platform`, `desktop`.

## What was built

1. **World map / island select** (`2d.html` without `?level=` or any debug param)
   - Painted sea (placeholder canvas painter), islands as medallion nodes along a dotted route (left → right,
     meandering; scrolls sideways when it does not fit, wheel scrolls it too, opens centred on the frontier).
   - Per island: stars (kit stars), lock + desaturated art when locked, "you are here" rally flag on the frontier,
     crown when mastered, gold name tag with the island number.
   - Iterates `LEVELS_2D` only — new islands appear automatically. Islands without painted map art get a grass mound.
   - Tap → **briefing card** (ribbon board): name, subtitle, difficulty gem, waves, best stars + 3★ goal, best lives /
     wins, Play / Replay (locked: disabled "Locked · Win X first").
   - Top bar: title banner, star tally, round buttons Workshop (affordable-upgrade badge), Logbook, Daily (red dot when
     today's squall is open), Settings.
   - `?level=` deep links skip the map unchanged; old debug URLs without `level` (`?speed=2`, `?bench=150`, …) still
     start l1c (`GAME_PARAMS` list in `main2d.ts`).
2. **Story panels**: 2–3 storybook panels (vignette of the island's own map + caption, revealed one by one; Next / Skip,
   tapping the strip also advances). Shown before an island's first play (map → Play and end panel → Next Isle add
   `&intro=1`; the game is paused behind it) and after a win (once per island). Seen-flags in localStorage.
3. **Meta screens** (painted views, logic from the 3D build's modules): Workshop (`data/workshop` buy/refund rules,
   `starWallet`), Logbook (Islands ledger + Feats via `game/feats.featStatuses(progress, LEVELS_2D)`), Daily Squall
   (`data/daily.dailyChallengeFor`, `liveStreak`), Settings (`platform/storage` `loadSettings/saveSettings`: volume,
   sound, shake, damage numbers, vibration, plus "Reset isles progress").
4. **Painted Codex button**: round kit button with a book glyph + caption, placed by the same layout function as the HUD's
   pause/speed (`hudButtonsLayout` in `uiLayout.ts`, now also used by `hud.ts`), so it stays in the row on every size.
5. **End panel**: Retry / **Next Isle** / **World Map** (folded-chart glyph). Next Isle shows only when the next island is
   open (or this win just opened it).

## Files

New (`src/render2d/ui/`): `paintedUi.css` (all styles; kit pieces 9-sliced with `border-image`), `dom.ts` (builders:
sheet, plank, round button, stars, medallion, toggle, slider), `paintedIcons.ts` (placeholder glyphs), `worldMap.ts`,
`mapLayout.ts` (pure), `seaPainter.ts`, `briefing.ts`, `storyPanels.ts`, `storyBeats.ts`, `metaScreens.ts`,
`progress2d.ts` (save adapter), `islandArt.ts`, `inGame.ts` (routing helpers for main2d).
Changed: `src/render2d/main2d.ts` (map route, end-panel hooks, win recording, intro/outro), `codex2d.ts` (painted button),
`endPanel.ts` (labels + map glyph), `hud.ts` + `uiLayout.ts` (shared `hudButtonsLayout`).
Tests/QA: `tests/render/p3Ui2d.test.ts` (24 tests), `qa/p3shots.mjs` (screenshots + bounds/overlap checks),
`qa/p3flow.mjs` (end-to-end flow). `qa/uishots.mjs`, `qa/uiprobe.mjs`, `qa/hudshot.mjs`: now open `2d.html?level=l1c`
(bare `2d.html` is the map now).
Docs: `docs/p3-art-needs.md`, `docs/p3-shots/*.jpg` (40 shots: 844×390 phone, 1600×900, and 2560×1080 for the map /
workshop / story / end panel).

## Verification

- Gate: `tsc --noEmit` ✓ · `lint` ✓ · `npm test` **897 passed, 11 skipped (74 files + 1 skipped)** · `sim:balance`
  **PASSED, 17/17 levels** · `build` ✓.
- `node qa/p3flow.mjs --base=…` **20/20 checks pass**: map → brief → Play (&intro=1) → intro story (game paused) → Skip →
  forced win → win saved in the 2D save, outro story → World Map → map shows the stars; replay has no intro; Codex button
  present; `?speed=2` still opens the game; the four meta screens open/close (Escape); a Workshop buy spends a star.
- `node qa/p3shots.mjs --base=…`: no element of the painted UI outside the viewport, no overflowing button text, no
  overlapping nodes, no console errors. I looked at the shots and fixed what I saw (missing button backgrounds from a CSS
  reset, close button position, vignette sizing during the pop-in, phone frame brackets over text).
- Playwright was installed with `npm install --no-save playwright` (not added to package.json).

## Decisions / doubts (please review)

- **Separate 2D save.** `LEVELS_2D` is not `LEVELS`; the campaign save is indexed by `LEVELS`, so 2D results go to
  `skyhold_isles_progress2d_v1` (same `ProgressData`, created/migrated by `platform/storage`, wins by `applyWin`). The id
  order is stored too and records are remapped by id if another agent reorders/inserts islands. When 2D replaces the 3D
  campaign, decide whether to merge this into the main save.
- **Workshop and Daily don't affect 2D runs yet.** `Game2D` builds `new SimWorld(level, events)` without run modifiers,
  and `game2d.ts` isn't one of my files. Workshop purchases are saved but have no effect in play. The Daily screen is
  complete, but its "Set sail" button is disabled ("Opens when painted runs get challenge rules"), so it never starts a
  plain run that would be credited as a daily. Needed: a `modifiers` option on `Game2D` passed to `SimWorld`; then
  `main2d` passes `workshopModifiers` + `challengeModifiers` (as `gameSession.buildRunModifiers` does) and records
  `applyDailyWin`. Briefing challenge toggles and Endless mode are left out for the same reason.
- **Story text is placeholder.** The level data has no story field. `storyBeats.ts` reads an optional `story: { intro,
  outro }` from the `LevelDef` (strings or `{ text, speaker?, focus? }`); until that exists, l1c uses 3 + 2 placeholder
  beats of my own (narrator "Warden Pell"). Content owner: add `story` to the level data and the type.
- Which runs count: only plain play (`?level=` with no debug/QA params). `?end=`, bench, autoplay, zoo, etc. record nothing.
- Settings: quality is not shown (3D only). The other toggles are the shared `GameSettings`; the 2D renderer does not read
  them yet (no audio, shake or damage numbers in 2D so far).
- Meta screens are DOM over the canvas (like the existing codex), not Pixi: text-heavy, scrolling and accessible
  (roles, focus outlines, Escape). The codex screen itself still uses the 3D build's stylesheet; only its button changed.
- QA-only params: `?screen=brief|workshop|logbook|daily|settings[&island=N][&tab=feats]`, `?mockislands=N` (stand-in islands
  to check a long route), `?story=intro|outro`.

## Open / not done

- All painted art listed in `docs/p3-art-needs.md` (sea chart, island tokens, icon set, story vignettes are the big ones).
- Wiring run modifiers in `Game2D` (above), then enable the Daily button and the challenge / endless options in the briefing.
- No sound on map / UI actions (no 2D audio layer yet).
