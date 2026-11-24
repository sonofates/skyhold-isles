# Handoff: Per-Chapter Wave-Count Curve (`hermes/sky-ch-waves`)

## Summary

Implemented the per-chapter story wave-count curve from `docs/chapters-plan.md` across the 2D painted islands (`i01`–`i24`), while leaving `l1c` (10 waves) and the 3D campaign definitions (`src/data/levels/level*.ts`) completely untouched.

- **Measurement script:** Added `scripts/chapterWaves.ts` (`node --import tsx scripts/chapterWaves.ts [--md]`), printing ID, chapter, name, story wave count, target band, difficulty, wave-1 / final-wave ground HP scale, and pass/fail band status for every 2D island.
- **2D trimming/extension helper:** Added `adjustWaveCount`, `waveCount`, and `keepWaves` to `src/data/levels2d/campaignIsland.ts`.
  - When trimming (`i02`–`i16`), `adjustWaveCount` preserves wave `0`, the finale, all named `formations` / `replaceWaveEnemy` / `keepWaves` waves, and full enemy-type & ground-lane coverage; drops the weakest middle waves relative to the island's linear strength trend (spaced across the run); and folds dropped waves' expected gold (`clearBonus` + enemy/splitter/carrier kill rewards) into the preceding kept wave's `clearBonus` so cumulative economy and Tier-IV specializations stay intact.
  - When extending (`targetCount > n`), `adjustWaveCount` repeats the penultimate wave before the finale with `+6%` progressive HP growth per added copy without mutating the source array.
- **Chapter 1 (`i01`–`i09`, target 8–11, finale 11):** `i01` was already in-band at 10 waves and left untouched; `i02`–`i09` were trimmed in the 2D tuning layer to `10, 10, 10, 10, 11, 11, 11, 11`.
- **Chapter 2 (`i10`–`i16`, target 11–13, finale 13):** `i10`–`i16` were trimmed in the 2D tuning layer to `11, 11, 12, 12, 12, 12, 13` (using `keepWaves` on `i15` and `i16` so specialization test waves and entrance-count waves stay intact).
- **Chapter 3 (`i17`–`i24`, target 12–14, finale 14):**
  - `i17` (`10 → 12`), `i18` (`11 → 12`), and `i19` (`11 → 12`) were extended directly in their own `.ts` files, reusing existing wave names (`Updraft`, `Crosswind`, `Furnace Gate`) with no new i18n keys.
  - `i20`–`i24` were already in-band (`12, 12, 13, 13, 14` with `i24` at 14) and kept their exact wave counts; minor `enemyHpScale`/`waveHpGrowth`/group adjustments were made on `i20`–`i24` to absorb slightly lower cumulative Hero XP (1–3 hero levels) from trimming ~130 waves out of Chapters 1 and 2 while staying within the `groundHpCurve.test.ts` ±10% envelope and `rebalance-normal-v2.md` bands.
- **Tests updated:**
  - `tests/sim/campaignIslands2d.test.ts`: updated `i02`–`i16` expected-wave assertions for `waveCount`/`keepWaves`/retuned formations, and added unit tests covering the per-chapter wave-count bands and `adjustWaveCount` trimming/extension/gold-preservation invariants.
  - `tests/render/flowUi2d.test.ts`: updated the `i16` dedicated-air entrance test to look up `'Burning Freight'` by name rather than hardcoded index `6` (now index `4` after trimming).

## Before / After Wave Counts

| ID | Chapter | Name | Difficulty | Waves Before | Waves After | Target Band | HP 1st (After) | HP Last (After) | Status |
| --- | --- | --- | --- | ---: | ---: | --- | ---: | ---: | --- |
| l1c | Prologue | Meadow Crossing | Breezy | 10 | 10 | - (keep) | 1.380 | 3.397 | ok |
| i01 | Ch 1 | Sunlit Meadow | Breezy | 10 | 10 | 8–11 | 1.144 | 2.232 | ok |
| i02 | Ch 1 | Twin-Bridge Cay | Challenging | 14 | 10 | 8–11 | 1.720 | 6.604 | ok |
| i03 | Ch 1 | Highland Citadel | Heroic | 18 | 10 | 8–11 | 1.660 | 9.836 | ok |
| i04 | Ch 1 | Emerald Stepping Stones | Challenging | 14 | 10 | 8–11 | 1.150 | 4.592 | ok |
| i05 | Ch 1 | Windmill Switchback | Challenging | 15 | 10 | 8–11 | 1.620 | 6.964 | ok |
| i06 | Ch 1 | Crescent Lagoon | Heroic | 17 | 11 | 8–11 | 1.350 | 10.667 | ok |
| i07 | Ch 1 | Skybridge Gauntlet | Heroic | 18 | 11 | 8–11 | 1.650 | 10.140 | ok |
| i08 | Ch 1 | Sunken Bastion | Master | 20 | 11 | 8–11 | 1.980 | 14.834 | ok |
| i09 | Ch 1 | Grand Skyhold | Master | 22 | 11 | 11 (finale) | 1.955 | 16.705 | ok |
| i10 | Ch 2 | Confluence Terraces | Master | 20 | 11 | 11–13 | 1.110 | 8.381 | ok |
| i11 | Ch 2 | Galewatch Spires | Master | 20 | 11 | 11–13 | 1.940 | 15.896 | ok |
| i12 | Ch 2 | Lanternfall Hollow | Master | 20 | 12 | 11–13 | 2.260 | 17.446 | ok |
| i13 | Ch 2 | Stormcrown Citadel | Master | 22 | 12 | 11–13 | 1.960 | 15.130 | ok |
| i14 | Ch 2 | Amberstone Mesa | Master | 22 | 12 | 11–13 | 3.300 | 13.371 | ok |
| i15 | Ch 2 | Moonwell Crossing | Master | 22 | 12 | 11–13 | 3.820 | 15.173 | ok |
| i16 | Ch 2 | Emberglass Sanctum | Master | 24 | 13 | 13 (finale) | 2.280 | 12.223 | ok |
| i17 | Ch 3 | Cloudbell Cloister | Heroic | 10 | 12 | 12–14 | 2.013 | 4.234 | ok |
| i18 | Ch 3 | Lantern Glassworks | Master | 11 | 12 | 12–14 | 2.380 | 5.658 | ok |
| i19 | Ch 3 | Lanternseed Fig | Master | 11 | 12 | 12–14 | 1.710 | 4.004 | ok |
| i20 | Ch 3 | Three Pennants Head | Master | 12 | 12 | 12–14 | 2.030 | 5.150 | ok |
| i21 | Ch 3 | Kitewright Down | Master | 12 | 12 | 12–14 | 2.680 | 6.834 | ok |
| i22 | Ch 3 | Brineglass Ferry | Master | 13 | 13 | 12–14 | 1.880 | 5.016 | ok |
| i23 | Ch 3 | Waxlight Orchard | Master | 13 | 13 | 12–14 | 2.540 | 7.099 | ok |
| i24 | Ch 3 | Lastlight Head | Master | 14 | 14 | 14 (finale) | 1.980 | 5.859 | ok |

