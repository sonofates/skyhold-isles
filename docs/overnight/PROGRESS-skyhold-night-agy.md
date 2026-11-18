# PROGRESS — skyhold-night-agy (QA, Balance, Logic Robustness)

- **Branch:** `hermes/skyhold-night-agy` (base: `art-2d` @ `0f854bb`)
- **Started:** 2026-11-18 ~22:52 UTC (01:52 TR) · **Deadline:** 09:00 TR (06:00 UTC)
- **Strict Ownership:**
  - **Ours:** `src/sim/**` *(EXCEPT `src/sim/enemySystem.ts`)*, `src/data/{heroes,towers,abilities,balance,challenges,daily,runModifiers,workshop}.ts`, `src/render2d/heroes2d.ts`, `src/render2d/ui/{progress2d,modes2d}.ts` *(logic only)*, `src/platform/**`, `src/core/**`, `scripts/**` *(coordinate `balanceSim.ts` via PROGRESS)*, `qa/bot/**`, `tests/**`, `package.json` (`qa:bot` script).
  - **Untouched:** visual UI, `game2d.ts`, `main2d.ts`, render layers, art, `tools/**`, `src/data/levels2d/**`, `src/data/enemies.ts`, `src/sim/enemySystem.ts`, `src/i18n/**`.

---

## Backlog Status

- [x] **1. Headless QA Bot (`qa/bot/**`, `npm run qa:bot`) + Sim Bug Fixes** — *DONE (Round 1)*
  - Built multi-worker Node headless runner (`qa/bot/{index,worker,runner,strategies,invariants,hash}.ts`) + unit/regression suite (`tests/sim/qaBot.test.ts`).
  - Plays all 17 2D islands (`l1c`, `i01`–`i16`) across `greedy` (17), `weak` (17), `abilities` on cooldown + barracks rally/sell-rebuild (17), all 5 `heroes` at L1/L10/L20 across 5 park modes (`castle`, `merge`, `front`, `altLane`, `roam` = 260), island `challenges` (34), `daily` squalls (17), `endless` 10 waves incl. `startEndlessFromStart` (19), and 11 full bit-exact determinism replay pairs = **381 scenarios / 18,299,977 sim ticks** (~79s across 6 workers; `--quick` mode for fast CI/Vitest slices).
  - Initial sweep caught **930 invariant violations** across 4 real sim bugs in our owned area — **all 4 fixed** (`381/381` scenarios now pass with `0` violations):
    1. **`GroundGraph.findPath` cross-chasm shortcut & melee off-road drift (`src/sim/groundGraph.ts`, `src/sim/heroSystem.ts`):** `DIRECT_WALK_DIST` (`1.4u`) previously allowed walking straight across unconnected chasms when two road verges passed within `3.8u`, and melee engagement/post-return (`i08:hero:bran:L10:roam`) drifted past `HERO_RULES.maxOffRoadDist` (`1.301u > 1.2u`). Fixed by requiring shared road neighborhood for direct steps, routing post returns > `1.4u` along `groundGraph.findPath`, and clamping melee steps onto walkable ground.
    2. **Tobb's Deploy Gizmo landing on build plots (`src/sim/heroSystem.ts`, `src/sim/world.ts`):** Caught 448 violations (`l1c` plots 3 & 9, `i01` plots 5 & 9, etc.). Fixed via `HeroSystem.resolveGizmoPlacement`, which enforces `>= plotRadius * 1.28` clearance from every plot in `grid.plots` while searching nearby road/verge positions within cast range (verified exhaustively across every plot of all 17 islands in `tests/sim/qaBot.test.ts`).
    3. **Unbalanced `enemyBlocked` / `enemyUnblocked` events (`src/sim/heroSystem.ts`, `src/sim/soldierSystem.ts`):** When Bran entered melee contact and died on the same tick, or when barracks soldiers and Bran co-held an enemy, `enemyBlocked` could fire twice or fail to emit `enemyUnblocked` when the hold ended. Fixed in both systems so block/unblock events stay 1-to-1.
    4. **Leaked mid-flight projectiles, burn zones & fire rings on victory + `debugSkipToWave` (`src/sim/world.ts`, `src/sim/abilitySystem.ts`, `src/sim/heroSystem.ts`, `src/sim/soldierSystem.ts`):** Winning a story run froze mid-air projectiles/mortar burn patches/fire rings indefinitely. Added `clearVictoryTransients()` on story win, full transient reset in `debugSkipToWave`, and `world.dispose()` for complete post-run teardown. Also fixed missing `tower.heroRangeBonus` on Archer T3 `fireVolley` (`src/sim/combatSystem.ts`).
- [x] **2. Hero Balance (`src/data/heroes.ts`, `src/sim/heroSystem.ts`, `src/render2d/heroes2d.ts`, `scripts/heroBalance.ts`)** — *DONE (Round 2)*
  - Tuned all 5 heroes (`bran`, `wren`, `mira`, `tobb`, `sela`) against `docs/hero-spec.md` targets (`L1 ≈ 1× T2 Barracks = 648 dmg`, `L20 ≈ 2× T3 Towers = 7,642 dmg`) without altering any skill-node percentage hardcoded in `src/i18n/heroesTr.ts` (keeps EN & TR tooltips 100% accurate).
  - Added per-hero `HeroLevelGrowth`, `buildLevel20Specialization` (all 3 branch pairings `B0+1 / B0+2 / B1+2`), and `defaultSkillsForLevel` (wired into `?herolevel=N` and `scripts/heroBalance.ts`).
  - Moderated Mira's `wispFireRing` capstone secondary ring (`0.78×` radius, `0.42×` burst, `0.55×` burn, `2.0s`) and gave Bran's `Rally Banner` a self-combat surge (`+6%` swing speed and `0.55×` banner damage bonus) so Bran reaches 3★ on Master islands (`i10`, `i16`) without over-scaling solo DPS.
  - Tobb's `Deploy Gizmo` build-plot collision fix verified across all 17 islands (committed in Step 1).
