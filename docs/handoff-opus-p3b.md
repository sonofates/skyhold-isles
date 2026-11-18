# Handoff — P3 UI round 2: run modes in the painted front end — branch `hermes/skyhold-p3b-modes-ui`

Base: `art-2d` (after the `agy` modifiers merge, `23a366d`). UI only. No changes to `src/sim`, `src/data`, `tools`,
`src/platform`, `desktop` or `game2d.ts`. The logic in `modes2d.ts` / `progress2d.ts` is only called, never changed.

## What was built

1. **Briefing card** (`ui/briefing.ts`, wired in `ui/worldMap.ts`)
   - Once an isle has been won: a third column with **Challenges** (one medallion switch per `availableChallenges`
     entry: the rule seal (crossed-out tower / purse / glyph), name, rule text, and the badge state: medal +
     "Earned" or kit star "+1"; a header shows `n/2 badges`) and **Endless** (`canPlayEndless`): "Endless tide",
     best wave in the header, medal tier (Bronze/Silver/Gold gem) and the next medal's goal
     ("Silver: clear wave 16 (3 more)").
   - Several challenges can be on together. Endless runs without challenges, so switching Endless on clears them
     and switching a challenge on clears Endless. A switch that is on gets a gold glow, the kit's green check and
     red-brown lettering.
   - Play reads "Replay · Campaign", "Replay · 2 challenges" or "Set sail · Endless". It builds the URL with
     `buildRunHref2D(id, { challenges, endless, intro: clears === 0 })`.
   - Isle open but not won yet: a lock line "Win this isle once to open its challenges and Endless".
2. **End panel** (`endPanel.ts`, `ui/modeBits.ts`, `main2d.ts`)
   - `EndPanel.annotate(note)`: main2d records the run (`recordRunOutcome`) and then puts the result on the board.
     The text comes from the pure `endNoteFor(...)`:
     - new badge(s): "Badge: Glass Sanctuary +1★" (+ "· Isle mastered!" when this run mastered the isle),
     - challenge won but its badge was already earned: "Challenge won: Bowless",
     - Daily: "Daily Squall won +1★ · 3-day streak", or "Daily Squall won · reward taken today",
     - Endless: the title becomes "Endless Run" on the victory board art, the summary reads "Wave 17", the caption
       says "New best: wave 17! · Silver medal" or "Best: wave 25 · Gold medal". If the run fell during the
       story waves: "Wave 6/10 · Records start past wave 10".
   - Reward lines are bold red-brown; the caption is fitted to the panel width.
   - HUD (`hud.ts`): `setEndless(storyWaves)`. In an Endless run the banner reads "Wave n/10" through the story
     waves, then "Endless · Wave 12". Before, the sim's growing `totalWaves` made it show "Wave 12/12".
3. **Logbook** (`ui/metaScreens.ts`)
   - Each won/open isle row shows its two challenge badge seals (full colour once earned, grey otherwise; tooltip
     and aria give the rule), the Endless best ("W14" with a tier-coloured gem) next to stars, lives and wins.
   - Two new totals: Daily streak ("0 · day streak · best 5", from `liveStreak`) and Endless medals (sum of tiers
     across isles / 3×isles). Big screens show the six totals as two rows of three; phones keep one row.
4. **Daily screen**: already used `dailyForToday`. I checked it at all three sizes (isle medallion, difficulty + UTC
   date, the two rule seals with text, reward / streak / best / won figures, "Set sail · Win once today for +1★").
   No change was needed.
5. **World map with 17+ isles** (`ui/worldMap.ts`, CSS)
   - The existing layout already spaces nodes at ≥1.6 D (D = node diameter) with alternating heights and scrolls
     sideways. New tests check 9/17/24 isles at the three sizes.
   - Added for mouse users: **drag-to-pan** (a drag never opens a card), painted **edge arrows** (round kit buttons,
     shown only while more of the route lies that way, nudge 3 times and then stop), **←/→ keys**. Touch keeps native
     panning. Opens centred on the frontier as before.
   - Fixed: Enter on a focused island button used to open the frontier card as well as that island's card.
