# Handoff: chapter four loss spread on i29 and i30 (Task G, branch `hermes/sky-ch4-spread`, 2026-11-25)

Closes open item 1 from `docs/handoff-ch4-final.md`. Previously on Normal (campaign kit, greedy script),
`i29` Hearthsmoke Hamlet lost all 12 of its lives on wave 12 (100 %) and `i30` Pinewhite Ridge lost 10 of 13
lives on wave 2 (77 %, an early wall). Both islands now spread their losses across the final third (waves
10–13) with no single wave exceeding 50 % of lives lost, while preserving their exact Normal life totals
(`i29` 10/22, `i30` 9/22, both 2★), 13-wave structure, wave names, clear bonuses, build orders, Rime Beetle
introduction on `i29` wave 2 ("New" tag), and the full verification gate.

Only `src/data/levels2d/i29.ts`, `src/data/levels2d/i30.ts`, `tests/data/groundHpCurve.test.ts` (i29/i30
baselines and `finaleHp`), and this handoff were changed. No maps, art, layouts, `chapters.ts`, store code,
chapter-five files, or foe stats were touched.

## 1. Per-island summary (Normal, greedy, campaign kit; `sim:balance`)

| Island | Lives left (of 22), before → **after** | Where the lives go, before | Where the lives go, **after** | Max single wave, before → **after** | Last-third share, before → **after** | Frost on beetle waves (5–15 %), before → **after** | Stars |
|---|---|---|---|---|---|---|---|
| `i29` Hearthsmoke Hamlet | 10 → **10** (12 lost) | w12:12 | **w12:6 · w13:6** | 100 % → **50 %** | 100 % → **100 %** | 5.1 % → **5.7 %** (14.3 % inside a patch) | 2★ → 2★ |
| `i30` Pinewhite Ridge | 9 → **9** (13 lost) | w2:10 · w4:3 | **w10:3 · w12:6 · w13:4** | 77 % → **46 %** | 0 % → **100 %** | 5.1 % → **5.9 %** (14.7 % inside a patch) | 2★ → 2★ |

The chapter-four Normal first-clear curve is byte-for-byte unchanged:
**i24 12 · i28 13 · i29 10 · i30 9 · i31 8 · i32 7 · i33 6 · i34 5 · i35 4 · i36 2** (and Eclipse **7 > 6 > 4**).

## 2. Before / after per-wave loss tables (Normal, greedy, campaign kit)

### `i29` Hearthsmoke Hamlet (13 waves, 22 starting lives, 12 lost before & after)

| Wave | Name | Before: lives lost (leaks) | Before share | **After: lives lost (leaks)** | **After share** |
|---:|---|---:|---:|---:|---:|
| 1 | Cold Hearths | 0 | 0 % | **0** | 0 % |
| 2 | First Basket *(New: Rime Beetle)* | 0 | 0 % | **0** | 0 % |
| 3 | Under the Nets | 0 | 0 % | **0** | 0 % |
| 4 | The Alder Sledge | 0 | 0 % | **0** | 0 % |
| 5 | A Fork in the Ice | 0 | 0 % | **0** | 0 % |
| 6 | Fish Under Glass | 0 | 0 % | **0** | 0 % |
| 7 | At the Hatch | 0 | 0 % | **0** | 0 % |
| 8 | Cinders on Snow | 0 | 0 % | **0** | 0 % |
| 9 | The Racks Fill | 0 | 0 % | **0** | 0 % |
| 10 | Borrowed Coals | 0 | 0 % | **0** | 0 % |
| 11 | Stoke the Fire | 0 | 0 % | **0** | 0 % |
| 12 | The Draught Changes | 12 (`kilnback:5`, `burrower:2`) | **100 %** | **6** (`kilnback:3`) | **50 %** |
| 13 | Smoke Above the Lake | 0 | 0 % | **6** (`golem:2`) | **50 %** |
| **Total** | | **12 lost (10/22 left, 2★)** | **max 100 %** | **12 lost (10/22 left, 2★)** | **max 50 %** |

