# Handoff: full-bleed map + corner HUD (opus, branch `hermes/skyhold-fullbleed`, 2026-11-19)

Base `art-2d` (695869b). UI / render only: no sim, balance or level-data change. Replaces the
"HUD dock" (`docs/handoff-opus-hud.md`): the owner's reaction to the shrunken, framed map with the
tray in a left column on a ~2000x991 window was "bu ne la"
(`docs/feedback/2026-11-18/hud-dock-owner-2000x991.webp`).

## What the player sees now
- **The island fills the window.** The map is a cover fit. The decorative edges are cropped first.
  The gameplay always stays on screen: plots, the castle keep, each cave's mouth (the outer 40 % of
  its rock may be cropped) and the roads inside the safe area.
- **Compact corner HUD, the same layout on every screen shape.** Lives and gold sit bottom-left.
  Wave banner and horn sit bottom-right (horn above the banner). Settings, Codex, Pause and Speed
  sit top-right. The info card (next wave / tapped foe / new foe) sits top-left. Hero portrait,
  2 hero skills and 2 abilities form **one row at the bottom centre on every screen, phones
  included**. There is no column form any more. The pieces are about 14 % smaller than before
  (buttons r 38u → 32u, plaque/banner × 0.86, tray d 52 → 46·0.86·u, min 40).
- **What a piece may cover:** the map's decorative art. It may cover a road only where the road
  runs outside the safe area. It never covers a plot, a cave, the castle, or a road inside the
  safe area. When the corner home would cover one of those on an island, this is tried in order
  (`src/render2d/fullBleed.ts`):
  1. Shift the map inside its crop slack.
  2. Slide the tray along the bottom (plaque … banner) and the info card along the top (up to the
     coach-card column). Put the horn left of the banner instead of above it.
  3. Only then shrink the map, by the smallest step that clears (≈0.1 %), for that island at that
     screen only.
- A band therefore appears only on islands whose content runs edge to edge. Examples: l1c, which
  has a plot row on the bottom edge and caves at the top; i12, which has a road along the bottom
  edge. The band shows the island's own art, blurred and now **light**: backdrop
  saturation/brightness 0.6 → 0.85/0.86, vignette halved. It also has the painted border. A
  shrunk map is pushed toward the edge away from the HUD, so the band usually sits under the HUD.

## Numbers (pure table `npx tsx scripts/hudFit.ts`, identical live)
Share of the screen the map covers, with a hero (`docs/fullbleed-shots/report-fit.txt`):

| screen | avg | islands ≥ 97 % | worst |
|---|---|---|---|
| 1920x1080 (16:9) | **97.6 %** | 17/25 | 88 % i12 |
| 2000x991 (owner, ~2:1) | **97.8 %** | 19/25 | 84.5 % i12 (l1c 88.7 %) |
| 2560x1080 (21:9) | **97.4 %** | 19/25 | 84.5 % |
| 1600x900 / 1366x768 | 97.1 / 96.9 % | 16 / 15 | 86 % |
| 1440x900 (16:10) | 95.1 % | 8/25 | 86.7 % |
| 844x390 / 932x430 phone | 71 / 79 % | — | 47 / 56 % (i12) |

Without a hero (smaller tray) the desktop averages are 96–99 %. The owner's screenshot island and
size (l1c at 2000x991) went from a framed card of ~70 % scale to 88.7 % screen coverage. The
93 %-scale map is shifted left (the cave rock is cropped) and a thin band shows top/right. The tray
had to slide right, because the bottom row of plots leaves no gap of its width.

**Phones:** coverage is an area measure, so it is ≈ scale². The map *scale* on phones averages
87 % of cover. The old column dock averaged 78 %. The phone HUD is already at its touch minimums
(tray d 40, buttons r 24, horn r 28, plaque 170 px), so the HUD needs a band there on most islands.

**Short of the brief:**
- **16:10 averages 95.1 %, not ≥ 97 %.** The cover window there is 1363 image px wide, against a
  1515 px safe area. Most islands have plots or roads near both side edges, so the corner pieces
  force a small shrink.
- **Six islands are under 97 % at 16:9 / 2:1:** l1c, i02, i09, i11, i12, i13.
- These are the "shrink by the minimum for that island only" cases the brief allows.

## Verification
- **Live check:** `python3 qa/withPreview.py --port=4397 node qa/hudplace.mjs --part=check`.
  - Scope: 25 islands × 8 screens (1920x1080, 2000x991, 2560x1080, 1366x768, 1600x900, 1440x900,
    844x390, 932x430), so 200 combos. Each combo is checked at the start (next-wave card) and in
    wave 2 with a foe tapped.
  - Result: **0 hard overlaps, 0 pieces outside their slot, 0 unclear fits, 0 page errors →
    `problems: 0`**. The new-foe heads-up was checked 40 times. Report:
    `docs/fullbleed-shots/report-check.txt`.
  - The foe-card tap missed on 17 combos (i02 / i06 / i13 / i21). This is the known flaky probe.
    Every dock piece and the next-wave card were still checked on those combos.
