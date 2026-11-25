# Handoff: chapter five waves, batch 1 (Task E, branch `hermes/sky-ch5-waves1`, 2026-11-25)

The Dusk Hound (`duskhound`) is now in the story waves of i38 and i39, and i37–i39 hold the chapter
curve on Normal after the Citadel (i36). i37 stays without chapter-five foes (soft opener). All three
keep 14 waves. Maps, paths, pads, art, `chapters.ts` and the foe code are untouched. Only the island
data (`src/data/levels2d/i37.ts`–`i39.ts`), tests, the sim report line and one QA script changed.

## Where the hound marches

Every hound group is one **pack of 5–6 hounds, 0.35 s apart** (first to last hound ≈ 4.6 world units
on the road at walking speed, the enrage radius is 10), so a kill near the front enrages the rest.
A small `pack(count, delay, [lane,] hpScale)` helper at the top of i38.ts / i39.ts builds them.

| Island | Waves with packs (1-based) | How |
|---|---|---|
| i37 Duskfall Landing | none | chapter opener, older roster only |
| i38 Shardfloat Isles | **2** (5 + 5, ×3 HP, the marked intro), 6 (6, ×2.5), 9 (5, ×3), 12 (6 + 6, ×1.5) | Introduces it. Wave 2's two reserved runner groups became the two packs; wave 6's and wave 12's runner files became packs; wave 9 adds one behind the mites and tortoises. 4 of 14 waves, single lane. |
| i39 Umbral Grove | 1 (5, east), 3 (5, east), 5 (6, west), 7 (5, west), 10 (6 + 6, east), 12 (5, west), 14 (6 + 6, west) | A regular threat in 7 of 14 waves, on both cellars, always with older groups (5 of the 7 with two or more). Packs replace the runner / hare / mite files and are added on 7 and 12. HP ×1–1.5. |

"×N HP" is the group's `hpScale` on top of the island curve. Hounds are 95 HP base (twice a Zephyr
Runner), so a pack is far tougher than the runner file it replaced; the scales were searched with
the rest of the island (below).

**"New" tag and bestiary:** nothing to wire. Arriving from i37 a player has met every older foe, so
i38's wave-2 card tags **New** on the hound only, and marching it fires the one-time new-foe toast with
its portrait (visible in the QA shot). i39 shows no tag after i38. Tested in
`tests/sim/chapterFiveWaves.test.ts`.

## How often the enrage triggers, and what it costs (Normal, campaign kit, greedy)

Counter-factual = the same run with `speedBonus` 0 (packs still howl, nobody speeds up). Probe only.

| Island | Hounds | Killed | Howls (a kill with mates in reach) | Mates enraged per howl | Hounds leaked, enrage on → off | Lives lost, on → off |
|---|---|---|---|---|---|---|
| i38 | 33 | 31 | **28** (90 % of kills) | 4.5 | **2 → 0** (wave 2) | 16 → 14 |
| i39 | 50 | 50 | **40** (80 % of kills) | 4.5 | 0 → 0 | 18 → 16 |

- On i38 the enrage is the whole hound leak: two enraged hounds of the intro packs slip through on
  wave 2, none without it. Weak script: 4 hounds leak on wave 2 with the enrage; without it none
  there and 1 on wave 6.
- On i39 the greedy kit (Bran L20 blocks at the merge, tesla + mortar splash) kills every hound. The
  enrage still costs ~2 lives through the tower time it eats (the extra loss lands on the wave-14 wall).
- The alternate heroes feel it more on i38: Tobb leaks 4 hounds on wave 2 (18 lost vs 6 without the
  enrage), Sela 3 (20 vs 14), Mira 1 (9 vs 8). On i39 no hero leaks a hound.
- The greedy sim is bimodal: "lives on → off" includes knock-on effects in later waves, not only hound
  leaks. Read it as "same order of magnitude", not as an exact price.

`sim:balance` now prints this on every island with chapter-five foes: `dusk: greedy 0 veils, 28 pack
howls (126 mates enraged, 2 hounds leaked), …`.

