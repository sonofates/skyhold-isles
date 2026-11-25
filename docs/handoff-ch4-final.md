# Handoff: chapter four final balance pass (Task H, branch `hermes/sky-ch4-final`, 2026-11-25)

All nine Frostveil islands (i28–i36) are now tuned together. The base (`integ/ch4`, `006bd5eb`) failed
`sim:balance` (i34/i35/i36 outside their windows, i35 lost at HP×1.03) and `sim:difficulty` (finale curve
6 > 16 > 9 > 6). The whole gate is now green, without loosening any window or criterion.

**Normal first clears (campaign kit, greedy script): i24 12 · i28 13 · i29 10 · i30 9 · i31 8 · i32 7 · i33 6 · i34 5 ·
i35 4 · i36 2 lives.** On i31–i36 no single wave takes more than ~60 % of the lives lost, and the losses
sit in the last third of each island.

Only island data changed (HP scale, per-group HP, group counts, two start delays, one starting gold) plus the
matching `tests/data/groundHpCurve.test.ts` baselines. No maps, art, layouts, `chapters.ts`, store code
or foe numbers changed. i28–i30 are unchanged.

## 1. Per-island before / after (Normal, greedy, campaign kit; `sim:balance`)

"Where the lives go" lists only the waves that cost lives. "Max" is the largest single wave's share of all
lives lost.

| Island | Lives before → **after** | Where the lives go, before | Where the lives go, **after** | Max wave, before → after | Stars before → after |
|---|---|---|---|---|---|
| i28 Rimeharbor | 13 → **13** | w8:3 w13:6 | unchanged | 67 % → 67 % | 2★ |
| i29 Hearthsmoke Hamlet | 10 → **10** | w12:12 | unchanged | 100 % → 100 % | 2★ |
| i30 Pinewhite Ridge | 9 → **9** | w2:10 w4:3 | unchanged | 77 % → 77 % | 2★ |
| i31 Crevasse Span | 8 → **8** | w14:14 | **w12:6 w14:8** | 100 % → **57 %** | 2★ → 2★ |
| i32 Auroral Orrery | 7 → **7** | w3:1 w14:14 | **w3:1 w12:6 w14:8** | 93 % → **53 %** | 1★ → 1★ |
| i33 Stillfall Cascade | 6 → **6** | w9:2 w14:14 | **w10:4 w13:2 w14:10** | 88 % → **63 %** | 1★ → 1★ |
| i34 Steamvent Springs | 16 ✗ → **5** | w14:6 | **w12:6 w13:2 w14:9** | 100 % → **53 %** | 3★ ✗ → 1★ |
| i35 Coldforge Delve | 9 ✗ → **4** | w7:2 w11:1 w15:10 | **w8:3 w11:5 w15:10** | 77 % → **56 %** | 2★ → 1★ |
| i36 Frostveil Citadel | 6 ✗ → **2** | w15:16 | **w14:10 w15:10** | 100 % → **50 %** | 1★ → 1★ |

i34 was the outlier after the merge: it was tuned on a base where the frost was 30 % and i31/i33 were off.
In this tree it scored 16 lives and 3★. It needed +6 % HP and a new wave-12 wall to sit where the chapter
curve wants it.

### What changed per island (1-based waves)

| Island | HP scale | Other changes |
|---|---|---|
| i31 | 1.884 → **1.842** | gold 440 → **435** · w9 elite kilnbacks HP ×1.05 · w11 elite splitters ×1.2 · **w12** elite Sledge Wardens 5 → **4 at ×3.6**, golems 5 → **3** · w13 kilnbacks 7 → **3 at ×1.45** · **w14** wardens 7 at ×1.5 → **6 at ×1.85**, kilnbacks 5 → **2** |
| i32 | 2.959 → **2.96** | **w12** elite kilnbacks ×1.1, draftwings 5 → **7 at ×2.7** · w13 wardens ×1.15 · **w14** wardens 7 at ×2.8 → **4 at ×3.5** |
| i33 | 1.928 → **1.96** | **w10** draftwings 5 → **8 at ×2.5** · w11 elite brutes ×1.3 · w12 golems ×1.25 · w13 kilnbacks ×1.2 · **w14** kilnback formation ×5.5 → **×3.5** |
| i34 | 3.45 → **3.65** | **w12** wardens 6 → **4 at ×2.5** · **w14** golem formation 10 at ×1.5 → **3 at ×3** |
| i35 | 2.3 → **2.285** | w11 elite burrowers ×1.25 · w12 golems ×1.4 · w13 elite wardens ×1.3 · w14 kilnbacks ×1.65 · w15 kilnback formation ×2.5 → **×2.4** |
| i36 | 2 → **2.22** | w12 wardens ×1.3 · w13 elite kilnbacks ×1.55 · w14 elite wardens ×1.9 · **w15** Glacier Warden enters at 24 s → **30 s**, HP ×0.95 → **×1.15**; vanguard wardens start 4 s → **2 s**, ×5 → **×3** |