### `i30` Pinewhite Ridge (13 waves, 22 starting lives, 13 lost before & after)

| Wave | Name | Before: lives lost (leaks) | Before share | **After: lives lost (leaks)** | **After share** |
|---:|---|---:|---:|---:|---:|
| 1 | Brake Shoe | 0 | 0 % | **0** | 0 % |
| 2 | Red Pennant | 10 (`mite:6`, `warden:2`) | **77 %** | **0** | 0 % |
| 3 | Needles on the Wind | 0 | 0 % | **0** | 0 % |
| 4 | Two Ruts | 3 (`golem:1`) | 23 % | **0** | 0 % |
| 5 | The Trestle Sings | 0 | 0 % | **0** | 0 % |
| 6 | Spruce Shadows | 0 | 0 % | **0** | 0 % |
| 7 | Load Shift | 0 | 0 % | **0** | 0 % |
| 8 | Across the Saddle | 0 | 0 % | **0** | 0 % |
| 9 | Cut the Lashings | 0 | 0 % | **0** | 0 % |
| 10 | Blue Cornice | 0 | 0 % | **3** (`draftwing:3`) | **23 %** |
| 11 | Cold Iron | 0 | 0 % | **0** | 0 % |
| 12 | Set the Brake | 0 | 0 % | **6** (`golem:2`) | **46 %** |
| 13 | Lamps Below the Ridge | 0 | 0 % | **4** (`kilnback:2`) | **31 %** |
| **Total** | | **13 lost (9/22 left, 2★)** | **max 77 %** | **13 lost (9/22 left, 2★)** | **max 46 %** |

Flyer share on `i29` is 0/12 (0 %) and on `i30` is 3/13 (23 %, well below the 55 % cap).

## 3. What changed in the data (1-based waves)

Both islands use the capped-wall pattern established in `docs/handoff-ch4-final.md` so alternate heroes and
HP perturbations cannot spiral into uncontrolled wave wipes, paired with wider/earlier beetle spacing so
frost stays comfortably above the 5 % floor.

- **`src/data/levels2d/i29.ts`**
  - `enemyHpScale`: `2.904 → 2.96` (+1.9 %; `tests/data/groundHpCurve.test.ts` baseline updated to `[2.96, 8.118435]`, `finaleHp.i29 = { golem: 3.5 }`).
  - **w2**: untouched (4 Rime Beetles on lane 1, east boathouse; "New" tag & frost test unchanged).
  - **w6**: `rimebeetle` `6 @ 0.9 s (delay 4.4 s) → 7 @ 1.05 s (delay 3.4 s)`.
  - **w8**: elite `splitter` `hpScale: 1.2` (keeps the weak script losing cleanly on w12 without moving greedy).
  - **w9**: `rimebeetle` `6 @ 0.9 s (delay 4.4 s) → 7 @ 1.15 s (delay 2.2 s)`.
  - **w12**: elite `kilnback` `7 → 4 at hpScale 2.4`; elite `burrower` `7 → 6`; `rimebeetle` `5 @ 0.9 s (delay 6.2 s) → 7 @ 1.15 s (delay 2.6 s)`.
  - **w13**: elite `golem` `8 → 2 at hpScale 3.5` (capped 6-life finale wall).
- **`src/data/levels2d/i30.ts`**
  - `enemyHpScale`: `2.395` (unchanged; `tests/data/groundHpCurve.test.ts` adds `finaleHp.i30 = { kilnback: 3.2 }`).
  - **w2**: `warden` `4 on lane 1 (delay 0 s) → 3 on lane 0 (delay 0.75 s)`; `mite` `13 (delay 2.8 s) → 12 (delay 3.6 s)` (removes the wave-2 early wall on the short west road).
  - **w4**: `golem` `4 on lane 1 → 3 on lane 0` (removes the wave-4 early leak).
  - **w10**: `draftwing` `5 → 6 at hpScale 2.1`; `rimebeetle` `6 @ 0.9 s (delay 6.2 s, lane 1) → 6 @ 1.05 s (delay 3.4 s, lane 0)`.
  - **w12**: elite `golem` `3 → 2 at hpScale 2.6`; `rimebeetle` `6 @ 0.9 s (delay 6.2 s) → 6 @ 1.05 s (delay 3.4 s)`.
  - **w13**: elite `kilnback` `9 → 4 at hpScale 3.2`; `golem` `7 elite → 3 non-elite` (prevents alternate-hero wipes on the finale); elite `rimebeetle` `6 @ 0.54 s (delay 6.2 s, lane 0) → 6 @ 1.1 s (delay 3.4 s, lane 1)` (spreads patches instead of clumping them and keeps beetles active on both lanes).

