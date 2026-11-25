# Handoff: chapter four waves, batch 2 (Task G, branch `hermes/sky-ch4-waves2`, 2026-11-25)

The Rime Beetle's frost now slows towers by **40 %** (was 30 %), and i29–i33 are re-tuned so the
chapter curve rises one life per island on Normal: **i28 13, i29 10, i30 9, i31 8, i32 7, i33 6**.
The known base failure in `tests/sim/chapterEnemies.test.ts > chapter two balance` is fixed by tuning
the islands; no window or check was loosened (the frost floor was raised from 3 % to 5 %).
Not touched: i34–i36, maps/art/layouts, `chapters.ts`, store code, the Sledge Warden's numbers.

## 1. Frost that matters

| What | Before | After |
|---|---|---|
| `rimebeetle` `rateMul` | 0.7 (30 % slower) | **0.6 (40 % slower)** |
| Patch radius / duration | 4.0 / 3.75 s | unchanged |
| Stacking | max of the patches covering a tower | unchanged (non-stacking; asserted in `chapterFourWaves.test.ts`) |
| `sim:balance` frost floor (`MIN_FROST_LOSS`) | 3 % | **5 %** (ceiling stays 15 %) |

The slow alone was not enough: with the old beetle placement, 40 % gave 4.3 % lost fire time on
i29, i30 and i31 and 4.9 % on i32 (6.8 % on i33). So beetle placement was changed, not beetle HP.
Tighter files (spawn interval ≈ 0.55 s instead of 0.9 s) and beetles that walk in with the wave's
tanks reach further into the tower cluster before they die. Their patches then cover more of the
busy towers. Details are in section 2.

Text updated to the new number:
- EN bestiary/foe card (`CHAPTER4_ENEMY_DEFS.rimebeetle.description`): "...towers inside fire 40%
  slower for a few seconds."
