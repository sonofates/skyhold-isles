# Handoff — Hero Rally-Point Respawn & Post-Respawn Invulnerability (`agy-respawn`)

- **Branch:** `hermes/skyhold-respawn` (base: `art-2d` @ `b679c6f`)
- **Date:** 2026-11-19
- **Scope:** Simulation logic, hero respawn data constants, minimal 2D island HP retuning, tests, QA invariants, and spec/handoff docs only. **`src/render2d/**` is untouched.**

---

## 1. What Changed

### A. Hero Respawn Location & Post-Respawn Invulnerability (`src/sim/heroSystem.ts`, `src/data/heroes.ts`, `docs/hero-spec.md`)

1. **Initial run spawn unchanged:** Heroes still spawn at the castle gate threshold (`groundGraph.castleSpawnPoint()`, `HERO_RULES.castleSpawnBackoff = 0.75u`) when a run begins (`t = 0`).
2. **Last commanded rally point (`hasRallyPoint`, `rallyX`, `rallyZ`):**
   - `HeroSystem.commandMove(wantX, wantZ)` records the clamped walkable destination `(last.x, last.z)` onto `hero.hasRallyPoint = true`, `hero.rallyX = last.x`, `hero.rallyZ = last.z`.
   - Preserved even if the hero falls mid-walk before arriving or across story-to-endless cleanup (`clearTransientZones`).
   - When the respawn countdown reaches `0`, if `hasRallyPoint` is `true`, the nominal respawn point is `(rallyX, rallyZ)`.
3. **Castle-side fallback when never moved (`!hasRallyPoint` -> `getFallbackRespawnPoint()`):**
   - **Multi-lane maps (`groundPaths.length >= 2`):** Walks backward from the castle goal along lane `0` until lanes diverge (`> 0.7u` apart) and places the fallback just castle-side of that first merge (`earliestSharedDist + 0.8u`), clamped at least `HERO_RULES.respawnCastleClearance` (`3.0u`) before the goal so it never lands inside the castle mouth (`<= 1.20u`).
   - **Single-lane maps (`groundPaths.length === 1`):** Walks backward from the castle side (`3.0u .. min(18.0u, 0.45 * totalLength)`) and selects the apex of the first road bend/chokepoint (`>= 25°` turn across a `±1.0u` chord), or `min(4.5u, 0.35 * totalLength)` before the goal on straight roads — strictly outside the castle and directly on `groundPaths[0]`.
4. **Unsafe rally-point retreat (`resolveRespawnPoint()`):**
   - Evaluates all active, living, surface ground enemies (`e.active && e.hp > 0 && !e.flying && !e.burrowed`). Overhead flyers and underground burrowers do not block ground road safety.
   - A candidate point `(cx, cz)` is considered safe when every surface ground enemy is further than `e.radius + HERO_RULES.respawnSafeClearance` (`1.25u`).
   - If the nominal rally/fallback point is unsafe, `resolveRespawnPoint()` steps backward along that lane's `CompiledPath` towards the castle in `0.35u` increments within Euclidean radius `HERO_RULES.respawnRetreatRadius` (`4.5u`) and returns the **nearest safe walkable road point** (or the least-threatened road point in that retreat corridor if the entire corridor is packed). The player's commanded `(rallyX, rallyZ)` stays intact for subsequent respawns once clear.
5. **Respawn timer & Hard multiplier preserved:**
   - Base `respawnSec`, skill-tree `respawnMul` patches, and difficulty `heroRespawnMul` (`×1.25` on Hard) apply identically to before.
6. **Brief post-respawn invulnerability (`HERO_RULES.respawnInvulnSec = 1.5` s):**
   - Upon respawning, `hero.invulnTimer` is set to **`1.5` seconds** (`90` ticks at `60 Hz`), exposed on `HeroRuntimeState` (`getHeroState()`) as `invulnRemaining`.
   - Throughout the `1.5 s` duration, `updateEnemyStrikesAgainstHero` ignores enemy melee strikes against the hero (`0` damage taken, `0` `heroHit` events emitted), while allowing the hero to move, block, attack, and cast skills normally. Normal damage resumes once `invulnTimer` reaches `0`.

---

## 2. Renderer / UI Handoff Notes for Opus (`src/render2d/**` Untouched)

