# Handoff: rebalance after the chapter merge

Branch `hermes/sky-ch-rebal` (base `integ/chapters` @ `63acce3a`). 2026-11-24. Island data only.

## Why

The wave-count curve (`docs/handoff-chapter-waves.md`) was tuned without i25–i27, and i25–i27 were tuned without the curve. Put together, the Normal campaign reaches every island after i15 with a different kit: i25/i26 now sit at index 16/17 (Bran L17) and Chapter 3 starts one hero level higher than before (Bran reaches L20 at i22). On the base commit, four gates were red. Only the first was reported in the task:

| Gate on `63acce3a` | Failure |
|---|---|
| `vitest` › chapterEnemies › chapter two balance | i25 20 lost (window 6–11) · i26 5 lost (7–12) · i19 4 lost (9–14), drop after 8, flyer leaks 3/4 · i23 3 lost (9–14), drop after 13 |
| `sim:balance` (robustness) | same as above, plus i25 Wren/Tobb/Sela, i26 all four alternate heroes and i27 Tobb did not clear |
| `sim:items -- --workers=2` | weak Normal 5/28 → 5/28 with the belt (needs +3) · Ch2 Hard 3★ = 1/7 with the belt (needs 0) |
| `sim:difficulty` | Normal first clears 12 three-star (max 11) |

## Changes

All values are in `src/data/levels2d/`. No wave counts, paths, plots, art, UI, i18n, `chapters.ts`, 3D levels, hero XP tables, tests or sim criteria were changed. Every change stays inside the ±10 % `groundHpCurve` envelope.

| Island | Change | Why |
|---|---|---|
| i25 | `enemyHpScale` 2.1 → 1.935 | Normal window and alternate heroes |
| i26 | `enemyHpScale` 2.31 → 2.165 | Normal window (the lighter run spreads the losses) and alternate heroes |
| i19 | `enemyHpScale` 1.71 → 1.74 | Normal window and flyer share. 1.745 also passes the sims but loses the `teslaChains` maxed-kit Hard Live Wire clear; 1.74 keeps it |
| i23 | Windfalls elite golems (`waves[5]` group 4) `startDelay` 0 → 0.45 s · `startingGold` 395 → 380 | The Bran L20 greedy run was bimodal: that convoy either leaked 9–12 lives or none. The delay makes the leak happen. The gold cut stops the Hard belt run from reaching 3★ |
| i27 | `enemyHpScale` 1.62 → 1.625 · `startingGold` 400 → 405 | i23's change pushed i27 into a Tobb loss and a Hard-belt 3★. This is the nearest setting that passes. The no-item Hard result is unchanged (W 11/22 2★) |
| i06 | `enemyHpScale` 1.35 → 1.297 | weak Normal + belt flip |
| i09 | `enemyHpScale` 1.9549 → 1.96 | weak Normal + belt flip |
| i11 | `enemyHpScale` 1.94 → 1.977 | weak Normal + belt flip |

**Item belt.** `sim:items` picks the belt automatically by value per crystal. The top four items are within ~10 % of each other. After the merge the pick dropped emberPot ([heartstone, cloudguard, skyPurse]), and with that belt no weak Normal run flipped. i03/i06/i09 only flipped with emberPot. I didn't target one belt. Instead I picked i06/i09/i11 values where the flip happens with **either** belt ([cloudguard, skyPurse, heartstone] and [heartstone, cloudguard, emberPot]), checked per island with a direct `executeItemSimJob` probe. The final run picked emberPot again and flips 4 (5 → 9).

**No cascade from the Ch1/Ch2 edits.** On i06, i09 and i11 the Normal greedy run keeps identical lives lost, stars and hero XP (575 / 742 / 714). Every later island's entry kit (Normal and Hard) is therefore unchanged. Bran is at the L20 cap from i22 on, so i23/i27 tweaks only move alternate-hero levels by a few XP points.

## Before → after (Normal campaign kit, lives lost / stars)

From `sim:balance` (greedy default, weak, robustness variants). Windows are `islandLossWindow` by campaign index.

| Island | Window | Greedy | Weak | HP×0.97 / 0.985 / 1.015 / 1.03 | Alternate heroes (all must clear) |
|---|---|---|---|---|---|
| i25 | 6–11 | **20/1★ → 9/2★** | L w7 → L w8 | 14/14/3/3 → 1/11/11/11 | Wren L, Tobb L, Sela L → 0, 4, 5, 18 lost (Mira 4 → 4) |
| i26 | 7–12 | **5/3★ → 9/2★** | L w6 → L w6 | 3/7/8/5 → 5/0/2/6 | all four L → Wren 3, Mira 8, Tobb 9, Sela 10 |
| i19 | 9–14 | **4/3★ → 11/2★** (flyers 3/4 → 3/11) | L w12 → L w12 | 4/5/12/12 → 5/5/14/6 | 0/0/3/0 → 2/6/3/8 |
| i23 | 9–14 | **3/3★ → 12/2★** | L w8 → L w6 | 9/0/4/0 → 1/3/5/0 | 6/6/5/8 → 6/5/6/6 |
| i27 | 9–14 | 12/2★ → 10/2★ | L w12 → L w12 | 17/18/17/15 → 6/11/14/9 | Tobb L → 18; Wren 19 → 18, Mira 16 → 13, Sela 16 → 16 |
| i06 | 6–8 | 6/2★ → 6/2★ | L w11 → L w11 | 8/12/20/12 → 7/11/12/10 | Wren 19 → 12, Mira 10 → 10 |
| i09 | 4–8 | 5/3★ → 5/3★ | L w11 → L w11 | 5/5/5/5 → 5/5/5/5 | 10/10/10 → 10/10/10 |
| i11 | 6–11 | 10/2★ → 10/2★ | L w10 → L w11 | 13/13/12/11 → 12/12/11/9 | 13/11/11/11 → 12/10/11/12 |