Wave counts, lanes, rosters (except group sizes), build orders, clear bonuses and wave names are unchanged.

**How the spread works: capped walls.** On these islands the five campaign heroes differ a lot. Bran (the
campaign hero, L20) holds a ground wave far better than Sela or Tobb. When I moved HP into the mid-late waves,
Bran still won, but Sela/Tobb/Wren lost every time. A big wave hurts the weaker heroes again and again (see
"Method" below). The fix uses small groups with high HP: 3–4 Sledge Wardens or 3 golems that leak almost
regardless of hero. Each wall then costs a fixed, capped number of lives (wardens 2, golems 3 each).
Splitting the old single final wall into two or three of these makes the loss predictable for every hero.
The HP ×0.97–1.03 neighbours also stay inside the window, because a wall cannot cost more than its head count.
On i32/i33 the second wall is a tougher draftwing flight (flyers ignore hero and soldier blocks, so they
also leak evenly). The flyer share stays below the 55 % check: i32 7/15, i33 4/16.

## 2. Robustness (lives **lost**; every cell must clear; `sim:balance` robustness block)

| Island | default | HP ×0.97 / 0.985 / 1.015 / 1.03 | seeds 1 / 727 | Wren / Mira / Tobb / Sela | Easy | Hard |
|---|---|---|---|---|---|---|
| i31 | 14 | 8 / 10 / 14 / 12 | 14 / 14 | 20 / 16 / 15 / 16 | 27/27 | L @11 |
| i32 | 15 | 14 / 14 / 17 / 19 | 15 / 15 | 16 / 13 / 14 / 16 | 27/27 | L @7 |
| i33 | 16 | 8 / 10 / 14 / 12 | 16 / 16 | 12 / 12 / 17 / 20 | 27/27 | L @14 |
| i34 | 17 | 15 / 15 / 19 / 17 | 17 / 17 | 14 / 12 / 9 / 15 | 27/27 | L @10 |
| i35 | 18 | 16 / 14 / 17 / 13 | 18 / 18 | 13 / 16 / 15 / 18 | 27/27 | L @11 |
| i36 | 20 | 18 / 18 / 14 / 20 | 20 / 20 | 16 / 18 / 15 / 20 | 27/27 | L @15 |

Before, i35 lost at HP×1.03, and i36 Easy cleared with only 21/27. The weak script loses all nine Frostveil
islands on Normal, as the Master rule requires.

## 3. Glacier Warden (i36 wave 15, Normal greedy run)

- **Freeze:** two different towers frozen, one at each threshold (66 % and 33 % HP). In the base the Warden
  entered at 24 s with a ×5 vanguard. Once the vanguard was lighter, the Warden reached its second threshold
  while still held at the first tower (by soldiers), so it froze the same tower twice. Entering at 30 s with
  ×1.15 HP spaces the two phases out.
- **Summons:** 6 Rime Beetles (3 per phase).
- **Keep:** the Warden dies before the keep (no `glacier_warden` leak). Wave 15 costs 10 lives, all from the
  five vanguard wardens that break through. The existing `sim:balance` assertion (two different towers, six
  summons, no Warden leak) passes.
- Browser: in the QA run (section 7) the Warden froze two towers as well (`fx.events.towerFrozen = 2`).

## 4. Frost share and Sledge Warden shields (greedy, Normal)

| Island | Frost: lost fire time on beetle waves, before → after (5–15 %) | Shield points broken, before → after | Share by tesla/mortar | Refreezes |
|---|---|---|---|---|
| i29 | 5.1 % → 5.1 % | – | – | – |
| i30 | 5.1 % → 5.1 % | – | – | – |
| i31 | 5.8 % → **5.7 %** | 21,259 → 30,153 | 56 % → 57 % | 2 → 3 |
| i32 | 5.8 % → **5.2 %** | 59,950 → 50,195 | 65 % → 59 % | 23 → 21 |
| i33 | 6.3 % → **6.5 %** | 16,538 → 17,387 | 65 % → 63 % | 2 → 4 |
| i34 | 6.1 % → **5.7 %** | 47,892 → 55,733 | 57 % → 54 % | 11 → 12 |
| i35 | 9.2 % → **9.1 %** | 23,516 → 25,636 | 61 % → 57 % | 2 → 4 |
| i36 | 7.7 % → **7.7 %** | 54,454 → 54,173 | 57 % → 54 % | 6 → 6 |

All eight beetle islands are inside 5–15 %. Weakening the final walls tended to lower frost, because the
towers are less busy when the last beetles burst. On i31 that decided the tuning (see "Method"). Tesla and
mortar still break more than half of every shield pool.

## 5. Hero XP pacing (Normal first-clear chain)

