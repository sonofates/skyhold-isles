# Handoff — HUD dock: the HUD never covers the action (opus, branch `hermes/skyhold-hud-place`, 2026-11-19)

Base `art-2d` (cbab546). Three commits: `b5db948` (dock + map fit), `506e8cb` (live QA, polish),
`c786da2` (new-foe heads-up docked, QA measures it). UI only — no sim / balance / data change.

## The rule (what the player sees)

The per-island "least covered spot" search (`abilityBarSpot`, `hornSpot`, `besideAnchorSpot` in
`uiLayout.ts`) is gone. Every HUD piece now has **one fixed place, derived from the screen size
alone — the same on every island** (`src/render2d/hudDock.ts`). The map is then fitted *around*
those places (`viewFit.ts fitAroundHud`): it shrinks / shifts just enough that no road (with its
painted width), plot, cave/gate or castle (with the headroom of what stands on them) lies under any
piece. Letterbox bands this opens are a painted frame (blurred map backdrop, shadow, border:
`docs/handoff-opus-frame.md`).

Two forms, chosen by aspect (`COLUMNS_ASPECT = 1.9`):

- **bands** (16:9, 16:10, 4:3 — desktop / laptop): top band = info slot (top-left) + Settings /
  Codex / Pause / Speed (top-right); bottom band = lives+gold plaque (left) · **hero + ability tray
  as one painted row, bottom-centre** · horn · wave banner (right). A free top-centre column stays
  for the first-island coach card.
- **columns** (phones in landscape, 21:9 ultrawide): left column = info slot, hero/skills/abilities
  stack, plaque; right column = buttons top, horn + wave banner bottom.

The **info slot** (top-left) holds, by priority: tapped-foe card > new-foe heads-up > next-wave
card. Cards are fitted into the slot by `ui/dockCard.ts` (scale / re-wrap / drop optional parts).

Keyboard shortcuts (H, E, R, Q, W …), tooltips, cooldown rings, EN+TR strings: unchanged
(`abilityBar2d.ts` / `heroHud2d.ts` only lost their positioning code).

### This session's addition (c786da2)
The new-foe heads-up toast (6.5 s, top-centre) was not a dock piece. On phones it hid the walkers on
the north road right when a new foe marched (i12 Gloam Hexer, i24 Tempest Colossus — the original
complaint, in another form). It now docks into the info slot (narrow phone layout: face + name, tip
underneath), fades in without sliding out of its slot, and the next-wave card waits for it.
`hudCheck` now measures it, and clips children to `overflow: hidden` parents (portraits are 128 %
of their round frame; `getBoundingClientRect` ignores the crop and reported false overlaps).

## Verification

### Pure (in `npm test`): `tests/render/hudDock.test.ts`
All 25 islands × 7 screens (1920x1080, 2560x1080, 1366x768, 1600x900, 844x390, 932x430, 844x390
with notch insets) × hero / no hero: 0 road / plot / gate / castle shapes under any dock piece; map
scale floors; pieces inside the safe screen, none overlapping each other, touch-size buttons.

### Live (real DOM + canvas, `qa/hudplace.mjs` → `__p0.hudCheck()`)
Every piece *as drawn* (canvas plaque / banner / wave text / pause / speed / horn with label and
seconds, DOM Settings + Codex with captions, hero/ability tray, next-wave card, foe card, new-foe
heads-up) vs the island's road polylines (with width), plot circles and gate/castle rects under the
live map fit. Exits 1 on any overlap or a piece > 1.5 px outside its slot.

    python3 qa/withPreview.py node qa/hudplace.mjs --part=check      # 25 islands x 6 screens
    python3 qa/withPreview.py node qa/hudplace.mjs --part=shots      # docs/hud-shots/

Final run (HEAD code, `docs/hud-shots/report-check.txt`): **25 islands × 6 screens = 150
combos, two probes each (start with the next-wave card; wave 2 with a tapped foe), 0 overlaps, 0
pieces outside their slot, 0 page errors → `problems: 0`.** The new-foe heads-up was caught and
checked in the info slot 30 times. Live map scale matches the pure table below (e.g. i24: 75 %
at 1920x1080, 89 % at 844x390). A run on the build before c786da2 was also clean (`problems: 0`).

Shots (`docs/hud-shots/`, all looked at): i24 boss wave (Colossus on the north road, fully clear
of the tray and buttons), i12, l1c, i16 — start + mid-battle with a foe card — at 1920x1080 and
844x390. `report-shots.txt`: 14 shots, 0 overlaps.

### Gate (final code)
`npx tsc --noEmit` 0 errors · `npm run lint` 0 problems · `npm test` 97 files passed / 1 skipped,
1290 tests passed / 11 skipped · `npm run sim:balance` PASSED (41 levels) · `npm run build` OK.

## Cost: map scale (owner decision)

Guaranteeing "nothing under the HUD" costs map size (`npx tsx scripts/hudFit.ts`, % of the old
plain fit, with hero):

| screen | avg | worst | best |
|---|---|---|---|
| 1920x1080 / 1600x900 / 1366x768 | 79 % | 73 % (l1c, i02, i07, i10, i13, i14) | 92 % (i20) |
| 2560x1080 | 93 % | 80 % (i03) | 100 % |
| 844x390 | 78 % | 72 % | 95 % (i11) |
| 932x430 | 81 % | 73 % | 96 % (i18) |

The painted islands run edge to edge, so on 16:9 any HUD that never covers them needs ~20 %. The
previous session measured the alternatives (corner clusters, everything on top, bottom-centre tray
on phones) and they all cost more. If ~79 % feels too small on desktop, the cheapest lever is
`PLAYFIELD_HEADROOM` (walker / tower headroom above roads, `WUP`/`TUP` env in hudFit.ts) — but
lowering it lets tall sprites (the Colossus) poke under the bands again.

## Open / not done
- **Coach card** (first-island tutorial, top-centre) is not a dock piece; the top-centre column is
  kept free of the info slot for it, but it is not in the live check (QA marks the coach done).
- **Wave call-out** (boss / final wave, 2.6 s flash at 34 % height, centred) intentionally floats
  over the field; not checked.
- The foe-card probe is flaky on a few islands (final run: i02, i06, i21 on most screens, i15 on
  1366/1600 — `tap missed`, the tap at the probe frame did not open the card; the earlier run
  missed i02 / i13 / i20 instead). Those combos still check every dock piece and the next-wave
  card; the foe card itself is checked on the other ~130 combos. Not a placement problem, but the
  probe could retry another foe.
- No i24 "stormwall" (boss phase 2) shot: the autoplay run ended before phase 2; the boss-wave shot
  shows the Colossus on the north road.
- ~~Letterbox edge smear streaky~~: replaced by the painted frame (`docs/handoff-opus-frame.md`).
