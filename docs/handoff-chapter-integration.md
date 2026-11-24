# Handoff: chapter + new-islands integration test fixes

Branch `hermes/sky-ch-integ` (base `integ/chapters`). 2026-11-24.

After `integ/chapters` merged the chapter skeleton with the three new islands (i25, i26, i27), `npx vitest run` failed 7 tests. The real roster is now `l1c, i01..i15, i25, i26, i16, i17..i23, i27, i24` (28 islands). So i16 moved from flat index 16 to 18, i17 from 17 to 19, and i24 from 24 to 27.

## Verdict: all 7 were stale test assumptions; no production bug

Before changing any test, I checked every path an old save can come back through (`src/render2d/ui/progress2d.ts`):

- **Stored local save with ids**: `parseStored2DRaw` → `remapProgress(payload, storedIds, LEVELS_2D)`. It re-indexes by id: stars, endless, lives, clears, badges, all three `difficultyWins` rows and the frontier.
- **Stored save / save code without ids**: `legacyIdOrder()` reads the arrays in `LEGACY_2D_ORDER` (the flat order) and then remaps by id.
- **Save code with ids**: `decodeSaveCode2D` → `remapProgress(…, head.levelIds, …)`.
- **Cloud**: `hydrateProgress2DFromCloud` parses the cloud blob with the same `parseStored2DRaw`, so it is remapped by its own ids, or read flat if it has none. Only then does `mergeProgress` (which merges index by index) see two arrays on the same roster. The blob written back always carries today's ids.
- Other persisted data: achievements are id-based (`CHAPTER_TWO_ISLAND_IDS`), and hero unlocks are count-based (they never relock). The index-based cosmetic "seen" records (unveil / star pop) were already noted in `handoff-chapters-skeleton.md`.

A new regression test, run on the real roster, proves this. I also mutated `legacyIdOrder` once so it returned the chapter order: 4 of the 7 new tests failed, so the test does catch an id/order shift. Then I reverted the mutation.

## Per failure

| # | Test | Cause | Fix |
|---|------|-------|-----|
| 1a | `tests/data/chapters.test.ts` › "is the chapter order, with the unregistered slots skipped" | Stale: written while i25–i27 were unregistered (expected `LEVELS_2D` = flat order). | Now expects `LEVELS_2D` = `CAMPAIGN_ORDER` (28) and ≠ flat order. The skip-missing-slot behaviour moved to a new test, "an unregistered slot is skipped (synthetic pool without i25 / i27)", using `PARTIAL = orderByChapters(pool − i25 − i27)`. It also checks that a pool without any of the three new islands gives exactly `LEGACY_2D_ORDER`. |
| 1b | same › "missing slots leave a shorter chapter page" (expected `[9,7,8,0,0]`) | Stale. | New test "the real roster fills three pages of nine" (`[9,9,9,0,0]`, page contents = chapter slots, i26 on page 2, i27 on page 3). The shorter-page test now runs on `PARTIAL`: `[9,8,8,0,0]`, Ch 2 = `i10..i15, i26, i16`, Ch 3 = `i17..i23, i24`. |
| 1c | same › "a save without an id order is read in the flat pre-chapter order" | Stale: `legacyIdOrder(LEVELS_2D)` used to equal the current order. | Now: `legacyIdOrder(PRE_NEW)` = its own order. `legacyIdOrder(LEVELS_2D)` = flat + `i25, i26, i27`, and ≠ the current order. `legacyIdOrder(PARTIAL)` = flat + `i26`. The load-an-id-less-save part is unchanged and now runs on the real roster (`WITH_NEW = LEVELS_2D`; the i16/i24 stand-ins are gone). |
| 2 | `tests/sim/campaignIslands2d.test.ts` › i16 "resolves in campaign order…" | Stale: `LEVELS_2D[index + 1]` assumed the flat order (i16 at 16; it is at 18). | Now checks `LEVELS_2D.indexOf(level) === CAMPAIGN_ORDER.indexOf(id)`. |
| 3 | `tests/platform/saveRobustnessV2.test.ts` › "preserves full-length difficultyWins…" (`short17.difficultyWins.hard[24]`) | Stale: the run wins `levelId: 'i24'`, which `applyRunResult2D` records by id at index 27 (correct). Index 24 is now i22. | Reads i24's index by id (and asserts it is the last island), expects `hard[i24] = 3` and `bestStars[i24] = 3`, and adds `hard[24] = 0` (nothing leaks onto i22). |
| 4 | `tests/sim/qaSweepN2.test.ts` › mid-progress save sweep: "cloud merge missed Hard ribbon on i16" | Stale QA code in `qa/bot/saveSweep.ts`: the merge itself was right (its gain text already said "+1 Hard ribbon"), but the sweep read `hard[16]` (now i25). The same step also built its "old 17-island save" as `LEVELS_2D.slice(0, 17)` (now `l1c..i15, i25`), which is a roster that never existed. | `saveSweep.ts` reads by id via `at(id)`. The 17-island legacy save is now `LEGACY_2D_ORDER.slice(0, 17)` (`l1c..i16`); the check expects i16 kept, the frontier on i17, and i25/i26 empty. The "Chapter 2 daily" check uses the i17..i24 ids instead of `levelIndex >= 17`, and the i24 endless run uses i24's own wave count. |
| 5 | `tests/sim/qaBot.test.ts` › "quick headless QA bot slice … on l1c with 0 violations" (`failedScenarios` 1) | Same root cause as #4: `runQaBotSuite` runs `runMidProgressSaveSweep` and counts its violations as one failed scenario, `campaign:mid-progress-save-sweep`. All l1c strategy scenarios passed. | Fixed by #4. |

No assertion was weakened. Each changed test checks the same thing (or more) on the right ids.

## New regression test

`tests/platform/chapterReorderSaves.test.ts` (7 tests, real roster). It builds an old flat 25-island save in which every island carries a unique fingerprint (`bestEndlessWaves = 100 + flat index`, `bestLives = flat index + 1`). It has Hard ribbons on i16 and i24, an Easy-only win on i17, a badge on i20, and the frontier on i24. For each path below, the test checks that every island's full record lands on the same id. It also checks that i25–i27 are empty but open, and that the frontier stays on i24:

- stored with the flat id order; stored without ids (bare and wrapped);
- save codes with and without ids; `importSaveCode2D` of an id-less code;
- cloud: an old flat cloud blob (with or without ids) merged into a new local save (gain "+2 Hard ribbons", written back with today's ids);
- cloud: a new device's Hard ribbon on i16 merged into an old flat local save. It lands on i16 (not i25/i26), with gain "+1 Hard ribbon".

## Verification

- `npx tsc --noEmit`, `npm run lint`: pass.
- `npx vitest run`: all pass (full suite).
- `npm run sim:balance`, `npm run sim:items -- --workers=2`, `npm run sim:difficulty`, `npm run build`: pass.
- No browser was started.

## Notes / open

- `src/platform/achievements.ts` still calls `i17..i24` "Chapter Two" (enemy-roster naming from before chapters; in the chapter list those islands are Chapter 3, and i27 is not in that set). The achievement texts and Steam ids were not touched, because renaming a Steam achievement is an owner decision.
- `qa/bot/saveSweep.ts` comments still use the old "Chapter 2 = i17..i24" wording in places that describe the enemy roster.