6. **Settings**: Volume and Sound are kept (the shared settings the 3D build uses) but dimmed, each with a muted-
   speaker glyph and "No sound in the painted isles yet" / "Kept for when painted-isle sound arrives". Shake, damage
   numbers and vibration work in 2D now (agy's wiring), so they stay as they are.

## Files

- New: `src/render2d/ui/modeBits.ts` (pure wording: Endless record, tier names/colours, `endNoteFor`),
  `tests/render/modesUi2d.test.ts` (17 tests).
- Changed: `ui/briefing.ts`, `ui/worldMap.ts`, `ui/metaScreens.ts` (logbook, settings, exported `ruleSeal`),
  `ui/inGame.ts` (`isMastered`, re-exports `endNoteFor`), `ui/paintedIcons.ts` (`next`, `mute`), `ui/paintedUi.css`,
  `endPanel.ts` (`annotate`, note in `debug()`), `hud.ts` (`setEndless`, `waveLabel`), `main2d.ts` (record → annotate,
  HUD flag, QA hooks `__p0.skipToWave` / `__p0.hudWave`).
- QA: `qa/p3shots.mjs` (mode seeds; real recording paths for the challenge / Daily / Endless boards; every shot at all
  three sizes; ignores the headless `navigator.vibrate` notice), `qa/p3flow.mjs` (+14 mode checks).
- Shots: `docs/p3-shots/*.jpg`, 78 files = 26 screens × phone 844×390, desktop 1600×900, ultrawide 2560×1080. New ones:
  `map-17`, `brief-modes`, `brief-endless`, `brief-first`, `daily-modes`, `end-challenge`, `end-daily`, `end-endless`,
  `game-endless-hud`.

## Verification

- Gate: `npx tsc --noEmit` ✓ · `npm run lint` ✓ · `npm test`: **78 files passed (1 skipped), 982 passed / 11 skipped**
  · `npm run sim:balance`: **PASSED, 25/25 levels** · `npm run build` ✓.
- `node qa/p3flow.mjs --base=<vite>`: **34/34 checks pass**. They cover: challenge switches; Endless and challenges
  turning each other off; Play → `?level=l1c&challenge=glassSanctuary`; forced win → board shows "Badge: Glass
  Sanctuary +1★" and the save has the badge; logbook shows it; Endless card → `?level=l1c&endless=1` → HUD
  "Endless · Wave 12"; Daily Set sail → `?daily=1`; mouse drag pans the 17-isle map without opening a card; the edge
  arrow pans.
- `node qa/p3shots.mjs --base=<vite>`: no painted element outside the viewport, no overflowing plank text, no
  overlapping isle nodes, no console errors. I looked at the shots and fixed what I saw:
  - duplicated Play label,
  - Endless medal gem greyed by the switch filter,
  - "not won" wrapping on phone,
  - settings note under the corner bracket,
  - logbook totals under the ribbon tails,
  - Endless board too top-heavy.
- Playwright: `npm install --no-save playwright` (not in package.json).

## Doubts / open questions for the owner

- **Islands i09–i16** were not in this base. The map is tested with `?mockislands=8` (17 isles) and the layout tests go
  up to 24. Nothing in the UI hard-codes the island count.
- **"Continue in Endless" after a Victory** (handoff idea): not added. The end panel's buttons and its flow live in
  `game2d.ts`, which is not my file. Endless starts from the briefing card instead.
- **Endless mutators** (`endlessMutatorsAt`) are not shown on the board or the HUD yet; that needs a small HUD
  chip design.
- **Silent Skies** is offered as a challenge even though 2D has no ability buttons, so it is a free badge
  (agy's question 2 still stands).
- **Daily share text** (`dailyShareText`) is not wired: no share button in the painted kit yet.
- Challenge picks are not remembered between card openings, and Retry keeps them (URL); the next card starts
  in Campaign. Say if you want them sticky.
- The card's Endless rule line wraps to two lines on phone. It reads fine but is the tallest row; a shorter line
  would need copy from you.