- TR (`dataTr.ts` `rimebeetle.desc`): "...lekedeki kuleler birkaç saniye %40 daha yavaş ateş eder."
- EN codex blurb (`codexData.ts`) now reads its numbers from the def ("Leaves a 3.75 s frost patch ...
  40% slower"). It said "3 s / 30%" before and was already stale after waves-1 changed the duration.
- `docs/chapter4-plan.md` row for the beetle (3,75 sn / %40).

## 2. Island changes (i29–i33)

| Island | HP scale | Wave changes (1-based waves) |
|---|---|---|
| i29 Hearthsmoke Hamlet | 2.93 → **2.904** | none |
| i30 Pinewhite Ridge | 2.36 → **2.395** | w3 beetles 4 → 5, start 4.4 → 2.8 s · w4 beetle interval 0.9 → 0.54 · w8 beetles start 4.4 → 8 s · w13 elite beetles 5 → 6, interval 0.9 → 0.54 |
| i31 Crevasse Span | 1.75 → **1.884** | w2 beetle interval 0.91 → 0.55 · w5 beetles 6 → 7 · w8 elite beetle interval 0.9 → 0.54 |
| i32 Auroral Orrery | 2.95 → **2.959** | w4 beetle interval 0.91 → 0.55 |
| i33 Stillfall Cascade | 1.95 → **1.928** | w7 elite beetles 7 → 8 · w9 beetles 7 → 8 · w12 beetle interval 0.87 → 0.52 · w14 beetles start 10.2 → 6.2 s |

Wave counts (13/13/14/14/14), lanes, rosters, gold, build orders and maps are unchanged. The i29
introduction (4 beetles, wave 2, east boathouse) and the i31 Sledge Warden opener are unchanged.
`tests/data/groundHpCurve.test.ts` baselines follow the five HP scales.

## Chapter curve (Normal first clears, campaign kit, greedy script; `sim:balance`)

| Island | Before (base) | **After** | Stars | Where the lives go | Weak script |
|---|---|---|---|---|---|
| i24 (ref.) | 12 | 12 | 2★ | | loses |
| i28 | 13 | 13 | 2★ | (unchanged) | loses |
| i29 | 10 | **10** | 2★ | wave 12: 12 | loses wave 12 |
| i30 | 9 | **9** | 2★ | wave 2: 10, wave 4: 3 | loses wave 12 |
| i31 | 18 ✗ | **8** | 2★ | wave 14: 14 | loses wave 14 |
| i32 | 7 | **7** | 1★ | wave 3: 1, wave 14: 14 | loses wave 14 |
| i33 | 8 ✗ | **6** | 1★ | wave 9: 2, wave 14: 14 | loses wave 14 (base: **won**, a failure) |

The curve has to be strictly falling (`sim:difficulty`) and inside the loss windows (i29–i31 lose 9–14,
i32 14–16, i33 15–17), so with i30 at 13 lost the only values left are exactly 14 / 15 / 16.

Robustness (all must clear; lives **lost**, from the `sim:balance` robustness block):

| Island | HP ×0.97 / 0.985 / 1.015 / 1.03 | seeds 1 / 727 | Wren / Mira / Tobb / Sela |
|---|---|---|---|
| i29 | 12 / 19 / 10 / 11 | 12 / 12 | 4 / 4 / 18 / 10 |
| i30 | 12 / 18 / 17 / 15 | 13 / 13 | 0 / 0 / 7 / 19 |
| i31 | 14 / 14 / 6 / 8 | 14 / 14 | 12 / 9 / 20 / 20 |
| i32 | 13 / 15 / 16 / 19 | 15 / 15 | 14 / 12 / 13 / 13 |
| i33 | 20 / 16 / 16 / 16 | 16 / 16 | 14 / 14 / 18 / 19 |

Easy clears all five with 27/27 lives. Hard (campaign kit) loses all five (untuned i31 was a Hard
win with 6 lives); Hard still clears 15/34 islands and every Hard win costs lives with 1–2★.

How it was tuned: a throwaway probe (not committed) replays the Normal and Easy chains once up to
i28, then for one island at a time random-searches HP (±5–8 %) × beetle start delay / count / spawn
interval. It checks a candidate against everything the gate checks: loss window, ≤3-life drop,
strictly falling curve, ≥5 % frost, weak loses, flyer share, hoard, 1–2★, HP ×0.97–1.03, seeds, the
four alternate heroes, Easy ≥12 lives and Hard non-trivial. From i29 on Bran is level 20 and the
Workshop is at its cap, so an island's tuning does not change the next island's kit. Each island
could be tuned on its own. The sim is bimodal (a 1 % HP step can move an island by 8 lives), so
values were picked where the HP neighbours also clear.

## 3. Frost share per island (greedy, Normal campaign kit; printed on every `sim:balance` summary line)

| Island | Lost fire time on beetle waves, before (30 %) | **After (40 % + placement)** | Inside a patch, beetle waves | Lost over the whole run |
|---|---|---|---|---|
| i29 | 3.4 % | **5.1 %** | 12.7 % | 1.8 % |
| i30 | 3.2 % | **5.1 %** | 12.8 % | 3.3 % |
| i31 | 3.4 % | **5.8 %** | 14.5 % | 2.2 % |
| i32 | 3.5 % | **5.8 %** | 14.6 % | 2.3 % |
| i33 | 5.3 % | **6.3 %** | 15.6 % | 3.3 % |

All five are inside the 5–15 % target, and `sim:balance` now fails below 5 %. Lives lost with the frost
switched off (probe, same kit), against the tuned value: i29 12 vs 12, i30 15 vs 13, i31 **4 vs 14**,
i32 15 vs 15, i33 14 vs 16. With the old 30 %: 11 / 16 / 10 / 16 / 16. The frost decides i31.
Elsewhere the bimodal sim hides the effect, and i30 even scores worse without it.

## Sledge Warden shield on i31–i33

New informational tally in `sim:balance` (summary line `shield: ...`). It needed one small sim change:
the `shieldAbsorb` event now carries `guard` (the shield sits on a Sledge Warden) and `breaker` (the
hit was a tesla chain / mortar blast at the 2× rate). Both fields are optional, and every existing
listener ignores them.

| Island | Shield points broken | Share by tesla/mortar | Shield share of all damage the wardens took¹ | Shields broken (by breaker)¹ | Refreezes | Lives lost with no shield¹ |
|---|---|---|---|---|---|---|
| i31 | 21,259 | **56 %** | 31 % | 28 (16) | 2 | **0** (vs 14) |
| i32 | 59,950 | **65 %** | 39 % | 37 (24) | 23 | 13 (vs 15) |
| i33 | 16,538 | **65 %** | 29 % | 28 (13) | 2 | 18 (vs 16, sim noise) |

¹ from the probe (instrumented `applyDamage`), same runs. A breaker hit takes 2 shield points per
damage point, so "points" are shield pool, not tower damage.

Reading: the shield soaks about a third of everything the wardens take. Tesla/mortar remove most of
it, so the counter in the bestiary works. On i31 the shield decides the island (0 lives lost without
it); i32's long winding road gives it 23 refreezes. On i33 the island is decided by its final
kilnback formation (×5.5 HP), not by the shield. Sledge Warden numbers are unchanged.

## Browser QA (one Chromium, own port, preview stopped)

`python3 qa/withPreview.py --port=4471 node qa/ch4shield.mjs` → `docs/ch4-shots/i31-932x430-shield.jpg`
(932×430, DPR 2, touch, autoplay 3×, gold/lives topped up via `__p0` like `qa/ch4waves.mjs`). A tick
probe (`__p0.replay.probe`) reads every warden's shield from the sim. The shot is wave 10 ("The Bow
in the Rope"): on the lower bridge two wardens have lost their shields, one carries a cracked ice
plate (166/438) and two at the gate have full plates. Tesla is arcing on the upper bridge. No page or
console errors.

## Gate (Node 22, final tree, hermes)

- `npx tsc --noEmit` ✔ · `npm run lint` ✔ · `npm run build` ✔
- `npx vitest run --maxWorkers=2`: **147 files passed (2 skipped), 1,946 tests passed, 15 skipped.**
  `chapterEnemies.test.ts > chapter two balance` passes (it was the base's failure).
- `npm run sim:balance`: **PASSED (50 levels)**.
- `npm run sim:difficulty`: all 10 checks PASS. "Frostveil eases after Lastlight and rises on
  Normal: i24 12, i28 13, i29 10, i30 9, i31 8, i32 7, i33 6 lives". Easy 34/34 (all ≥12), Normal
  34/34, Hard 15/34, 23 two-star / 9 three-star.
- `npm run sim:items -- --workers=2`: all 7 checks PASS. Weak Normal 5 → **10**/34 with the belt (needs
  +3), Hard 15 → 23/34, i24 Hard W 8/22 2★.

## Open / doubtful

1. **Frost margin on i29/i30:** 5.1 % against the new 5 % floor. Any edit to these islands may need a
   placement nudge (tighter beetle file or a beetle more), not HP.
2. **Losses land late, in one wave.** i31 loses all 14 lives on the final wave and i32/i33 lose 14 of
   15/16 there, against the final formations the isles-2 batch built (sledguard ×1.5/×2.8, kilnback
   ×5.5). i29 loses all on wave 12. i30 still loses 10 on wave 2 (open item 2 of waves-1). It reads as
   a climax, but a designer pass that spreads pressure into the mid waves would feel fairer; it needs
   its own tuning.
3. **Thin robustness cells** (all clear): i31 Tobb/Sela and i33 HP×0.97 win with 2 lives, i29
   HP×0.985 with 3.
4. The probe is not committed (its logic is above). `qa/ch4shield.mjs` is committed.