## Numbers changed (1-based waves)

| Island | HP scale | Other changes |
|---|---|---|
| i37 | 2.56 → **2.563** | w12 elite Sledge Wardens ×2.8 → **×2.26** · w13 elite brutes ×1 → **×1.6** · w14 golems ×3.4 → **×2.81**, Sledge Wardens 4 → **5 at ×1.3** |
| i38 | 2.58 → **2.416** | packs as above · w12 elite golems ×2.6 → **×2.56** · w14 elite Sledge Wardens 6 at ×3 → **5 at ×2.75** |
| i39 | 2.325 → **2.253** | packs as above · w12 elite Sledge Wardens (east) ×2.7 → **×3.52** · w14 elite tortoises (east) 4 at ×2.8 → **3 at ×3.54** |

Wave counts, lanes, build orders, clear bonuses, wave names and starting gold are unchanged.
`tests/data/groundHpCurve.test.ts` baselines moved with the HP scales; it now also names i39's
opening pack (×1.5 on wave 1), the same way it names finale formations.

## Chapter curve (Normal first clears, campaign kit, greedy)

| Island | Lives left (of 22) before → **after** | Where the lives go, before | **After** | Max wave share before → after | Last third (w11–14) |
|---|---|---|---|---|---|
| i36 (ch4 finale, reference) | 2 | w14:10 w15:10 | unchanged | 50 % | – |
| i37 | 7 → **7** | w12:6 w14:9 | **w12:6 w13:6 w14:3** | 60 % → **40 %** | 100 % |
| i38 | 6 → **6** | w12:6 w14:10 | **w2:2 w12:6 w14:8** | 63 % → **50 %** | 88 % |
| i39 | 4 → **4** | w4:1 w7:2 w8:1 w12:6 w14:8 | **w4:2 w7:2 w12:6 w14:8** | 44 % → **44 %** | 78 % |

All 1★, inside the windows (i37 14–16 lost, i38 15–17, i39 16–18). `sim:difficulty`: "Eclipse eases
after the Citadel and rises through the grove: i36 2, then 7 > 6 > 4 lives".

### Robustness (lives lost; every cell must clear; probe = same checks as `sim:balance`)

| Island | default | HP ×0.97 / 0.985 / 1.015 / 1.03 | seeds 1 / 727 | Wren / Mira / Tobb / Sela | Easy (lives left) | Hard |
|---|---|---|---|---|---|---|
| i37 | 15 | 12 / 14 / 15 / 10 | 15 / 15 | 9 / 10 / 7 / 18 | 27/27 | L @14 (was W 2/22) |
| i38 | 16 | 16 / 16 / 16 / 16 | 16 / 16 | 6 / 9 / 18 / 20 | 27/27 | L @14 |
| i39 | 18 | 7 / 12 / 17 / 15 | 18 / 18 | 18 / 16 / 20 / 14 | 23/27 | L @5 |

The weak script loses all three (i39 now on wave 5 instead of 8: the wave-4 cellar push takes 16).

## Gate (Node 22, final tree, hermes; one command at a time)

- `npx tsc --noEmit` ✔ · `npm run lint` ✔ · `npm run build` ✔ (the usual chunk-size / ineffective
  dynamic-import advisories)
- `npx vitest run --maxWorkers=2`: **149 files passed (2 skipped), 2,039 tests passed, 15 skipped**,
  including the new `tests/sim/chapterFiveWaves.test.ts` (6 tests) and `chapterEnemies.test.ts`'s
  `evaluateBalance` over i17–i39.
- `npm run sim:balance`: **PASSED (56 levels)**. The robustness block matches the table above.
- `npm run sim:difficulty`: **all 12 checks PASS** — Easy 40/40 all ≥ 12 lives, Normal 40/40, Eclipse
  curve "i36 2, then 7 > 6 > 4", Hard 15/40 wins all 1–2★, Hard weak 2/40.