Bran reaches **level 20 (the cap) on entering i22** (14,478 XP) and stays there. He arrives at **i28 at L20**
(16,816 XP) and at **i36 at L20** (20,830 XP). The Workshop is capped too (33 stars spent from i29 on;
65 stars banked at i28, 77 at i36). In chapter four only island tuning moves the difficulty, not the
player's kit. Each island can be tuned on its own: an edit on one island does not change the next one's kit.

## 6. Gate (Node 22, final tree, hermes; sims one at a time)

- `npx tsc --noEmit` ✔ · `npm run lint` ✔ · `npm run build` ✔ (the usual chunk-size / dynamic-import warnings)
- `npx vitest run --maxWorkers=2`: **147 files passed (2 skipped), 1,972 tests passed, 15 skipped.**
- `npm run sim:balance`: **PASSED (53 levels)** (base: 5 failures).
- `npm run sim:difficulty`: **all 10 checks PASS** (base: the finale curve failed). Frostveil curve "i24 12,
  i28 13, i29 10, i30 9, i31 8, i32 7, i33 6"; finale "6 > 5 > 4 > 2". Easy 37/37 all ≥12, Normal 37/37,
  23 two-star / 9 three-star, Hard 15/37 (chapter one 9/19, chapter two 5/9, every Hard win loses lives
  with 1–2★, i24 Hard W 4/22 1★), Hard weak 2/37.
- `npm run sim:items -- --workers=2`: **all 7 checks PASS.** Weak Normal 5 → 11/37 with the belt (needs +3),
  weak Easy 24 → 26, Hard 15 → 24/37, i24 Hard W 8/22 2★, Hard 3★ 3/24.

## 7. Browser QA (one Chromium, own port, preview stopped)

`python3 qa/withPreview.py --port=4473 node qa/ch4boss.mjs` → `docs/ch4-shots/i36-932x430-boss.jpg`
(932×430, DPR 2, touch, autoplay 2×). The script tops up gold and lives through `__p0`, lets autoplay
build the island's scripted defence, then calls `__p0.skipToWave(15)`. It shoots the first frame where the
Warden is on the road and a tower is frozen. This is render QA, not a balance check. The shot: the Warden
just past the ice gate at 60 % HP (phase 1), the frost burst ring under it, the tower next to the gate
locked in an ice block. The run ended in a win with two freezes. No page or console errors.

## Method (the probe is not committed)

`.tune/ch4probe.ts` (gitignored scratch): it caches the Normal/Easy first-clear chain once. It then scores an
island variant against everything the gate checks: window, curve target, flyer share, frost 5–15 %,
weak loses, 1–2★, hoard, HP ×0.97–1.03, seeds, the four alternate heroes, base towers, Easy ≥12, Hard
non-trivial, and the Glacier Warden assertion. It also scores the two new criteria: max wave ≤60 %, and at
least half the loss in the last third. Random search found i34/i35 quickly. i31–i33 needed the capped-wall
idea above, then small hand grids (the greedy sim is bimodal: a 0.1 % HP step moves an island by 4–8 lives).
For each chosen value the HP neighbours were checked as well. On i31, HP 1.841 gives the same result.
A lighter final wall (×1.75–1.8) gives 12 lost with all other checks green. HP 1.843 drops to 10 lost with
frost 4.4 %, so i31 sits on a narrow ledge.

## Open / doubtful

1. **i28–i30 were not re-shaped.** The task names i31–i36, and the curve there already passes. Still, i29 loses
   all 12 lives on wave 12 (100 %) and i30 loses 10 of 13 on wave 2 (77 %, an early wall). The capped-wall
   recipe should work on them too, but i29/i30 frost sits at 5.1 % against the 5 % floor. Any edit there will
   likely need a beetle-placement nudge as well.
2. **i33's largest wave is 63 %** (10 of 16), slightly over the ~60 % target. Every 16-loss variant that also
   passed the alternate heroes and frost had a 10-life final wave. 8/8 splits made Sela or Tobb lose.
3. **Thin robustness cells (all clear):** i31 Wren loses 20/22, i33 Sela 20/22, i36 Sela 20/22 and HP×1.03
   20/22. Sela (L18–20 on these islands) is the limiting hero for spreading pressure; see the note on capped
   walls.
4. **Capped walls are a design choice to review.** The new mid-late walls are small groups with high HP
   (e.g. i31 w12: four elite wardens at ×3.6; i34 w14: three golems at ×3). In the greedy sim they leak
   nearly every run. That makes the loss predictable but could read as "unkillable" to a player who
   doesn't use items or hero abilities on them. A designer playtest of i31 w12, i34 w12/w14 and i36 w14 is
   worth doing.
5. **Hard now loses all of i29–i36** (before: i36 was a Hard win with 2/22). All Hard checks still pass, and
   the items sim's Hard 15 → 24/37 check passes.
6. The i34–i36 handoff (`handoff-ch4-isles-3.md`) says the Warden appears at 24 s. It now enters at 30 s.
7. `qa/ch4boss.mjs` is committed. The tuning probe is not (its logic is above).
