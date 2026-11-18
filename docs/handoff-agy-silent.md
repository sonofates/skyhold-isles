# Handoff — Restore "Silent Skies" Challenge in 2D (`agy-silent`)

- **Branch:** `hermes/skyhold-silent` (base: `art-2d` @ `29b82d9`)
- **Date:** 2026-11-18
- **Scope:** Pure data/mode logic + unit tests only (`src/data/runModifiers.ts`, `src/data/challenges.ts`, `src/data/daily.ts`, `src/render2d/ui/modes2d.ts`, `tests/render/modifiers2d.test.ts`). No other UI, renderer, or art files were touched.

---

## 1. What Was Done

Now that **Meteor Strike** and **Overcharge** are live in the 2D sim (`SimWorld`) and 2D HUD (`abilityBar2d.ts` / `abilities2d.ts`), ability-modifying rules have real gameplay impact on 2D plot maps:

1. **Count ability modifiers in 2D while preserving data-driven filtering (`src/data/runModifiers.ts`, `src/data/challenges.ts`):**
   - Updated `hasModifierEffectIn2D(patch)` so `abilitiesDisabled: true` (`Silent Skies`) and `abilityCooldownMul !== 1` (`Quickcast Runes`) evaluate to `true` instead of being forced to neutral.
   - Kept the data-driven no-effect guard in `hasModifierEffectIn2D` (and delegated `isChallengeEffectiveIn2D(challenge)` to it): empty/neutral patches and `bannedTowers` / `towerFireRateMul` entries targeting tower types not present in `TOWER_DEFS` still evaluate to `false`.
   - `CHALLENGE_IDS_2D` now automatically includes `'silentSkies'` (all 10 `CHALLENGE_IDS`).
   - `challengesForLevel(level)` now offers `silentSkies` on 2D plot maps per the same rules as 3D:
     - Master 2D islands (`i08`–`i16`) offer the full pair `['silentSkies', 'ironTide']` instead of `['ironTide']` alone.
     - Any hand-picked `ISLAND_CHALLENGES` slug given a `layout2d` preserves its 3D pair (including `silentSkies`).
   - Because `availableChallenges`, `recordWin2D` / `applyRunResult2D`, `islandStates` mastery, Logbook badge totals, Feats, and Steam achievements all delegate to `challengesForLevel(level)`, `Silent Skies` automatically appears on 2D briefing cards, awards its badge + `+1★` Workshop star, and counts toward island mastery.

2. **Wire `CHALLENGE_IDS_2D` into 2D Daily Squall & URL challenge validation (`src/render2d/ui/modes2d.ts`, `src/data/daily.ts`):**
   - Updated `dailyForToday` in `src/render2d/ui/modes2d.ts` to pass `CHALLENGE_IDS_2D` to `dailyChallengeFor(utcDayNumber(ms), cleared, CHALLENGE_IDS_2D)`, including `silentSkies` in the 2D Daily Squall pool with exact 3D daily seed parity while retaining data-driven filtering for any future non-2D challenge.
   - Added an `isChallengeEffectiveIn2D(CHALLENGES[token])` check in `resolveQueryRun2D` so URL `?challenge=` parameters accept `silentSkies` (and all effective 2D challenges) while ignoring any hypothetical no-effect challenge with a warning.

3. **Unit tests (`tests/render/modifiers2d.test.ts`):**
   - Data-driven `hasModifierEffectIn2D` / `isChallengeEffectiveIn2D` checks: `abilitiesDisabled` and `abilityCooldownMul` return `true`; neutral patches and unknown-tower bans/multipliers return `false`.
   - 2D island offerings (`availableChallenges` and `challengesForLevel`) match 3D rules across `LEVELS_2D` (`i08`–`i16` offer `['silentSkies', 'ironTide']`) and plot-wrapped `LEVELS`.
   - Launching `?level=i08&challenge=silentSkies` (even with maxed Workshop ranks) sets `abilityGate` and both `abilitySlotView` states (`meteor`, `overcharge`) to `'disabled'` and blocks casts via both `castMeteor2D` / `castOvercharge2D` (with a built tower on plot 0) and `SimWorld.castMeteor` / `castOvercharge` / `castAbility`.
   - Winning a 2D Master island with `silentSkies` records the badge once, grants `+1★` Workshop currency, marks `completed: true` in `availableChallenges`, and gates island mastery on clearing both `silentSkies` and `ironTide` with 3★.
   - 2D Daily Squall (`dailyForToday` + `resolveQueryRun2D('daily=1')`) rolls `silentSkies` identically to 3D and disables both ability casts in `SimWorld` on `silentSkies` days.

---

## 2. Files Touched

- `src/data/runModifiers.ts`
- `src/data/challenges.ts`
- `src/data/daily.ts`
- `src/render2d/ui/modes2d.ts`
- `tests/render/modifiers2d.test.ts`
- `docs/handoff-agy-silent.md`

---

## 3. Gate Numbers

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **PASS** (0 errors) |
| `npm run lint` | **PASS** (0 errors, 0 warnings) |
| `npm test` | **PASS** — **87 test files passed** (1 skipped), **1,145 tests passed** (11 skipped, 0 failed; +3 net tests in `tests/render/modifiers2d.test.ts`) |
| `npm run sim:balance` | **PASS** — **33/33 levels PASS**, output **byte-identical** (`diff -u` = 0 bytes across 645 lines / 49,607 bytes) |
| `npm run build` | **PASS** (Vite production bundle clean on Node `22.21.1`) |

---

## 4. Anything Left Undone or Doubtful

- None within scope. All existing 2D UI surfaces (`briefing.ts`, `metaScreens.ts` Logbook/Daily, `abilityBar2d.ts` disabled slot styling, `seal-silentSkies` manifest entry, EN/TR localization strings) already consume `challengesForLevel`, `availableChallenges`, `dailyForToday`, and `mods.abilitiesDisabled` dynamically without needing UI/render edits.

---

## 5. Open Questions for the Owner

1. **Per-island challenge pairs on `i01`–`i16`:** Currently `LEVELS_2D` (`i01`–`i16`) resolve through `DEFAULT_BY_DIFFICULTY` (so all 9 Master islands `i08`–`i16` offer `['silentSkies', 'ironTide']`, while `i02`/`i04`/`i05` offer `['thaw', 'galeForce']`). Once 2D becomes the primary campaign list, would you like `i01`–`i16` to inherit the varied per-island pairs from `ISLAND_CHALLENGES` (e.g. `Silent Skies` on `i05`, `i08`, `i11`, `i15` alongside `Still Air`, `Champion Host`, or a new `Barracks` ban challenge)?