- **Shots:** `--part=shots` writes to `docs/fullbleed-shots/`.
  - Islands and screens: l1c / i12 / i16 at start and in battle, plus i24 on its boss wave. Each at
    2000x991, 1920x1080, 2560x1080 and phone 844x390. 28 shots in total, `problems: 0`.
  - All the shots I spot-checked (13 of 28) looked right. i24 at 1920 and at 2560 are true full
    bleed with the Colossus clear of the info card. Phone shots show the map at 74–88 % scale with
    the band under the HUD.
  - Compared with the owner screenshot: the map is big and the screen is full.
- **Pure tests:** `tests/render/hudDock.test.ts` is rewritten.
  - Scope: 25 islands × 9 screens (the 8 above plus a phone with a notch) × hero / no hero.
  - It asserts: 0 hard overlaps; the gameplay always on screen; coverage averages ≥ 97 % at
    1920x1080, 2000x991 and 2560x1080 and ≥ 95 % at 16:10; per-island floors; corner positions;
    the tray is one row; pieces never overlap each other and stay on their edge; a `slideX` unit
    test; the safe-area road rule.
- `tests/render/mapFrame.test.ts` now runs the backdrop test on the full-bleed fit.
- **Gate:**
  - `npx tsc --noEmit`: 0 errors.
  - `npm run lint`: 0 problems.
  - `npm test`: **98 files passed / 1 skipped, 1297 passed / 11 skipped**.
  - `npm run sim:balance`: **PASSED (41 levels)**.
  - `npm run build`: OK.

## Files
- `src/render2d/fullBleed.ts` (new):
  - `hardShapes`: the shapes a piece must not cover, plus the must-see box.
  - `hardOverlaps`: the hard rule.
  - `slideX`: analytic free intervals along an edge.
  - `fullBleedFit`: scale in 2 % steps, then bisect; offsets nearest the centred one. About 15 ms
    per island × screen.
- `src/render2d/hudDock.ts`: one `corners` form, compact sizes, `trayRange` / `infoRange` /
  `hornAlt`. The `bands` / `columns` forms, `trayStack`, `reserved` and `COLUMNS_ASPECT` are gone.
- `src/render2d/game2d.ts` (`resize`): dock → `fullBleedFit` → `map.resize(w, h, fit)`; adds
  `game.fullBleed` (QA).
- `src/render2d/mapView.ts`: `resize(w, h, fit?)`.
- `src/render2d/viewFit.ts`: `fitAroundHud` removed.
- `src/render2d/playfield.ts`: `playfieldBoxes` (walker/tower headroom) removed.
- `src/render2d/uiLayout.ts`: `plaqueLayout(..., size)`; button r 32u.
- `src/render2d/mapFrame.ts`: lighter backdrop and vignette.
- `src/render2d/hudCheck.ts`: hard `overlaps` (plots/caves/castle/safe-area roads), plus
  `outerRoads` (allowed, reported) and `fit.coverage` / `clear`.
- `src/render2d/ui/abilityBar2d.ts`: always a row.
- `src/render2d/main2d.ts`: foe card single-column in the compact slot; map bake chosen from the
  cover scale.
- `qa/hudplace.mjs`: 8 screens, coverage summary, new shot set. Default output is
  `docs/fullbleed-shots/`.
- Tools:
  - `scripts/hudFit.ts`: coverage table; `--verbose` shows which pieces moved, `--out=`.
  - `scripts/fullbleedCost.ts`: what each piece costs.
  - `scripts/fullbleedDump.ts` + `scripts/fullbleed_overlay.py`: PIL overlay of the fit, the
    shapes and the pieces.

## Open / notes
- **The tray is not always centred.** On ~20 of 25 islands it slides along the bottom, often next
  to the plaque or the banner, because bottom-row plots leave no centred gap. If the owner wants it
  strictly centred, the price is a shrink on those islands (measure with `fullbleedCost.ts`).
- **The info card often slides right of a top-left cave**, e.g. l1c at x≈305.
- **Walker headroom is no longer reserved.** Walker heads on a road just under the info card can
  touch the card's lower edge (seen on l1c / i12 top road); the road itself stays clear. Tower
  tops on a plot just under a piece can do the same.
- **The compact info slot (17 × 7.5 `--s`)** draws the next-wave card at k≈0.86 and the foe card
  at k≈0.71–0.75, single column. They are readable but small. A taller slot costs ~0.5–1 %
  coverage per `--s` (measured).
- **The coach card** (first island, top-centre) now floats over the map. On l1c it sits just
  above the top road. It is still not a dock piece.
- Dead CSS for the old `.vertical/.block/.stack/.edge` tray forms remains in `abilityBar2d.css` /
  `heroHud2d.css`. It is harmless (those classes are never set) and safe to delete.
- No world-map files were touched (`worldMap.ts`, `seaPainter.ts`, world-map CSS).