Per task boundaries, zero files under `src/render2d/**` were modified.

1. **`heroRespawn` Event Payload (`src/core/eventBus.ts`):**
   - `heroRespawn` already emits `{ heroId, x, z, hp, maxHp }` with `(x, z)` set to the **exact resolved respawn coordinates** (rally point, castle-side fallback chokepoint, or safe retreat point behind an occupied rally point).
   - `HeroLayer` (`src/render2d/heroLayer.ts:234`) already reads `(e.x, e.z)` to spawn the respawn burst VFX (`wring`, `orb`, `spark`) and resets `lastPx = NaN`, so respawn VFX and sprite teleportation already appear at the new respawn point automatically.
2. **Optional UI/Render Follow-Ups for Opus:**
   - **Dead countdown ring position (`src/render2d/heroLayer.ts:628-630`):** While `dead === true`, `HeroLayer.drawBars` currently renders the countdown badge at `(h.spawnX, h.spawnZ)` (the initial castle spawn). To show the countdown over the upcoming respawn anchor instead of the castle, read:
     ```ts
     const anchor = h.hasRallyPoint
       ? { x: h.rallyX, z: h.rallyZ }
       : world.heroSystem.getFallbackRespawnPoint();
     ```
   - **Invulnerability shimmer:** Read `h.invulnTimer > 0` (or `game.getHeroState()?.invulnRemaining`) to render a brief `1.5 s` golden/white shield pulse or alpha shimmer after respawn.

---

## 3. Minimal 2D Island Balance Adjustments (`npm run sim:balance`)

3D campaign levels **L1–L16** are **100% byte-identical** (`cmp` / `diff -u` = `0` bytes changed across all `316` standalone lines / `24,217` bytes, and all `313` embedded lines / `24,166` bytes in the full `sim:balance` report).

Because Bran now respawns at/behind his merge rally point with `1.5 s` invulnerability instead of walking all the way back from the castle, 7 of the 25 2D islands shifted slightly across their target life-loss / weak-clear boundaries and received minimal `enemyHpScale` adjustments (`0.21%`–`2.15%`):

| Island | Difficulty | `enemyHpScale` Before | `enemyHpScale` After | Delta | Greedy Before -> After | Weak Before -> After |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `i02` | Challenging | `1.736` | `1.741` | `+0.29%` | `21/21 3★` -> `21/21 3★` | `W 16/21 2★` -> `W 11/21 2★` |
| `i06` | Heroic | `1.3923` | `1.3623` | `-2.15%` | `11/21 2★` -> `11/21 2★` | `L 0/21` -> `L 0/21` |
| `i08` | Master | `2.0377` | `2.0577` | `+0.98%` | `17/22 3★` -> `17/22 3★` | `L 0/22` -> `L 0/22` |
| `i12` | Master | `2.302` | `2.307` | `+0.22%` | `16/22 3★` -> `20/22 3★` | `L 0/22` -> `L 0/22` |
| `i14` | Master | `3.2609` | `3.2809` | `+0.61%` | `13/22 2★` -> `12/22 2★` | `L 0/22` -> `L 0/22` |
| `i18` | Master | `2.3316` | `2.3266` | `-0.21%` | `9/22 2★` -> `7/22 1★` | `L 0/22` -> `L 0/22` |
| `i22` | Master | `1.9152` | `1.8952` | `-1.04%` | `4/22 1★` -> `8/22 2★` | `L 0/22` -> `L 0/22` |

All other 18 2D islands (`l1c`, `i01`, `i03`–`i05`, `i07`, `i09`–`i11`, `i13`, `i15`–`i17`, `i19`–`i21`, `i23`–`i24`) remained untouched.

---

## 4. QA Bot, `sim:heroes`, & Unit Tests

- **Unit tests (`tests/sim/heroes.test.ts`):** Added 5 dedicated tests (+5 net tests, 24 total in `heroes.test.ts`) covering:
  1. Respawn at last commanded rally point (including multi-move override, mid-walk death before arrival, `heroRespawn` `(x, z)` payload, and Hard `heroRespawnMul = 1.25` timer scaling).
  2. Fallback respawn at castle-side merge/chokepoint when never moved (multi-lane merge and single-lane castle-side bend, verified outside the castle and on the walkable graph).
  3. Unsafe rally-point fallback (ground enemy standing on rally point triggers safe retreat behind it towards the castle within `4.5u`, overhead flyers ignored, walkable-graph check, and preservation of `rallyX`/`rallyZ`).
  4. `1.5 s` (`90`-tick) post-respawn invulnerability window (`0` damage & `0` `heroHit` events during `invulnTimer > 0`, normal melee damage immediately afterwards).
  5. Bit-exact determinism across contested deaths, retreats, respawns, and invulnerability combat.
