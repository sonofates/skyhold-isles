# Handoff — UI polish pass (owner feedback 2026-11-19)

Branch `hermes/skyhold-ui-polish` (base `art-2d` b679c6f). Not pushed, not merged, nothing deployed.
Owner screenshots: `docs/feedback/2026-11-19/`. Shots after the fix: **docs/ui-polish-shots/**
(TR + EN, 2000x991 + 844x390) and the audit report **docs/ui-polish-shots/report.txt**.
Not touched: `src/sim/**`, `src/data/heroes.ts` (agy's respawn work), `src/data/difficulty.ts` (read only).

## What the owner saw, and the cause

| Owner | Cause found | Fix |
|---|---|---|
| "ş looks off" (title, hero names) | **Fredoka has no ş Ş ğ Ğ İ at all** (its latin-ext subset is 30 glyphs); those letters were drawn in Trebuchet MS / sans-serif inside Fredoka words | `Fredoka TR` faces (public/fonts/fredoka-tr-{400,500,600,700}.otf, 3.8 KB each) built from Fredoka's own s/g/S/G/I + the cedilla of ç/Ç, a breve in Fredoka's stroke, the dot of Ö (`scripts/fredokaTr.mjs`); next to `Fredoka Variable` in every stack (paintedUi.css, HUD_FONT for canvas text), preloaded at boot. QA: `qa/fontprobe.mjs --shot=` specimen; the audit's font check finds no fallback letter |
| Text runs under the ribbon end (briefing description), boxes look squeezed | The board art (`end-panel.webp`) was 9-sliced 165/100/80: the ribbon's curled tails and the gold corner brackets sat in the stretched centre, so on a big board they grew into the content (several screens had their own "clear of the tails" padding hacks) | Re-sliced 206/146/84 (`--k` = css px per art px): tails + brackets live in the border at the art's own scale, the whole inner box is plain parchment; hacks removed (Settings/Store padding-top, first-row indent, phone 2.5 s side padding) |
| Text touching plank / tab ends | Planks had 0.4 s inner padding: lettering ran to the iron caps / tab notches | Kit padding scale: plank/tab `max(0.45em, 0.5 s)`, tally 0.4em, name tag 0.4–0.45em, store price tag, selector planks; tooltip-parchment cards 0.6 s / 0.8 s; HUD cards (wave / foe / new foe / coach / tips) 0.4 s / 0.65 s |
| Title banner too big, letters off the cloth | Fixed 24 s banner, 2.4 s lettering wider than the cloth between the knots | 5.8 s tall, 1.95 s lettering centred on the cloth; width fitted to the word (`titleBannerWidth`, ≤ 34 % of the screen, else a smaller size) |
| Hero card wrapping ("Bran Demirmeşe Kalkan / Şövalyesi"), "Kahramanın" spilling | Name + title on one ellipsis line, actions squeezing the text column | Name and title on their own lines; actions beside the text, or a row under it in a narrow card (container query); in a briefing with run modes the chip closes the modes column (both columns level, Play on screen); compact on phones (no kicker) |
| Badge "5" over "Yetenek ağacı" | Actions column shrank below its planks | `flex: none` for the actions |
| Horn bottom-right "doesn't feel right" | Horn lived in the dock corner since the full-bleed HUD | Beside the cave the next wave comes from (`hornSpot.ts`, `Game2D.placeHorn`) — see below |
| Skill tray: small skills, gaps, alignment | Portrait 1.3 d + margins + ring outside, skills d, uneven gaps; backing inset −0.04 d | Re-laid (see below) |

## Horn beside the cave
- `src/render2d/hornSpot.ts` (pure): rings 1.5–7.2 r around the visible mouth (where the next
  wave's road leaves the cave's front, on screen), nearest first, a small cost in front of the
  mouth; label + seconds above/below (`stack`) or beside the horn (`left`/`right`) where the
  stack does not fit. Must stay inside the safe insets, off the dock's other pieces (buttons,
  plaque, banner, tray, info card) and follow the hudCheck rules: never a plot, cave, the castle,
  a safe-area road, nor any road's **mouth** (first 7 road half-widths from each cave, also
  outside the safe area). None clear → the dock corner spot (which the fit keeps clear).
- The lane with most of the next wave's foes picks the cave; it moves when the next wave changes
  cave (multi-cave islands; the lane marks still show every cave). `state().hornSpot` = `cave` / `dock`.
- Label "Start!" / "Başla!" (17–22 px+, gold) and the early-call bonus "+N"; the seconds under it.
  Key **N** (tooltip says so). Coach mark, tooltip, gold pop, lane marks follow the horn.
- `qa/hornprobe.mjs`: all 25 islands × sizes — beside the cave on 23/25 islands at 1920x1080, 2000x991 and 1600x900, 21/25 at
  1366x768, 19/25 at 932x430, 17/25 at 844x390 (the rest keep the dock corner: no clear spot by the
  cave, e.g. l1c's cave sits between the road, a plot and the second cave); hudCheck overlaps 0,
  no HUD piece outside its slot, no canvas-text problem, on all 150 island × size runs.

## Hero + ability tray
- `hudDock.ts`: `TRAY_PORTRAIT` 1.18 d (HP ring inside that box), skills/abilities d, divider
  0.08 d, every gap = the dock gap, `TRAY_PAD` 0.14 d all round; the painted pill backing is the
  tray slot exactly. d = 50 × compact scale (was 46; skills ≈ 85 % of the portrait, were ≈ 68 %).
- Key badges one size (0.36 d) at the same offset on every button incl. the portrait; level badge
  0.38 d. Phone scales with d (min 40).

## Hard briefing line
`difficultyRuleText('hard')`: "starting gold −13% −250 · +30% gold per foe · abilities recharge 25%
slower · hero respawns 25% slower · Hard ribbon" (TR: "başlangıç altını −%13 −250 · …"); generated
from the patch, so a retune follows. Test in tests/render/difficulty2d.test.ts.

## QA tools
- `qa/uiaudit.mjs` + `qa/uiAuditLib.mjs`: 36 screens (map, title, 7 briefing variants, Workshop,
  Heroes + node detail, hero picker, Logbook islands/feats, Daily, Settings ×4, store, story, HUD:
  wave card, coach, Hard, foe card, build ring, tower card, horn tooltip, pause plate, new-foe toast;
  end boards won/lost/Hard/Daily/Endless) × 6 sizes × EN/TR. Checks: overflow / truncation,
  clipping by ancestors, off-screen, text inside each painted piece's safe zone (art geometry
  mapped through the element's real 9-slice), cramped CSS cards, overlays over text, text on text,
  buttons cut by the screen or a board (main action never), glyphs not in Fredoka.
  `__p0.textAudit()` (qaText.ts) does the same for canvas lettering (HUD numbers, wave banner,
  horn, pause plate, end board, ring tooltip).
- `qa/fontprobe.mjs`, `qa/fontglyphs.mjs` (which glyphs each Fredoka subset has),
  `qa/hornprobe.mjs`, `qa/horndebug.mjs`.

## Verification
- Gate (`python3 qa/gate.py`): **GATE OK** — tsc 0 errors, lint clean, tests **1339 passed / 11
  skipped** (101 files + 1 skipped; base 1316+20 → +9 new in tests/render/uiPolish.test.ts, +1 in
  difficulty2d.test.ts), sim:balance PASSED 41 levels (untouched), build OK (only the two old
  INEFFECTIVE_DYNAMIC_IMPORT notes; the one this branch added for laneMarks2d is gone, lanePath.ts).
- `qa/uiaudit.mjs` full run, 432 screens (36 × 6 sizes × EN/TR): **problems 0** (one run had a
  screenshot timeout under load, re-run alone: 0) — report.txt. Phone briefings re-shot after the
  last fix: report-rerun-phone-briefs.txt, 0. Before this branch the same checks found 842
  problems on 88 map screens alone (2 sizes): text under the ribbon tails / brackets, text on the
  plank caps / tab notches, truncated names, hero chip spill, badge over text, Turkish letters in
  a fallback font on every TR screen.
- `qa/hornprobe.mjs` (6 sizes × 25 islands): problems 0 (numbers above).
- Looked at every shot in docs/ui-polish-shots (145: 36 screens × EN/TR × 2000x991 / 844x390, +1).

## Open points
- **Horn on the dock corner on 2–8 islands per size** (dense islands, mostly phones): no spot by the
  cave clears plots / caves / road mouths and the other HUD pieces. Allowing a smaller horn by the
  cave on phones, or letting the fit reserve room there, would raise it; I kept the rules strict.
- **Info cards on small slots**: the foe card now drops its description and stat line before it
  would shrink below 0.88 (stats stay in the Codex); the new-foe toast drops its tips the same
  way. A taller info slot reads better but costs map coverage (tests/render/hudDock.test.ts
  coverage ≥ 97 % fails at 8.6 s) — an owner call.
- **Skill tree on 1366x768 and phones scrolls** (four tiers + capstone); the scroll edge fades now.
  A compact tree layout for short screens would avoid it.
- Workshop cards on phones are tight but inside their frames (audit 0); fine-tuning possible.
- The Hard line now also lists "+30% gold per foe" and "abilities recharge 25% slower" (both in
  the patch, the old line showed neither, so "−13% gold" read wrong). If the owner wants only the
  gold, drop the two `parts.push` lines in difficulty2d.ts.
- `scripts/fredokaTr.mjs` needs `npm install --no-save fontkit opentype.js` to re-run (dev only;
  the built .otf files are committed). A future Fredoka release with Turkish glyphs would make
  'Fredoka TR' unnecessary (the stack order keeps Fredoka's own first).
- Playwright / fontkit are `--no-save` installs as before (not in package.json).