- [ ] **3. Robustness (Save/Progress Migrations, Fuzz Tests, Daily/Endless/Challenge Edge Cases, Zero-Alloc Hot Paths)** — *Next*
  - Save/progress migration & `saveCode.ts` hero-roster preservation + fuzz tests across legacy v1/v2/2D/corrupted shapes.
  - Daily/Endless edge cases & Challenge + Hero/Ability interactions (`Silent Skies` vs hero skills).
  - Eliminate remaining per-tick allocations in owned `src/sim/**` hot paths (`SimWorld.fixedTick` 9 closures/tick and `HeroSystem`/`SoldierSystem` sort closures already eliminated in Step 1; audit `combatSystem`, `projectileSystem`, `waveSystem`, `heroSystem` skills).
- [ ] **4. Speed 3× & Deterministic Replay Command API (`src/core/**`, `src/sim/**`, `src/platform/**`)**
  - Verify 3× speed support and expose tick-stamped command recording & deterministic replay hooks on `SimWorld` for Opus; document exact API below.

---

## Requests for Other Agents

1. **Opus (`src/render2d/game2d.ts`):**
   - `Game2D.towerHasTarget(t)` (around line 267): currently skips `!e.active || e.hp <= 0 || (e.flying && !def.hitsFlyers)` without checking `e.burrowed`, so attack towers pre-roll attack sheets at underground `burrower`s they cannot shoot; also `maxSq` uses `(st.range * (1 + t.auraRange)) ** 2` without `+ (t.heroRangeBonus ?? 0)` (Tobb's upgraded Tinker range bonus).
   - `Game2D.syncRangePreview()` / `openForPlot()` (lines 734 & 906): range preview disc uses base `getTowerTierStats(type, tier).range` instead of scaling by `(1 + t.auraRange + (t.heroRangeBonus ?? 0))` when inspecting an aura-buffed tower.
   - `Game2D.wireEvents()` `lightningChain` handler (line 376): when `t` is null (Sela's **Thunder Call**, where `points[0]` is `{ x: h.x, y: 1.1, z: h.z }`), `muzzle` falls back to `this.towers.muzzleHeight('tesla')` instead of `p0.y`, drawing the bolt origin above Sela's head.
2. **Codex (`src/sim/enemySystem.ts`):**
   - `EnemySystem.updateHealerAura` (line 840): checks `if (!ally.active || ally.hp >= ally.maxHp) continue;` — harmless today since pass 1 releases `hp <= 0`, but adding `|| ally.hp <= 0 || ally.burrowed` is a good defensive guard if new enemy death-delay mechanics are added tonight.

---

## Hero Balance — Before vs After (`npm run sim:heroes`)

### 1. Controlled 55s Unit Power Equivalence Benchmark (`l1c` mixed ground/armored/flyer wave)
- **Spec Targets (`docs/hero-spec.md`):**
  - **Level 1 Target (`1× Tier-2 Barracks`, 140g):** `648 dmg`
  - **Level 20 Target (`2× Tier-3 Towers: Archer + Cannon`, 500g):** `7,642 dmg`

| Hero | Before L1 Dmg | After L1 Dmg | After L10 Dmg | Before L20 Dmg (`B0+1`) | After L20 Dmg (`B0+1 / B0+2 / B1+2`) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **Bran Ironoak** | `224` *(35% of ref)* | `959` | `2,014` | `6,011` | `7,683 / 6,767 / 8,492` |
| **Wren Skyfletch** | `499` *(77% of ref)* | `646` | `2,633` | `5,776` | `7,532 / 7,105 / 6,746` |
| **Mira Emberwisp** | `537` *(83% of ref)* | `575` | `3,829` | `7,783` | `7,174 / 6,212 / 7,081` |
| **Tobb Gearwright** | `733` *(113% of ref)* | `653` | `2,019` | `5,948` | `7,530 / 6,508 / 7,730` |
| **Sela Tidecaller** | `622` *(96% of ref)* | `685` | `2,183` | `5,609` | `7,673 / 7,456 / 8,202` |

### 2. Campaign Island Impact (`l1c`, `i05`, `i10`, `i16` — Greedy / Weak)
- **Before:** `bran` L1 dealt only `2.9k–3.7k` across 15–20 waves and `bran` L20 failed to reach 3★ on Master `i10` (`12L 2★`, vs `20L 3★` for every ranged hero), while `mira` L20 dominated `i05` (`101k–105k`, ~3.5×–4.5× `bran`/`sela`).
- **After:**
  - Every hero at L20 turns `l1c` Weak (`11L 2★` baseline) into `20L 3★`, turns `i05` Weak (`Loss 0L` baseline) into a victory (`9L–20L`), and upgrades **both** Master `i10` Greedy (`5L 1★` baseline) and Master `i16` Greedy (`5L 1★` baseline) to **3★ clears** (`bran` L20 now clears `i10` at `13L 3★` and `i16` at `13L 3★`; `wren`/`mira`/`tobb`/`sela` L20 all clear at `20L 3★`).
  - Master `i10` L20 Greedy hero damage band narrowed from `26.1k–63.5k` (`2.44×` spread) to `28.0k–66.7k` with every hero earning 3★, and no hero solo-carries Master Weak (`L 0L` on `i10`/`i16` weak across all 5 heroes).
  - Kept all `src/i18n/heroesTr.ts` node percentage strings untouched by tuning `baseStats`, `levelGrowth`, passive base power (`Kindling` / `Calm Waters`), and active base damage/cooldowns/radii.