- **Invariants (`qa/bot/invariants.ts`, `qa/bot/hash.ts`, `qa/bot/runner.ts`, `qa/bot/strategies.ts`, `scripts/heroBalance.ts`):**
  - `InvariantMonitor` and `sim:heroes` assert on every `heroRespawn` that `(ev.x, ev.z)` lies on the walkable ground graph (`offRoad <= HERO_RULES.maxOffRoadDist + 0.08`), matches `(hero.x, hero.z)`, and sets `hero.invulnTimer > 0`.
  - `InvariantMonitor` asserts `heroHit` never fires while `hero.invulnTimer > 0` and checks finiteness of `rallyX`, `rallyZ`, and `invulnTimer`.
  - `hashWorldState` hashes `hasRallyPoint`, `rallyX`, `rallyZ`, and `invulnTimer` for 1-ULP replay determinism checks; `parkMode === 'castle'` in `qa:bot` leaves `hasRallyPoint = false` so no-rally fallback respawns are exercised across the full island suite.

---

## 5. Gate Results

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **PASS** (`0` errors) |
| `npm run lint` | **PASS** (`0` errors, `0` warnings) |
| `npm test` | **PASS** — **100 test files passed** (`1` skipped), **1,334 tests passed** (`11` skipped, `0` failed; `+5` new respawn tests in `tests/sim/heroes.test.ts`) |
| `npm run sim:balance` | **PASS** — **41/41 levels passed** (`16` 3D campaign + `25` 2D islands); **3D L1–L16 100% byte-identical** (`0` bytes diff across `316` standalone lines / `24,217` bytes and `313` embedded lines / `24,166` bytes) |
| `npm run sim:heroes` | **PASS** — `l1c`, `i05`, `i10`, `i16` × 5 heroes × L1/L10/L20 (`0` walkable-graph violations) |
| `npm run qa:bot` | **PASS** — **557/557 scenarios passed**, **17,132,807 sim ticks**, **11/11 determinism replays**, **`0` invariant violations** |
| `npm run build` | **PASS** (`tsc && vite build` clean on Node 22) |

### Informational Note
- `npm run sim:difficulty`: 7/8 campaign verdicts pass (`Easy` 25/25, `Normal` 25/25, `Hard` Ch1 12/17, `Hard` Ch2 3/8, `Hard` `i24` `W 5/22 1★`, `Hard weak` 3/25); on `i09` Hard (`campaign hard`), faster rally-point respawn lets Bran clear at `22/22 3★` (`14/15` Hard wins < full lives). Left `i09` untouched per instructions since `i09` already passes `npm run sim:balance` (`17/22 3★`).

---

## 6. Files Modified

- `src/data/heroes.ts` (`HERO_RULES` respawn constants + doc comment only)
- `src/sim/heroSystem.ts` (`hasRallyPoint`/`rallyX`/`rallyZ`, `invulnTimer`, `getFallbackRespawnPoint()`, `resolveRespawnPoint()`, `1.5 s` post-respawn immunity)
- `docs/hero-spec.md` (updated respawn & invulnerability specification)
- `scripts/heroBalance.ts` (respawn walkable-graph invariant + idle post-respawn return)
- `qa/bot/invariants.ts`, `qa/bot/hash.ts`, `qa/bot/runner.ts`, `qa/bot/strategies.ts` (walkable-graph & invulnerability invariants, state hashing, un-commanded fallback coverage)
- `src/data/levels2d/i02.ts`, `i06.ts`, `i08.ts`, `i12.ts`, `i14.ts`, `i18.ts`, `i22.ts` (minimal `enemyHpScale` retuning)
- `tests/sim/heroes.test.ts` (5 new respawn/fallback/unsafe/invulnerability/determinism tests)
- `docs/handoff-agy-respawn.md` (this handoff report)