## Files Modified

- `scripts/chapterWaves.ts` (new)
- `src/data/levels2d/campaignIsland.ts`
- `src/data/levels2d/i02.ts` – `src/data/levels2d/i24.ts` (`i01.ts` unchanged)
- `tests/sim/campaignIslands2d.test.ts`
- `tests/render/flowUi2d.test.ts`
- `docs/handoff-chapter-waves.md` (new)

No changes were made to `src/data/levels/level*.ts`, UI source files, i18n dictionaries, `src/data/levels2d/index.ts`, `chapters.ts`, or new islands `i25`–`i27`.

## Verification

No browser QA was required (data-only task; no screenshots). All 7 required checks passed on the final working tree:

1. `npx tsc --noEmit` — **PASS** (0 errors)
2. `npm run lint` — **PASS** (0 errors, 0 warnings)
3. `npx vitest run` — **PASS** (`141 passed | 2 skipped (143)` test files, `1814 passed | 15 skipped (1829)` tests; includes all 25 `groundHpCurve.test.ts`, all 86 `campaignIslands2d.test.ts`, all 27 `flowUi2d.test.ts`, and all specialization tests: `deepDrifts`, `cloudbreak`, `silkLine`, `aftershock`, `teslaChains`, `dragChain`)
4. `npm run sim:difficulty` — **PASS** (9/9 verdicts):
   - Easy campaign: `25/25` wins, `25/25` with ≥12 lives
   - Easy weak: `14/17` Ch 1 wins
   - Normal campaign: `25/25` wins (`16` 2★, `9` 3★ — 36% ≤ 40%)
   - Hard campaign: `9/17` Ch 1 wins, `4/8` Ch 2 wins (target 3–5), `13/13` wins lose lives & earn 1–2★, `i24` clears `W 4/22 1★` (≤5 lives), weak Hard `2/25` wins (≤3)
5. `npm run sim:balance` — **PASS**: `Balance check PASSED: Greedy & Weak targets met across 41 level(s)!` (all 16 3D levels + all 25 2D islands + all 262 Normal variants)
6. `npm run sim:items -- --workers=2` — **PASS** (7/7 verdicts):
   - Fixed Normal belt: `25/25` on both profiles, retains `140/181` paired / `145/181` own progression (≥60%)
   - Auto-selected belt `[heartstone, cloudguard, emberPot]`: retains `123/181` Normal; weak Normal `5/25 → 8/25`, weak Easy `15/25 → 20/25`; campaign Hard `13/25 → 17/25` (`Ch2 5/8`); Ch2 Hard 3★ `0/5`, total Hard 3★ `2/17`, `i24` Hard `W 9/22 2★`, weak Hard `3/25`; dominance `1.15x / 1.11x / 1.96x`; economy `3.11` first-clears / `3.76` typical items/isle
7. `npm run build` — **PASS** (`✓ built in 1.95s`)

## Assumptions & Open Points

- **Keeping `i01` at 10 waves:** `i01` already had 10 waves (inside Chapter 1's 8–11 band), so per "change only islands outside their band" `i01` was left untouched at 10 and Chapter 1 rises monotonically `10 → 11` (`i01`–`i05 = 10`, `i06`–`i09 = 11`). If a lower opener (`8` or `9` waves on `i01`–`i02`) is desired later, `i01` can adopt `waveCount: 8` or `9` via `campaignIsland`.
- **Hero XP cadence after shorter Chapters 1–2:** Trimming ~130 waves across `i02`–`i16` lowers cumulative hero XP entering Chapter 3 by roughly 1–3 hero levels. Rather than editing `src/data/heroes.ts` (outside owned files), `i20`–`i24` received small balance nudges (`enemyHpScale`/`waveHpGrowth` and 1–2 wave group counts) to preserve all alt-hero clears and Hard targets without changing their wave counts. When parallel agents add `i25`–`i27` or adjust Chapter 3/4 progression, note that Bran reaches `i24` around L19 instead of L20.
- **`tests/render/flowUi2d.test.ts`:** Touched one test line (looking up `Burning Freight` on `i16` by wave name instead of hardcoded index `6`), kept minimal as it pinned the pre-trim wave index.