## 4. Robustness (lives **lost**; every cell clears; `sim:balance`)

| Island | default | HP ×0.97 / 0.985 / 1.015 / 1.03 | seeds 1 / 727 | Wren / Mira / Tobb / Sela | Weak (Normal) | Easy | Hard |
|---|---|---|---|---|---|---|---|
| `i29` | 12 (2★) | 9 / 5 / 10 / 13 | 12 / 12 | 14 / 19 / 20 / 14 | L @12 | 27/27 | L @8 |
| `i30` | 13 (2★) | 8 / 19 / 13 / 18 | 13 / 13 | 19 / 12 / 17 / 19 | L @13 | 27/27 | L @7 |

With the 3-item belt (`[skyPurse, cloudguard, emberPot]`), `i29` flips weak Normal (`L @12 → W 7/22 1★`) and
campaign Hard (`L @8 → W 2/22 1★`), while `i30` keeps campaign Normal at 10/22 (2★) and pushes Hard from
wave 7 to wave 13.

## 5. Gate (Node 22, final tree, sims run one at a time, `--workers=2`)

- `npx tsc --noEmit` ✔
- `npm run lint` ✔
- `npx vitest run --maxWorkers=2`: **148 files passed (2 skipped), 2,033 tests passed, 15 skipped.**
- `npm run sim:balance`: **PASSED (56 levels)** (including `i29`/`i30` frost band, robustness, workshop-max, endless sanity).
- `npm run sim:difficulty`: **all 12 checks PASS.** Easy 40/40 all ≥12, Normal 40/40 (23 two-star / 9 three-star),
  Frostveil `i24 12, i28 13, i29 10, i30 9, i31 8, i32 7, i33 6`, finale `6 > 5 > 4 > 2`, Eclipse `7 > 6 > 4`,
  Hard 16/40 (Ch1 9/19, Ch2 5/9, all wins 1–2★ losing lives, `i24` W 4/22 1★), Hard weak 2/40.
- `npm run sim:items -- --workers=2`: **all 7 checks PASS.** Normal belt 40/40 (`283/394` paired, `288/394`
  own progression), selected belt `279/394`, weak Normal `5 → 13/40`, weak Easy `27 → 29/40`, campaign Hard
  `16 → 26/40` (Ch2 6/9), Hard 3★ `3/26`, `i24` Hard W 8/22 2★, dominance `1.00x / 1.14x / 1.34x`, economy
  `2.99` first-clears / `3.61` typical items per island.
- `npm run build` ✔ (only the existing Vite chunk-size and dynamic-import advisories).
- Browser QA: not needed (data-only wave tuning).

## 6. Open / notes

- **Thin robustness cell (clears):** `i29` Tobb loses 20/22 (same margin as `i31` Wren and `i33`/`i36` Sela
  in `docs/handoff-ch4-final.md`); `i30` Wren and Sela lose 19/22 (Sela was 19/22 before as well).
- **Capped-wall feel:** As noted in `docs/handoff-ch4-final.md` open item 4, the small high-HP formations
  (`i29` w12 kilnbacks ×2.4, w13 golems ×3.5; `i30` w12 golems ×2.6, w13 kilnbacks ×3.2) are worth including
  in a designer playtest to confirm they feel fair against active hero abilities and items.
- **`i28` untouched:** `i28` Rimeharbor (67 % max wave, w8:3 w13:6) was outside this task's scope.