Across the whole Normal chain, every island is inside its window with no drop greater than 3. The greedy results of the islands not listed (l1c–i15 except i06/i09/i11, then i16–i18, i20–i22, i24) are identical to the base.

## Before → after (items and difficulty)

`sim:items` belt rows (no items → belt). Before: belt [heartstone, cloudguard, skyPurse]. After: [heartstone, cloudguard, emberPot].

| Island | weak Normal | campaign Hard |
|---|---|---|
| i06 | L w11 → L w11 ⇒ **L w11 → W 6/21 1★** | L w4 → L w5 ⇒ L w5 → L w5 |
| i09 | L w11 → L w11 ⇒ **L w11 → W 1/22 1★** | W 12 2★ → W 12 2★ (unchanged) |
| i11 | L w10 → L w11 ⇒ **L w11 → W 2/22 1★** | W 14 2★ → W 16 3★ ⇒ W 13 2★ → W 20 3★ (not Ch2) |
| i23 | L w8 → L w8 ⇒ L w6 → L w10 | **L w11 → W 19/22 3★** ⇒ L w6 → W 11/22 2★ |
| i27 | L w12 → L w12 (unchanged) | **W 7 1★ → W 13 2★** ⇒ W 11 2★ → W 11 2★ |
| i25 | L w7 → L w8 ⇒ L w8 → L w8 | L w9 → L w9 ⇒ L w11 → W 14/22 2★ |
| i26 | L w6 → L w6 ⇒ L w6 → L w7 | L w4 → L w10 ⇒ L w5 → L w5 |
| i19 | L w12 → L w12 (unchanged) | L w9 → W 8 1★ ⇒ L w12 → W 12 2★ |

(On the base run, i23 Hard was 3★ with the belt; on the intermediate state, i27 was too.)

`sim:difficulty` Hard rows for touched islands, before → after: i06 L w4 → L w5, i09 W 12 2★ (same), i11 W 14 2★ → W 13 2★, i19 L w9 → L w12, i23 L w11 → L w6, i25 L w9 → L w11, i26 L w4 → L w5, i27 W 7 1★ → W 11 2★. Hard totals are unchanged: Ch 1 9/19, Ch 2 5/9.

| Verdict | Before | After |
|---|---|---|
| Normal 3★ first clears (≤ 40 %) | 12 (FAIL) | 9 |
| weak Normal belt wins (≥ base + 3) | 5 → 5 (FAIL) | 5 → 9 |
| Ch2 Hard 3★ with belt (= 0) | 1/7 (FAIL) | 0/8 |
| total Hard 3★ with belt (≤ 6) | 3/19 | 2/21 |

## Verification (final tree)

- `npx tsc --noEmit`: pass. `npm run lint`: pass.
- `npx vitest run`: 145 files passed, 2 skipped; 1866 tests passed, 15 skipped. This includes `chapterEnemies` chapter-two balance, `groundHpCurve`, `teslaChains` (i19 Live Wire Normal/Hard) and `campaignIslands2d`.
- `npm run sim:balance`: `Balance check PASSED: Greedy & Weak targets met across 44 level(s)!`
- `npm run sim:items -- --workers=2`: 6/6 PASS (retains 142/211 net lives; weak Normal 5 → 9, weak Easy 15 → 21; Hard 14 → 21, Ch2 8/9; Ch2 Hard 3★ 0/8, total 2/21, i24 Hard W 9/22 2★, weak Hard 3/28; dominance 1.00x/1.01x/1.55x; 3.09/3.69 items per island).
- `npm run sim:difficulty`: 9/9 PASS (Easy 28/28 ≥12 lives; Easy weak 14/19; Normal 28/28, 19 two-star / 9 three-star; Hard Ch1 9/19, Ch2 5/9, 14/14 wins lose lives with 1–2★; i24 Hard W 4/22 1★; weak Hard 2/28).
- `npm run build`: pass.
- No browser started. Sims ran one at a time, with items at `--workers=2`.

## Open points / risks

- **Knife edges.** The greedy script is chaotic: one hero cast or a one-tick timing shift can move a run by 9–12 lives. i23 is the most fragile; its HP±1.5–3 % variants clear with 0–5 lost, all outside the window, but only the default run is gated. i25, i26 and i27 have 1–3 of 4 HP variants inside the window. Any later change upstream of an island (hero XP, Workshop, enemy defs) can push these out again.
- **Belt selection is close.** The top four items are within ~10 % value per crystal, so the auto-picked belt can change on any island edit. The weak-Normal flips were chosen to hold under both belts seen so far. A third belt (for example with galeBell) was not checked.
- **`balanceSim.ts` exempts campaign index 17 from the "drop > 3" rule.** It was written for i17, the first Ch3 island, but index 17 is now i26. I left it as is (no sim-criterion changes). i17 (index 19) passes the drop rule anyway (7 lost after 7). The owner may want the exemption to follow i17 by id.
- `sim:items` / `sim:difficulty` "chapter two" still means the i17–i24 + i27 roster set, not chapter page 2 (same note as `handoff-chapter-integration.md`).