- `npm run sim:items -- --workers=2`: **all 7 checks PASS.** Belt [cloudguard, skyPurse, emberPot];
  weak Normal 5 → 12/40 with the belt, Hard 15 → 26/40, i24 Hard W 8/22 2★.

Changed test expectations: `tests/sim/newIslands.test.ts` (i38/i39 may field the hound; i37 stays on
the older roster) and `tests/data/groundHpCurve.test.ts` (baselines, opening/finale packs).

## Method (probe not committed; `.tune/` is gitignored)

A throwaway probe cached the Normal + Easy first-clear chain up to i37, then scored island variants
against every check of the gate: window, ≤3-life drop, max wave ≤ 60 % (≤ 56 % for i39 / i37
searches), flyer share, hoard, invalid actions, frost 5–15 % (i39), weak loses, HP ×0.97–1.03, seeds
1/727, the four alternate heroes, Easy ≥ 12 lives, Hard non-trivial. Random search per island, in
chain order (i37, then i38 on the new i37, then i39 on both), then a local search on i39.

- **i38:** 28 of 250 random variants passed everything; the pick is the one where all HP neighbours
  and seeds give exactly 16 lost.
- **i39 was the hard one.** At 17–18 lost (the curve needs ≤ 5 lives after i38's 6) every variant
  with strong packs (×2.5–3.5) made an alternate hero lose: Bran blocks the hounds at the merge,
  Wren / Mira / Tobb / Sela do not, and a ×3.5 pack on wave 10 cost Sela 17 lives. Five random
  searches (≈ 1,750 variants: broad, narrow, "strong wave-10 packs", mid, capped walls) found three
  that passed; all three have packs at ×1–1.5 and no hound leak for any hero. The pick is the
  local-search refinement with the lowest worst-case cell (20/22).
- A wave-1 pack at ×1 instead of ×1.5 drops i39 to 8 lost (bimodal): left at ×1.5.

## Browser QA (one Chromium, own port, preview stopped)

`python3 qa/withPreview.py --port=4475 node qa/ch5waves.mjs` → `docs/ch5-shots/i38-932x430-packs.jpg`
(932×430, DPR 2, touch, autoplay 2×, foes-seen save with every older foe). A `__p0.replay.probe`
counts enraged hounds every sim tick; the script keeps the hound-wave frame with the most enraged
hounds. The shot: wave 2, a six-hound pack leaving the west gate with three hounds at two enrage
stacks (violet cast, glow, smoke trail), a howl burst at the tesla, and the one-time **New · Dusk
Hound** toast with its counter hint. Gold / lives are topped up through `__p0` (render check only).
No page or console errors.

## Open / doubtful

1. **i39 packs never leak for the campaign kit.** They are a regular, visible threat (40 howls, 4.5
   mates enraged per howl, +2 lives lost through tower time) but every stronger pack made an
   alternate hero lose the island. If the owner wants hounds to break through on i39, the lever is a
   barracks-proof pack (e.g. ×2 HP packs entering *with* the wave-14 wall, on the lane the hero does
   not guard) together with an easier i38/i37 to make room in the curve, or loosening the
   alternate-hero rule. Not done: the rule says never loosen criteria.
2. **i38's intro packs are ×3 HP** (about a brute each at wave 2). That is what makes the enrage
   leak on the intro wave; with ×1.5–2 nothing leaks. A player without Bran (Tobb, Sela) loses 3–4
   lives on wave 2 here. Worth a playtest.
3. **Thin margins (deterministic, all clear):** i38 Sela 20/22, i39 Tobb 20/22, i39 HP ×0.97 sits at 7
   lost (far from the window, but it clears). i39 is bimodal: a ×1 wave-1 pack drops it to 8 lost.
   Any edit to i39 (or the hound numbers) will likely need a re-tune; the probe logic is above.
4. **Hard now loses i37** (it was a Hard win with 2 lives). All Hard checks still pass.
5. Not touched: i40+, `chapters.ts`, the hound / veilcaster / Sovereign numbers, art, maps.
